-- ============================================================
-- Step 1: Delete ALL erroneous COGS reversal entries for cancelled invoices
-- These entries reversed COGS that was never correctly posted (due to the old
-- per-item trigger bug), and some used base_quantity causing 100x errors.
-- Also reverse their account balance impact.
-- ============================================================

DO $$
DECLARE
  v_je RECORD;
  v_line RECORD;
BEGIN
  FOR v_je IN 
    SELECT DISTINCT je.id 
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.reference_type = 'invoice_cancel'
    AND je.description LIKE '%REVERSAL - COGS%'
    AND a.code IN ('5000', '1200')
  LOOP
    -- Reverse each line's account balance
    FOR v_line IN 
      SELECT account_id, debit, credit FROM journal_lines 
      WHERE journal_entry_id = v_je.id
    LOOP
      UPDATE accounts
      SET balance = CASE
        WHEN account_type IN ('asset', 'expense') THEN balance - v_line.debit + v_line.credit
        WHEN account_type IN ('liability', 'equity', 'revenue') THEN balance - v_line.credit + v_line.debit
        ELSE balance - v_line.debit + v_line.credit
      END
      WHERE id = v_line.account_id;
    END LOOP;
    
    -- Delete lines and entry
    DELETE FROM journal_lines WHERE journal_entry_id = v_je.id;
    DELETE FROM journal_entries WHERE id = v_je.id;
  END LOOP;
END;
$$;

-- ============================================================
-- Step 2: Re-post correct COGS reversal entries for cancelled invoices
-- Use quantity * cost_price (NOT base_quantity * cost_price) since cost_price
-- is the cost per sales unit (e.g., per coil), not per base unit.
-- One journal entry per cancelled invoice with all items as lines.
-- ============================================================

DO $$
DECLARE
  v_inv RECORD;
  v_item RECORD;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_qty numeric;
  v_cost numeric;
  v_cogs_amount numeric;
  v_total_cogs numeric;
  v_lines json[] := '{}';
  v_desc text;
  v_product RECORD;
  v_entry_id uuid;
  v_sort_order integer := 0;
  v_total_debit numeric;
  v_total_credit numeric;
  v_idx integer;
BEGIN
  SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RAISE NOTICE 'COGS or Inventory account not found';
    RETURN;
  END IF;

  FOR v_inv IN
    SELECT * FROM invoices 
    WHERE status = 'cancelled'
    ORDER BY invoice_date, invoice_number
  LOOP
    v_lines := '{}';
    v_total_cogs := 0;
    v_sort_order := 0;

    FOR v_item IN 
      SELECT * FROM invoice_items WHERE invoice_id = v_inv.id 
      ORDER BY sort_order
    LOOP
      -- Use quantity (not base_quantity) since cost_price is per sales unit
      v_qty := v_item.quantity;
      v_cost := COALESCE(v_item.cost_price, 0);
      v_cogs_amount := v_qty * v_cost;

      IF v_cogs_amount > 0 THEN
        SELECT name, sku INTO v_product FROM products WHERE id = v_item.product_id;

        v_desc := 'Reverse COGS: ' || COALESCE(v_product.name, 'Unknown') ||
          ' (SKU: ' || COALESCE(v_product.sku, 'N/A') || ') - Qty: ' || v_qty ||
          ' x Cost: ' || v_cost || ' = ' || v_cogs_amount;

        v_lines := array_append(v_lines, json_build_object(
          'account_id', v_cogs_account, 'debit', 0, 'credit', v_cogs_amount,
          'description', v_desc
        ));
        v_lines := array_append(v_lines, json_build_object(
          'account_id', v_inventory_account, 'debit', v_cogs_amount, 'credit', 0,
          'description', 'Restore inventory: ' || COALESCE(v_product.name, 'item') ||
          ' (Qty: ' || v_qty || ') for cancelled ' || v_inv.invoice_number
        ));

        v_total_cogs := v_total_cogs + v_cogs_amount;
      END IF;
    END LOOP;

    IF v_total_cogs > 0 THEN
      INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, total_debit, total_credit, is_posted, customer_id)
      VALUES (
        get_next_journal_number(),
        COALESCE(v_inv.invoice_date, CURRENT_DATE),
        'REVERSAL - COGS - ' || v_inv.invoice_number || ' CANCELLED (' || array_length(v_lines, 1) / 2 || ' items, total: ' || v_total_cogs || ')',
        'invoice_cancel',
        v_inv.id,
        v_total_cogs,
        v_total_cogs,
        true,
        v_inv.customer_id
      )
      RETURNING id INTO v_entry_id;

      v_total_debit := 0;
      v_total_credit := 0;

      FOR v_idx IN 1..array_length(v_lines, 1) LOOP
        INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, sort_order)
        VALUES (
          gen_random_uuid(),
          v_entry_id,
          (v_lines[v_idx]->>'account_id')::uuid,
          v_lines[v_idx]->>'description',
          COALESCE(CAST(v_lines[v_idx]->>'debit' AS numeric), 0),
          COALESCE(CAST(v_lines[v_idx]->>'credit' AS numeric), 0),
          v_sort_order
        );

        UPDATE accounts
        SET balance = CASE
          WHEN account_type IN ('asset', 'expense') THEN balance + COALESCE(CAST(v_lines[v_idx]->>'debit' AS numeric), 0) - COALESCE(CAST(v_lines[v_idx]->>'credit' AS numeric), 0)
          WHEN account_type IN ('liability', 'equity', 'revenue') THEN balance + COALESCE(CAST(v_lines[v_idx]->>'credit' AS numeric), 0) - COALESCE(CAST(v_lines[v_idx]->>'debit' AS numeric), 0)
          ELSE balance + COALESCE(CAST(v_lines[v_idx]->>'debit' AS numeric), 0) - COALESCE(CAST(v_lines[v_idx]->>'credit' AS numeric), 0)
        END
        WHERE id = (v_lines[v_idx]->>'account_id')::uuid;

        v_total_debit := v_total_debit + COALESCE(CAST(v_lines[v_idx]->>'debit' AS numeric), 0);
        v_total_credit := v_total_credit + COALESCE(CAST(v_lines[v_idx]->>'credit' AS numeric), 0);
        v_sort_order := v_sort_order + 1;
      END LOOP;

      UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit
      WHERE id = v_entry_id;
    END IF;
  END LOOP;
END;
$$;
