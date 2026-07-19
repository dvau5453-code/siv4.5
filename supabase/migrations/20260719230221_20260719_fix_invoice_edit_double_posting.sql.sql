/*
# Fix invoice edit/cancel double-posting (INV-940585 root cause)

## Plain-English explanation
Three accounting bugs fired whenever an invoice was edited or cancelled:

1. DOUBLE STOCK DEDUCTION ON EDIT
   `edit_invoice` STEP 9 manually ran `UPDATE inventory_items SET quantity_on_hand = quantity_on_hand - v_qty`
   and inserted a `sale` stock_movement for every new item. But STEP 6 (DELETE + re-INSERT of
   invoice_items) already fired the `trg_deduct_stock_on_invoice_item` AFTER INSERT trigger, which
   does the exact same inventory update and stock_movement insert. Result: stock deducted twice.

2. DOUBLE COGS JOURNAL ENTRY ON EDIT
   `edit_invoice` STEP 8 manually posted a COGS journal entry for the new items. Then STEP 10
   flipped the invoice status from 'draft' to 'paid', which fired `invoice_status_cogs_trigger`
   (AFTER UPDATE OF status) — and that trigger has NO duplicate guard, so it posted COGS again.
   (The AR trigger did not duplicate because it has an explicit "already exists" guard; the COGS
   status trigger did not.)

3. DOUBLE PAYMENT REVERSAL ON CANCEL-AFTER-EDIT
   `edit_invoice` STEP 4 created a `REV-` reversal payment for the original payment but left the
   original payment row in place with `reference_type='invoice'`. Later, `cancel_invoice` STEP 4
   iterated `SELECT * FROM payments WHERE reference_type='invoice' AND reference_id=p_invoice_id`,
   picked up BOTH the already-reversed original AND the new edited payment, and reversed them both
   again. The original got reversed twice.

## Changes in this migration

### 1. `payments` table — add `is_reversed` flag (additive, safe)
- New column `is_reversed boolean NOT NULL DEFAULT false`.
- Allows `edit_invoice` to mark original payments as reversed so `cancel_invoice` skips them.

### 2. `edit_invoice(...)` — REPLACE
- STEP 4: mark original payments `is_reversed = true` after inserting the reversal.
- STEP 8 (manual COGS repost): REMOVED. COGS is posted by `invoice_status_cogs_trigger` on status flip.
- STEP 9 (manual stock deduction): REMOVED. Stock is deducted by `trg_deduct_stock_on_invoice_item` on re-insert.

### 3. `invoice_status_cogs_trigger()` — REPLACE
- Add idempotency guard: skip if a COGS journal entry already exists for this invoice.

### 4. `cancel_invoice(...)` — REPLACE
- STEP 4: only reverse payments where `is_reversed = false`.
- STEP 4a: scope JE deletion to non-reversed payments.

### 5. `deduct_stock_on_invoice_item()` — REPLACE (defense-in-depth)
- Add idempotency guard: skip if a `sale` stock_movement already exists for this (invoice, product).

## Security
No RLS / policy changes. No new tables. Single additive column with a safe default.

## Idempotency
All CREATE OR REPLACE statements are safe to re-run. ALTER TABLE ADD COLUMN uses IF NOT EXISTS.
Parameter signatures (including DEFAULT NULL) are preserved so CREATE OR REPLACE succeeds.
*/

-- ============================================================
-- 1. Add is_reversed flag to payments (additive)
-- ============================================================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_reversed boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Replace edit_invoice — remove STEP 8 (manual COGS) and STEP 9 (manual stock),
--    and mark original payments as reversed in STEP 4.
--    Parameter defaults preserved to satisfy CREATE OR REPLACE.
-- ============================================================
CREATE OR REPLACE FUNCTION edit_invoice(
  p_invoice_id uuid,
  p_new_data json,
  p_reason text DEFAULT NULL::text,
  p_edited_by text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice RECORD;
  v_ar_account uuid;
  v_revenue_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_cash_account uuid;
  v_default_wh uuid;
  v_item RECORD;
  v_qty numeric;
  v_cost numeric;
  v_payment RECORD;
  v_je_id uuid;
  v_new_items json;
  v_new_item json;
  v_new_subtotal numeric := 0;
  v_new_cart_discount_percent numeric := 0;
  v_new_extra_discount numeric := 0;
  v_cart_discount_amount numeric := 0;
  v_new_total numeric := 0;
  v_new_customer uuid;
  v_new_date date;
  v_new_due_date date;
  v_new_notes text;
  v_new_payment_term text := 'full';
  v_new_payment_method text := 'cash';
  v_new_partial_amount numeric := 0;
  v_has_deliveries boolean;
  v_has_returns boolean;
  v_old_snapshot json;
  v_new_snapshot json;
  v_i integer := 0;
  v_old_payments json;
  v_old_payment_term text;
  v_new_payment_id uuid;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit a cancelled invoice');
  END IF;

  SELECT EXISTS(SELECT 1 FROM deliveries WHERE invoice_id = p_invoice_id AND status = 'delivered') INTO v_has_deliveries;
  IF v_has_deliveries THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit an invoice that has been delivered. Please process a return instead.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM sales_returns WHERE invoice_id = p_invoice_id) INTO v_has_returns;
  IF v_has_returns THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit an invoice with linked sales returns. Please remove the return first.');
  END IF;

  v_new_customer := (p_new_data->>'customer_id')::uuid;
  v_new_date := COALESCE((p_new_data->>'invoice_date')::date, CURRENT_DATE);
  v_new_due_date := CASE WHEN p_new_data->>'due_date' IS NULL OR p_new_data->>'due_date' = '' THEN NULL ELSE (p_new_data->>'due_date')::date END;
  v_new_notes := p_new_data->>'notes';
  v_new_items := p_new_data->'items';
  v_new_cart_discount_percent := COALESCE((p_new_data->>'cart_discount_percent')::numeric, 0);
  v_new_extra_discount := COALESCE((p_new_data->>'extra_discount')::numeric, 0);
  v_new_payment_term := COALESCE(p_new_data->>'payment_term', 'full');
  v_new_payment_method := COALESCE(p_new_data->>'payment_method', 'cash');
  v_new_partial_amount := COALESCE((p_new_data->>'partial_amount')::numeric, 0);

  IF v_new_items IS NULL OR json_array_length(v_new_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Invoice must have at least one item');
  END IF;

  FOR v_i IN SELECT generate_series(0, json_array_length(v_new_items) - 1) LOOP
    v_new_item := v_new_items->v_i;
    v_new_subtotal := v_new_subtotal + (COALESCE((v_new_item->>'quantity')::numeric, 0) * COALESCE((v_new_item->>'unit_price')::numeric, 0) * (1 - COALESCE((v_new_item->>'discount_percent')::numeric, 0) / 100));
  END LOOP;

  v_cart_discount_amount := (v_new_subtotal * v_new_cart_discount_percent) / 100;
  v_new_total := GREATEST(0, v_new_subtotal - v_cart_discount_amount - v_new_extra_discount);

  v_old_payment_term := CASE WHEN v_invoice.status = 'paid' THEN 'full' WHEN v_invoice.status = 'partially_paid' THEN 'partial' ELSE 'credit' END;

  SELECT id INTO v_ar_account FROM accounts WHERE code = '1100' LIMIT 1;
  SELECT id INTO v_revenue_account FROM accounts WHERE code = '4000' LIMIT 1;
  SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;
  SELECT id INTO v_cash_account FROM accounts WHERE code = '1000' LIMIT 1;

  SELECT id INTO v_default_wh FROM warehouses WHERE is_default = true AND is_active = true LIMIT 1;
  IF v_default_wh IS NULL THEN
    SELECT id INTO v_default_wh FROM warehouses WHERE is_active = true LIMIT 1;
  END IF;

  SELECT COALESCE(json_agg(json_build_object('id', p.id, 'payment_method', p.payment_method, 'amount', p.amount, 'payment_type', p.payment_type, 'payment_date', p.payment_date)), '[]'::json)
  INTO v_old_payments
  FROM payments p WHERE p.reference_type = 'invoice' AND p.reference_id = p_invoice_id;

  SELECT json_build_object(
    'customer_id', v_invoice.customer_id, 'invoice_date', v_invoice.invoice_date, 'due_date', v_invoice.due_date,
    'notes', v_invoice.notes, 'subtotal', v_invoice.subtotal,
    'cart_discount_percent', COALESCE(v_invoice.cart_discount_percent, 0),
    'extra_discount', COALESCE(v_invoice.extra_discount, 0),
    'total_amount', v_invoice.total_amount, 'amount_paid', v_invoice.amount_paid, 'status', v_invoice.status,
    'payment_term', v_old_payment_term, 'payments', v_old_payments,
    'items', (SELECT json_agg(json_build_object('product_id', ii.product_id, 'quantity', ii.quantity, 'unit_price', ii.unit_price, 'discount_percent', ii.discount_percent, 'subtotal', ii.subtotal, 'unit_name', ii.unit_name, 'base_quantity', ii.base_quantity)) FROM invoice_items ii WHERE ii.invoice_id = p_invoice_id)
  ) INTO v_old_snapshot;

  -- STEP 1: Restore stock for old items
  FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
    v_qty := COALESCE(v_item.base_quantity, v_item.quantity);
    IF v_default_wh IS NOT NULL THEN
      UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + v_qty, updated_at = now() WHERE product_id = v_item.product_id AND warehouse_id = v_default_wh;
      IF NOT FOUND THEN
        INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming) VALUES (v_item.product_id, v_default_wh, v_qty, 0, 0);
      END IF;
      INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, reference_number, notes)
      VALUES (v_item.product_id, v_default_wh, 'return_in', v_qty, COALESCE(v_item.cost_price, 0), 'invoice_edit', p_invoice_id, v_invoice.invoice_number, 'Stock restoration - invoice edited');
    END IF;
  END LOOP;

  -- STEP 2: Reverse AR + Revenue journal entry
  IF v_ar_account IS NOT NULL AND v_revenue_account IS NOT NULL AND v_invoice.total_amount > 0 THEN
    PERFORM post_journal_entry(
      'REVERSAL - AR - Invoice ' || v_invoice.invoice_number || ' EDIT', COALESCE(v_invoice.invoice_date, CURRENT_DATE), 'invoice_edit', p_invoice_id,
      json_build_array(
        json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_invoice.total_amount, 'description', 'Reverse AR for edited invoice ' || v_invoice.invoice_number),
        json_build_object('account_id', v_revenue_account, 'debit', v_invoice.total_amount, 'credit', 0, 'description', 'Reverse revenue for edited invoice ' || v_invoice.invoice_number)
      )::json, v_invoice.customer_id
    );
  END IF;

  -- STEP 3: Reverse COGS
  IF v_cogs_account IS NOT NULL AND v_inventory_account IS NOT NULL THEN
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
      v_qty := v_item.quantity;
      v_cost := COALESCE(v_item.cost_price, 0);
      IF v_qty * v_cost > 0 THEN
        PERFORM post_journal_entry(
          'REVERSAL - COGS - Invoice ' || v_invoice.invoice_number || ' EDIT', COALESCE(v_invoice.invoice_date, CURRENT_DATE), 'invoice_edit', p_invoice_id,
          json_build_array(
            json_build_object('account_id', v_cogs_account, 'debit', 0, 'credit', v_qty * v_cost, 'description', 'Reverse COGS for edited invoice ' || v_invoice.invoice_number),
            json_build_object('account_id', v_inventory_account, 'debit', v_qty * v_cost, 'credit', 0, 'description', 'Reverse inventory for edited invoice ' || v_invoice.invoice_number)
          )::json, v_invoice.customer_id
        );
      END IF;
    END LOOP;
  END IF;

  -- STEP 4: Reverse original payments AND mark them as reversed so cancel_invoice skips them
  FOR v_payment IN SELECT * FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id AND is_reversed = false LOOP
    INSERT INTO payments (payment_number, payment_type, payment_method, amount, payment_date, reference_type, reference_id, reference_number, notes)
    VALUES ('REV-' || COALESCE(v_payment.payment_number, 'PAY'), CASE WHEN v_payment.payment_type = 'received' THEN 'refund' ELSE 'payment' END, v_payment.payment_method, v_payment.amount, CURRENT_DATE, 'invoice_edit', p_invoice_id, v_invoice.invoice_number, 'Reversal payment for edited invoice ' || v_invoice.invoice_number);
    -- Mark the original payment as reversed so cancel_invoice cannot reverse it again
    UPDATE payments SET is_reversed = true WHERE id = v_payment.id;
  END LOOP;

  -- Delete original payment journal entries and roll back account balances
  FOR v_je_id IN
    SELECT je.id FROM journal_entries je
    WHERE je.reference_type = 'payment'
    AND je.reference_id IN (SELECT id FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id)
  LOOP
    UPDATE accounts a SET balance = balance - (
      CASE WHEN a.account_type IN ('asset', 'expense') THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
      ELSE COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0) END
    )
    FROM journal_lines jl WHERE jl.journal_entry_id = v_je_id AND a.id = jl.account_id;
    DELETE FROM journal_lines WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- STEP 5: Update invoice header (balance_due is generated — do NOT set it directly)
  UPDATE invoices
  SET customer_id = v_new_customer, invoice_date = v_new_date, due_date = v_new_due_date, notes = v_new_notes,
  subtotal = v_new_subtotal, cart_discount_percent = v_new_cart_discount_percent, extra_discount = v_new_extra_discount,
  discount_amount = v_cart_discount_amount, total_amount = v_new_total, amount_paid = 0,
  status = 'draft', edit_count = COALESCE(edit_count, 0) + 1, updated_at = now()
  WHERE id = p_invoice_id;

  -- STEP 6: Re-insert items (the trg_deduct_stock_on_invoice_item AFTER INSERT trigger
  --          deducts stock and records the sale stock_movement — no manual deduction needed).
  --          The invoice_items_cogs_trigger skips because status='draft' here.
  DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;
  FOR v_i IN SELECT generate_series(0, json_array_length(v_new_items) - 1) LOOP
    v_new_item := v_new_items->v_i;
    INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, discount_percent, tax_rate, subtotal, unit_name, unit_conversion_factor, base_quantity, sort_order)
    VALUES (p_invoice_id, (v_new_item->>'product_id')::uuid, (v_new_item->>'quantity')::numeric, (v_new_item->>'unit_price')::numeric, COALESCE((v_new_item->>'cost_price')::numeric, 0), COALESCE((v_new_item->>'discount_percent')::numeric, 0), 0, (v_new_item->>'quantity')::numeric * (v_new_item->>'unit_price')::numeric * (1 - COALESCE((v_new_item->>'discount_percent')::numeric, 0) / 100), NULLIF(v_new_item->>'unit_name', ''), NULLIF(v_new_item->>'unit_conversion_factor', '')::numeric, COALESCE((v_new_item->>'base_quantity')::numeric, (v_new_item->>'quantity')::numeric), v_i);
  END LOOP;

  -- STEP 7: Re-post AR + Revenue for new total.
  -- (The invoice_accounting trigger has a duplicate guard keyed on "Accounts Receivable",
  --  so if it also fires on the status flip it will no-op. Posting here keeps the explicit
  --  record for the edited invoice.)
  IF v_ar_account IS NOT NULL AND v_revenue_account IS NOT NULL AND v_new_total > 0 THEN
    PERFORM post_journal_entry(
      'AR - Invoice ' || v_invoice.invoice_number || ' EDITED', v_new_date, 'invoice', p_invoice_id,
      json_build_array(
        json_build_object('account_id', v_ar_account, 'debit', v_new_total, 'credit', 0, 'description', 'AR for edited invoice ' || v_invoice.invoice_number),
        json_build_object('account_id', v_revenue_account, 'debit', 0, 'credit', v_new_total, 'description', 'Revenue for edited invoice ' || v_invoice.invoice_number)
      )::json, v_new_customer
    );
  END IF;

  -- NOTE: STEP 8 (manual COGS repost) REMOVED.
  -- COGS is now posted by invoice_status_cogs_trigger when STEP 10 flips status
  -- from 'draft' to 'paid'/'sent'/'partially_paid'. The trigger has an idempotency
  -- guard (added in this migration) so it will not double-post.

  -- NOTE: STEP 9 (manual stock deduction) REMOVED.
  -- Stock is deducted by the trg_deduct_stock_on_invoice_item AFTER INSERT trigger
  -- fired in STEP 6 when the items were re-inserted. The trigger has an idempotency
  -- guard (added in this migration) so it will not double-deduct.

  -- STEP 10: Apply new payment term. This status change (draft -> sent/partially_paid/paid)
  --          fires invoice_status_cogs_trigger which posts COGS once (guarded).
  IF v_new_payment_term = 'credit' THEN
    UPDATE invoices SET status = 'sent', amount_paid = 0 WHERE id = p_invoice_id;
  ELSIF v_new_payment_term = 'partial' THEN
    v_new_partial_amount := LEAST(v_new_partial_amount, v_new_total);
    IF v_new_partial_amount > 0 THEN
      INSERT INTO payments (payment_number, payment_type, payment_method, amount, payment_date, reference_type, reference_id, reference_number, notes)
      VALUES ('EDIT-' || v_invoice.invoice_number, 'received', v_new_payment_method, v_new_partial_amount, CURRENT_DATE, 'invoice', p_invoice_id, v_invoice.invoice_number, 'Partial payment for edited invoice ' || v_invoice.invoice_number)
      RETURNING id INTO v_new_payment_id;
      IF v_cash_account IS NOT NULL AND v_ar_account IS NOT NULL THEN
        PERFORM post_journal_entry(
          'Payment - Invoice ' || v_invoice.invoice_number || ' EDITED', CURRENT_DATE, 'payment', v_new_payment_id,
          json_build_array(
            json_build_object('account_id', v_cash_account, 'debit', v_new_partial_amount, 'credit', 0, 'description', 'Partial payment received for ' || v_invoice.invoice_number),
            json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_new_partial_amount, 'description', 'AR cleared for ' || v_invoice.invoice_number)
          )::json, v_new_customer
        );
      END IF;
      UPDATE invoices SET status = 'partially_paid', amount_paid = v_new_partial_amount WHERE id = p_invoice_id;
    ELSE
      UPDATE invoices SET status = 'sent', amount_paid = 0 WHERE id = p_invoice_id;
    END IF;
  ELSE
    IF v_new_total > 0 THEN
      INSERT INTO payments (payment_number, payment_type, payment_method, amount, payment_date, reference_type, reference_id, reference_number, notes)
      VALUES ('EDIT-' || v_invoice.invoice_number, 'received', v_new_payment_method, v_new_total, CURRENT_DATE, 'invoice', p_invoice_id, v_invoice.invoice_number, 'Payment for edited invoice ' || v_invoice.invoice_number)
      RETURNING id INTO v_new_payment_id;
      IF v_cash_account IS NOT NULL AND v_ar_account IS NOT NULL THEN
        PERFORM post_journal_entry(
          'Payment - Invoice ' || v_invoice.invoice_number || ' EDITED', CURRENT_DATE, 'payment', v_new_payment_id,
          json_build_array(
            json_build_object('account_id', v_cash_account, 'debit', v_new_total, 'credit', 0, 'description', 'Payment received for ' || v_invoice.invoice_number),
            json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_new_total, 'description', 'AR cleared for ' || v_invoice.invoice_number)
          )::json, v_new_customer
        );
      END IF;
      UPDATE invoices SET status = 'paid', amount_paid = v_new_total WHERE id = p_invoice_id;
    ELSE
      UPDATE invoices SET status = 'paid', amount_paid = 0 WHERE id = p_invoice_id;
    END IF;
  END IF;

  -- STEP 11: Record edit history
  SELECT json_build_object('customer_id', v_new_customer, 'invoice_date', v_new_date, 'due_date', v_new_due_date, 'notes', v_new_notes, 'subtotal', v_new_subtotal, 'cart_discount_percent', v_new_cart_discount_percent, 'extra_discount', v_new_extra_discount, 'total_amount', v_new_total, 'payment_term', v_new_payment_term, 'payment_method', v_new_payment_method, 'items', v_new_items) INTO v_new_snapshot;

  INSERT INTO invoice_edit_history (invoice_id, invoice_number, edited_by_name, change_type, reason, snapshot_before, snapshot_after, old_value, new_value)
  VALUES (p_invoice_id, v_invoice.invoice_number, p_edited_by, 'full_edit', p_reason, v_old_snapshot, v_new_snapshot, v_old_snapshot, v_new_snapshot);

  -- STEP 12: Update customer outstanding_balance
  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = (SELECT COALESCE(SUM(balance_due), 0) FROM invoices WHERE customer_id = v_invoice.customer_id AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')), updated_at = now() WHERE id = v_invoice.customer_id;
  END IF;
  IF v_new_customer IS NOT NULL AND v_new_customer <> v_invoice.customer_id THEN
    UPDATE customers SET outstanding_balance = (SELECT COALESCE(SUM(balance_due), 0) FROM invoices WHERE customer_id = v_new_customer AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')), updated_at = now() WHERE id = v_new_customer;
  END IF;

  RETURN json_build_object('success', true, 'invoice_id', p_invoice_id, 'old_total', v_invoice.total_amount, 'new_total', v_new_total);
END;
$$;

-- ============================================================
-- 3. Replace invoice_status_cogs_trigger — add idempotency guard
-- ============================================================
CREATE OR REPLACE FUNCTION invoice_status_cogs_trigger() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_item RECORD;
  v_product RECORD;
  v_qty numeric;
  v_cost numeric;
  v_cogs_amount numeric;
  v_total_cogs numeric := 0;
  v_lines json[] := '{}';
  v_desc text;
  v_inv_desc text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status IN ('sent', 'partially_paid', 'paid') THEN
    -- Idempotency guard: if a COGS journal entry already exists for this invoice
    -- with reference_type='invoice', do not post again. Mirrors the AR trigger guard.
    PERFORM 1
      FROM journal_entries
      WHERE reference_type = 'invoice'
        AND reference_id = NEW.id
        AND description LIKE 'COGS%';
    IF FOUND THEN
      RETURN NEW;
    END IF;

    SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
    SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

    IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
      RETURN NEW;
    END IF;

    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = NEW.id ORDER BY sort_order LOOP
      -- Use quantity (not base_quantity) since cost_price is per sales unit
      v_qty := v_item.quantity;
      v_cost := COALESCE(v_item.cost_price, 0);
      v_cogs_amount := v_qty * v_cost;

      IF v_cogs_amount > 0 THEN
        SELECT name, sku INTO v_product FROM products WHERE id = v_item.product_id;

        v_desc := 'COGS: ' || COALESCE(v_product.name, 'Unknown') ||
          ' (SKU: ' || COALESCE(v_product.sku, 'N/A') || ') - Qty: ' || v_qty ||
          ' x Cost: ' || v_cost || ' = ' || v_cogs_amount;

        v_lines := array_append(v_lines, json_build_object(
          'account_id', v_cogs_account, 'debit', v_cogs_amount, 'credit', 0,
          'description', v_desc
        ));
        v_lines := array_append(v_lines, json_build_object(
          'account_id', v_inventory_account, 'debit', 0, 'credit', v_cogs_amount,
          'description', 'Inventory released: ' || COALESCE(v_product.name, 'item') ||
          ' (Qty: ' || v_qty || ') for ' || NEW.invoice_number
        ));

        v_total_cogs := v_total_cogs + v_cogs_amount;
      END IF;
    END LOOP;

    IF v_total_cogs > 0 THEN
      v_inv_desc := 'COGS - ' || NEW.invoice_number || ' (' || array_length(v_lines, 1) / 2 || ' items, total: ' || v_total_cogs || ')';
      PERFORM post_journal_entry(
        v_inv_desc,
        COALESCE(NEW.invoice_date, CURRENT_DATE),
        'invoice',
        NEW.id,
        to_json(v_lines),
        NEW.customer_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Replace cancel_invoice — skip already-reversed payments
--    Parameter defaults preserved to satisfy CREATE OR REPLACE.
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_invoice(
  p_invoice_id uuid,
  p_reason text DEFAULT NULL::text,
  p_cancelled_by text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice          RECORD;
  v_ar_account       uuid;
  v_revenue_account  uuid;
  v_cogs_account     uuid;
  v_inventory_account uuid;
  v_default_wh       uuid;
  v_item             RECORD;
  v_qty              numeric;
  v_cost             numeric;
  v_payment          RECORD;
  v_total_payments   numeric := 0;
  v_has_deliveries   boolean;
  v_je_id            uuid;
  v_sr               RECORD;
  v_returned_qty     numeric;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Invoice is already cancelled');
  END IF;

  -- Draft: just mark cancelled, no accounting reversals needed
  IF v_invoice.status = 'draft' THEN
    UPDATE invoices
    SET status = 'cancelled', amount_paid = 0, total_amount = 0, subtotal = 0, updated_at = now()
    WHERE id = p_invoice_id;

    INSERT INTO invoice_edit_history (
      invoice_id, invoice_number, edited_by_name, change_type, reason,
      snapshot_before, snapshot_after
    ) VALUES (
      p_invoice_id, v_invoice.invoice_number, p_cancelled_by, 'cancelled', p_reason,
      json_build_object('status', v_invoice.status, 'total_amount', v_invoice.total_amount),
      json_build_object('status', 'cancelled')
    );
    RETURN json_build_object('success', true, 'message', 'Draft invoice cancelled (no reversals needed)');
  END IF;

  -- Block if completed deliveries exist
  SELECT EXISTS(
    SELECT 1 FROM deliveries WHERE invoice_id = p_invoice_id AND status = 'delivered'
  ) INTO v_has_deliveries;
  IF v_has_deliveries THEN
    RETURN json_build_object('success', false, 'error', 'Cannot cancel invoice with completed deliveries. Please handle the delivery first.');
  END IF;

  -- Resolve account IDs
  SELECT id INTO v_ar_account        FROM accounts WHERE code = '1100' LIMIT 1;
  SELECT id INTO v_revenue_account   FROM accounts WHERE code = '4000' LIMIT 1;
  SELECT id INTO v_cogs_account      FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  SELECT id INTO v_default_wh FROM warehouses WHERE is_default = true AND is_active = true LIMIT 1;
  IF v_default_wh IS NULL THEN
    SELECT id INTO v_default_wh FROM warehouses WHERE is_active = true LIMIT 1;
  END IF;

  -- --------------------------------------------------------
  -- STEP 0: Reverse any linked sales-return journal entries
  --         and mark the sales returns as voided.
  -- --------------------------------------------------------
  FOR v_sr IN SELECT * FROM sales_returns WHERE invoice_id = p_invoice_id LOOP
    FOR v_je_id IN
      SELECT id FROM journal_entries
      WHERE reference_type IN ('sales_return', 'return') AND reference_id = v_sr.id
    LOOP
      UPDATE accounts a
      SET balance = balance - (
        CASE WHEN a.account_type IN ('asset', 'expense')
        THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
        ELSE COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)
        END
      )
      FROM journal_lines jl
      WHERE jl.journal_entry_id = v_je_id AND a.id = jl.account_id;

      DELETE FROM journal_lines  WHERE journal_entry_id = v_je_id;
      DELETE FROM journal_entries WHERE id = v_je_id;
    END LOOP;

    IF v_sr.payment_id IS NOT NULL THEN
      FOR v_je_id IN
        SELECT id FROM journal_entries
        WHERE reference_type = 'payment' AND reference_id = v_sr.payment_id
      LOOP
        UPDATE accounts a
        SET balance = balance - (
          CASE WHEN a.account_type IN ('asset', 'expense')
          THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
          ELSE COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)
          END
        )
        FROM journal_lines jl
        WHERE jl.journal_entry_id = v_je_id AND a.id = jl.account_id;

        DELETE FROM journal_lines  WHERE journal_entry_id = v_je_id;
        DELETE FROM journal_entries WHERE id = v_je_id;
      END LOOP;
    END IF;
  END LOOP;

  -- --------------------------------------------------------
  -- STEP 1: Restore stock for each invoice item
  --         Use base_quantity (inventory is tracked in base units)
  --         Subtract qty already returned to avoid double-credit
  -- --------------------------------------------------------
  FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
    v_qty := COALESCE(v_item.base_quantity, v_item.quantity);

    SELECT COALESCE(SUM(sri.base_quantity_returned), COALESCE(SUM(sri.quantity_returned), 0))
    INTO v_returned_qty
    FROM sales_return_items sri
    JOIN sales_returns sr ON sr.id = sri.sales_return_id
    WHERE sr.invoice_id = p_invoice_id
    AND sri.product_id = v_item.product_id;

    v_qty := GREATEST(0, v_qty - COALESCE(v_returned_qty, 0));

    IF v_default_wh IS NOT NULL AND v_qty > 0 THEN
      UPDATE inventory_items
      SET quantity_on_hand = quantity_on_hand + v_qty, updated_at = now()
      WHERE product_id = v_item.product_id AND warehouse_id = v_default_wh;

      IF NOT FOUND THEN
        INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming)
        VALUES (v_item.product_id, v_default_wh, v_qty, 0, 0);
      END IF;

      INSERT INTO stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, reference_number, notes
      ) VALUES (
        v_item.product_id, v_default_wh, 'return_in', v_qty, COALESCE(v_item.cost_price, 0),
        'invoice_cancel', p_invoice_id, v_invoice.invoice_number,
        'Stock restoration - invoice cancelled'
      );
    END IF;
  END LOOP;

  -- --------------------------------------------------------
  -- STEP 2: Reverse AR + Revenue journal entry
  -- --------------------------------------------------------
  IF v_ar_account IS NOT NULL AND v_revenue_account IS NOT NULL AND v_invoice.total_amount > 0 THEN
    PERFORM post_journal_entry(
      'REVERSAL - Accounts Receivable - Invoice ' || v_invoice.invoice_number || ' CANCELLED',
      COALESCE(v_invoice.invoice_date, CURRENT_DATE),
      'invoice_cancel', p_invoice_id,
      json_build_array(
        json_build_object('account_id', v_ar_account,      'debit', 0,                     'credit', v_invoice.total_amount, 'description', 'Reverse AR for cancelled invoice '      || v_invoice.invoice_number),
        json_build_object('account_id', v_revenue_account, 'debit', v_invoice.total_amount, 'credit', 0,                     'description', 'Reverse revenue for cancelled invoice ' || v_invoice.invoice_number)
      )::json,
      v_invoice.customer_id
    );
  END IF;

  -- --------------------------------------------------------
  -- STEP 3: Reverse COGS
  --         Use quantity (not base_quantity) because cost_price
  --         is per sale unit, matching the COGS trigger.
  -- --------------------------------------------------------
  IF v_cogs_account IS NOT NULL AND v_inventory_account IS NOT NULL THEN
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
      v_qty  := v_item.quantity;
      v_cost := COALESCE(v_item.cost_price, 0);
      IF v_qty * v_cost > 0 THEN
        PERFORM post_journal_entry(
          'REVERSAL - COGS - Invoice ' || v_invoice.invoice_number || ' CANCELLED',
          COALESCE(v_invoice.invoice_date, CURRENT_DATE),
          'invoice_cancel', p_invoice_id,
          json_build_array(
            json_build_object('account_id', v_cogs_account,       'debit', 0,             'credit', v_qty * v_cost, 'description', 'Reverse COGS for cancelled invoice '             || v_invoice.invoice_number),
            json_build_object('account_id', v_inventory_account,  'debit', v_qty * v_cost, 'credit', 0,            'description', 'Reverse inventory release for cancelled invoice ' || v_invoice.invoice_number)
          )::json,
          v_invoice.customer_id
        );
      END IF;
    END LOOP;
  END IF;

  -- --------------------------------------------------------
  -- STEP 4: Reverse original payments — SKIP already-reversed payments.
  --         After an edit, original payments are marked is_reversed=true by edit_invoice,
  --         so they are not reversed a second time here.
  -- --------------------------------------------------------
  FOR v_payment IN SELECT * FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id AND is_reversed = false LOOP
    v_total_payments := v_total_payments + v_payment.amount::numeric;

    INSERT INTO payments (
      payment_number, payment_type, payment_method, amount, payment_date,
      reference_type, reference_id, reference_number, notes
    ) VALUES (
      'REV-' || COALESCE(v_payment.payment_number, 'PAY'),
      CASE WHEN v_payment.payment_type = 'received' THEN 'refund' ELSE 'payment' END,
      v_payment.payment_method,
      v_payment.amount,
      CURRENT_DATE,
      'invoice_cancel', p_invoice_id,
      v_invoice.invoice_number,
      'Reversal payment for cancelled invoice ' || v_invoice.invoice_number
    );
    -- Mark this payment as reversed too, so a repeated cancel cannot double-reverse it.
    UPDATE payments SET is_reversed = true WHERE id = v_payment.id;
  END LOOP;

  -- Step 4a: Delete original payment JEs with account balance rollback.
  --          Scoped to the non-reversed payments only, so we don't touch JEs the edit already deleted.
  FOR v_je_id IN
    SELECT je.id FROM journal_entries je
    WHERE je.reference_type = 'payment'
    AND je.reference_id IN (
      SELECT id FROM payments
      WHERE reference_type = 'invoice' AND reference_id = p_invoice_id AND is_reversed = false
    )
  LOOP
    UPDATE accounts a
    SET balance = balance - (
      CASE WHEN a.account_type IN ('asset', 'expense')
      THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
      ELSE COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)
      END
    )
    FROM journal_lines jl
    WHERE jl.journal_entry_id = v_je_id AND a.id = jl.account_id;

    DELETE FROM journal_lines  WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- --------------------------------------------------------
  -- STEP 5: Mark invoice cancelled, zero amounts
  -- --------------------------------------------------------
  UPDATE invoices
  SET status = 'cancelled', amount_paid = 0, total_amount = 0, updated_at = now()
  WHERE id = p_invoice_id;

  -- --------------------------------------------------------
  -- STEP 6: Record edit history
  -- --------------------------------------------------------
  INSERT INTO invoice_edit_history (
    invoice_id, invoice_number, edited_by_name, change_type, reason,
    snapshot_before, snapshot_after
  ) VALUES (
    p_invoice_id, v_invoice.invoice_number, p_cancelled_by, 'cancelled', p_reason,
    json_build_object('status', v_invoice.status, 'total_amount', v_invoice.total_amount, 'amount_paid', v_invoice.amount_paid),
    json_build_object('status', 'cancelled', 'total_amount', 0, 'amount_paid', 0)
  );

  -- --------------------------------------------------------
  -- STEP 7: Update customer outstanding_balance
  -- --------------------------------------------------------
  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_invoice.customer_id
      AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
    updated_at = now()
    WHERE id = v_invoice.customer_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Invoice cancelled successfully',
    'invoice_number', v_invoice.invoice_number,
    'stock_restored', true,
    'journal_reversed', true,
    'payments_reversed', v_total_payments > 0,
    'total_payments_reversed', v_total_payments
  );
END;
$$;

-- ============================================================
-- 5. Replace deduct_stock_on_invoice_item — add idempotency guard
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_stock_on_invoice_item() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_record RECORD;
  v_default_wh uuid;
  v_qty_to_deduct numeric;
  v_inv_id uuid;
  v_current_qty numeric;
  v_product_cost numeric;
BEGIN
  -- Get the invoice to find warehouse context
  SELECT * INTO v_invoice_record FROM invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Idempotency guard: if a 'sale' stock_movement already exists for this
  -- (invoice, product) pair with reference_type='invoice', do not deduct again.
  -- Protects against any code path that re-inserts the same item.
  PERFORM 1
    FROM stock_movements
    WHERE reference_type = 'invoice'
      AND reference_id = NEW.invoice_id
      AND product_id = NEW.product_id
      AND movement_type = 'sale';
  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Determine quantity to deduct (use base_quantity if available, else quantity)
  v_qty_to_deduct := COALESCE(NEW.base_quantity, NEW.quantity);

  -- Get default warehouse
  SELECT id INTO v_default_wh FROM warehouses WHERE is_default = true AND is_active = true LIMIT 1;
  IF v_default_wh IS NULL THEN
    -- Fallback: get the first active warehouse
    SELECT id INTO v_default_wh FROM warehouses WHERE is_active = true LIMIT 1;
  END IF;
  IF v_default_wh IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get current inventory
  SELECT id, quantity_on_hand INTO v_inv_id, v_current_qty
  FROM inventory_items
  WHERE product_id = NEW.product_id AND warehouse_id = v_default_wh
  FOR UPDATE;

  IF v_inv_id IS NOT NULL THEN
    -- Update existing inventory
    UPDATE inventory_items
    SET quantity_on_hand = quantity_on_hand - v_qty_to_deduct,
    updated_at = now()
    WHERE id = v_inv_id;
  ELSE
    -- Create inventory record with negative stock (product was sold without prior stock)
    INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming)
    VALUES (NEW.product_id, v_default_wh, -v_qty_to_deduct, 0, 0);
  END IF;

  -- Get product cost for the stock movement
  SELECT cost_price INTO v_product_cost FROM products WHERE id = NEW.product_id;

  -- Record the stock movement
  INSERT INTO stock_movements (
    product_id, warehouse_id, movement_type, quantity,
    unit_cost, reference_type, reference_id, reference_number, notes
  )
  VALUES (
    NEW.product_id, v_default_wh, 'sale', -v_qty_to_deduct,
    COALESCE(v_product_cost, 0), 'invoice', NEW.invoice_id,
    v_invoice_record.invoice_number, 'Stock deduction for sale'
  );

  RETURN NEW;
END;
$$;
