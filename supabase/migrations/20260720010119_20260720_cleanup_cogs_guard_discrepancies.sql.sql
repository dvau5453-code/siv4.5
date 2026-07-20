-- ============================================================
-- Cleanup: Fix COGS discrepancies for invoices affected by the
-- idempotency guard bug in invoice_status_cogs_trigger.
--
-- For cancelled invoices: net COGS should be 0 (all reversed).
-- For active invoices (sent/paid): net COGS should match sum of
--   quantity * cost_price from current invoice_items.
-- ============================================================

DO $$
DECLARE
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_rec RECORD;
  v_expected numeric;
  v_actual numeric;
  v_diff numeric;
  v_lines json;
BEGIN
  SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RAISE NOTICE 'COGS or Inventory account not found, skipping cleanup';
    RETURN;
  END IF;

  FOR v_rec IN
    SELECT DISTINCT i.id, i.invoice_number, i.status, i.customer_id
    FROM invoices i
    JOIN journal_entries je ON je.reference_id = i.id
    WHERE je.description LIKE 'REVERSAL - COGS%' AND je.reference_type = 'invoice_edit'
  LOOP
    -- Expected COGS: 0 for cancelled, else sum from current items
    IF v_rec.status = 'cancelled' THEN
      v_expected := 0;
    ELSE
      SELECT COALESCE(SUM(quantity * cost_price), 0) INTO v_expected
      FROM invoice_items WHERE invoice_id = v_rec.id;
    END IF;

    -- Actual net COGS posted (debit - credit on COGS account)
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_actual
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.reference_id = v_rec.id
      AND jl.account_id = v_cogs_account
      AND (je.description LIKE 'COGS%' OR je.description LIKE 'REVERSAL - COGS%');

    v_diff := v_expected - v_actual;

    IF v_diff <> 0 THEN
      RAISE NOTICE 'Fixing %: expected=%, actual=%, diff=%', v_rec.invoice_number, v_expected, v_actual, v_diff;

      IF v_diff > 0 THEN
        -- Need more COGS: debit COGS, credit Inventory
        v_lines := json_build_array(
          json_build_object('account_id', v_cogs_account, 'debit', v_diff, 'credit', 0,
            'description', 'COGS correction for ' || v_rec.invoice_number),
          json_build_object('account_id', v_inventory_account, 'debit', 0, 'credit', v_diff,
            'description', 'Inventory correction for ' || v_rec.invoice_number)
        );
      ELSE
        -- Need less COGS: credit COGS, debit Inventory
        v_lines := json_build_array(
          json_build_object('account_id', v_cogs_account, 'debit', 0, 'credit', ABS(v_diff),
            'description', 'COGS correction for ' || v_rec.invoice_number),
          json_build_object('account_id', v_inventory_account, 'debit', ABS(v_diff), 'credit', 0,
            'description', 'Inventory correction for ' || v_rec.invoice_number)
        );
      END IF;

      PERFORM post_journal_entry(
        'COGS CORRECTION - ' || v_rec.invoice_number || ' (fix guard bug discrepancy)',
        CURRENT_DATE,
        'cleanup',
        v_rec.id,
        v_lines,
        v_rec.customer_id
      );
    END IF;
  END LOOP;
END;
$$;
