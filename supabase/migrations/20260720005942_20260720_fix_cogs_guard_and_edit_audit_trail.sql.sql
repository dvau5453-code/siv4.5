-- ============================================================
-- Fix 1: Remove idempotency guard from invoice_status_cogs_trigger
-- Same pattern as the stock trigger fix: the guard checked for existing
-- COGS JEs with reference_type='invoice', but after edit the old COGS JE
-- persists while the reversal has ref_type='invoice_edit'. The guard
-- sees the old JE and skips re-posting, leaving COGS reversed but never
-- re-posted.
--
-- Fix: remove the guard. edit_invoice STEP 3 now DELETES the old COGS JEs
-- (with balance rollback) so the trigger fires fresh on STEP 10's
-- draft→active status change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.invoice_status_cogs_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
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
    -- NO idempotency guard — always post COGS on draft→active transition.
    -- edit_invoice deletes old COGS JEs in STEP 3 before setting status='draft',
    -- then this trigger fires fresh when STEP 10 flips status to active.

    SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
    SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

    IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
      RETURN NEW;
    END IF;

    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = NEW.id ORDER BY sort_order LOOP
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
-- Fix 2: Update edit_invoice
--   STEP 1: Remove DELETE of old sale stock_movements — preserve the
--           full audit trail. The stock trigger has no guard, so it
--           fires fresh on re-insert. Old sale movement stays as a
--           historical record.
--   STEP 3: Replace per-item COGS reversal JEs with deletion of original
--           COGS JEs + balance rollback. This cleans stale state so
--           invoice_status_cogs_trigger posts fresh in STEP 10.
-- ============================================================

CREATE OR REPLACE FUNCTION public.edit_invoice(
  p_invoice_id uuid,
  p_new_data json,
  p_reason text DEFAULT NULL::text,
  p_edited_by text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql AS $$
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

  -- STEP 1: Restore stock for old items.
  -- The old 'sale' stock_movement is PRESERVED as an audit record.
  -- The trg_deduct_stock_on_invoice_item trigger has no idempotency guard,
  -- so it fires fresh on re-insert in STEP 6, creating a new sale movement.
  -- Net stock effect: -old_qty (original sale) +old_qty (restore) -new_qty (new sale) = -new_qty.
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

  -- STEP 3: Delete original COGS journal entries and roll back account balances
  -- so invoice_status_cogs_trigger posts fresh in STEP 10 (no stale state).
  -- This replaces the old per-item reversal JE approach which left the original
  -- COGS JE in the table, causing the idempotency guard to skip re-posting.
  FOR v_je_id IN
    SELECT je.id FROM journal_entries je
    WHERE je.reference_type = 'invoice'
      AND je.reference_id = p_invoice_id
      AND je.description LIKE 'COGS%'
  LOOP
    UPDATE accounts a SET balance = balance - (
      CASE WHEN a.account_type IN ('asset', 'expense') THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
      ELSE COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0) END
    )
    FROM journal_lines jl WHERE jl.journal_entry_id = v_je_id AND a.id = jl.account_id;

    DELETE FROM journal_lines WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- STEP 4: Reverse original payments AND mark them as reversed so cancel_invoice skips them
  FOR v_payment IN SELECT * FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id AND is_reversed = false LOOP
    INSERT INTO payments (payment_number, payment_type, payment_method, amount, payment_date, reference_type, reference_id, reference_number, notes)
    VALUES ('REV-' || COALESCE(v_payment.payment_number, 'PAY'), CASE WHEN v_payment.payment_type = 'received' THEN 'refund' ELSE 'payment' END, v_payment.payment_method, v_payment.amount, CURRENT_DATE, 'invoice_edit', p_invoice_id, v_invoice.invoice_number, 'Reversal payment for edited invoice ' || v_invoice.invoice_number);
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

  -- STEP 6: Re-insert items. The trg_deduct_stock_on_invoice_item AFTER INSERT trigger
  --          deducts stock and records a new sale stock_movement (no guard, fires fresh).
  --          The invoice_items_cogs_trigger skips because status='draft' here.
  DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;
  FOR v_i IN SELECT generate_series(0, json_array_length(v_new_items) - 1) LOOP
    v_new_item := v_new_items->v_i;
    INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, discount_percent, tax_rate, subtotal, unit_name, unit_conversion_factor, base_quantity, sort_order)
    VALUES (p_invoice_id, (v_new_item->>'product_id')::uuid, (v_new_item->>'quantity')::numeric, (v_new_item->>'unit_price')::numeric, COALESCE((v_new_item->>'cost_price')::numeric, 0), COALESCE((v_new_item->>'discount_percent')::numeric, 0), 0, (v_new_item->>'quantity')::numeric * (v_new_item->>'unit_price')::numeric * (1 - COALESCE((v_new_item->>'discount_percent')::numeric, 0) / 100), NULLIF(v_new_item->>'unit_name', ''), NULLIF(v_new_item->>'unit_conversion_factor', '')::numeric, COALESCE((v_new_item->>'base_quantity')::numeric, (v_new_item->>'quantity')::numeric), v_i);
  END LOOP;

  -- STEP 7: Re-post AR + Revenue for new total.
  IF v_ar_account IS NOT NULL AND v_revenue_account IS NOT NULL AND v_new_total > 0 THEN
    PERFORM post_journal_entry(
      'AR - Invoice ' || v_invoice.invoice_number || ' EDITED', v_new_date, 'invoice', p_invoice_id,
      json_build_array(
        json_build_object('account_id', v_ar_account, 'debit', v_new_total, 'credit', 0, 'description', 'AR for edited invoice ' || v_invoice.invoice_number),
        json_build_object('account_id', v_revenue_account, 'debit', 0, 'credit', v_new_total, 'description', 'Revenue for edited invoice ' || v_invoice.invoice_number)
      )::json, v_new_customer
    );
  END IF;

  -- STEP 8: Apply new payment term. This status change (draft -> sent/partially_paid/paid)
  --          fires invoice_status_cogs_trigger which posts COGS fresh (no guard, old COGS
  --          JEs were deleted in STEP 3).
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

  -- STEP 9: Record edit history
  SELECT json_build_object('customer_id', v_new_customer, 'invoice_date', v_new_date, 'due_date', v_new_due_date, 'notes', v_new_notes, 'subtotal', v_new_subtotal, 'cart_discount_percent', v_new_cart_discount_percent, 'extra_discount', v_new_extra_discount, 'total_amount', v_new_total, 'payment_term', v_new_payment_term, 'payment_method', v_new_payment_method, 'items', v_new_items) INTO v_new_snapshot;

  INSERT INTO invoice_edit_history (invoice_id, invoice_number, edited_by_name, change_type, reason, snapshot_before, snapshot_after, old_value, new_value)
  VALUES (p_invoice_id, v_invoice.invoice_number, p_edited_by, 'full_edit', p_reason, v_old_snapshot, v_new_snapshot, v_old_snapshot, v_new_snapshot);

  -- STEP 10: Update customer outstanding_balance
  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = (SELECT COALESCE(SUM(balance_due), 0) FROM invoices WHERE customer_id = v_invoice.customer_id AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')), updated_at = now() WHERE id = v_invoice.customer_id;
  END IF;
  IF v_new_customer IS NOT NULL AND v_new_customer <> v_invoice.customer_id THEN
    UPDATE customers SET outstanding_balance = (SELECT COALESCE(SUM(balance_due), 0) FROM invoices WHERE customer_id = v_new_customer AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')), updated_at = now() WHERE id = v_new_customer;
  END IF;

  RETURN json_build_object('success', true, 'invoice_id', p_invoice_id, 'old_total', v_invoice.total_amount, 'new_total', v_new_total);
END;
$$;
