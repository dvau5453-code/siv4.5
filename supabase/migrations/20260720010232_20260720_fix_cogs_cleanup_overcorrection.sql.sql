-- ============================================================
-- Revert the overcorrection from 20260720_cleanup_cogs_guard_discrepancies.sql
-- and recompute correctly using ALL journal lines on the COGS account
-- (not filtered by description, which missed prior cleanup entries).
-- ============================================================

DO $$
DECLARE
  v_je_id uuid;
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

  -- Step 1: Delete the overcorrected entries and roll back balances
  FOR v_je_id IN
    SELECT id FROM journal_entries WHERE description LIKE 'COGS CORRECTION%'
  LOOP
    -- Roll back account balances
    UPDATE accounts a SET balance = balance - (
      CASE WHEN a.account_type IN ('asset', 'expense') THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
      ELSE COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0) END
    )
    FROM journal_lines jl WHERE jl.journal_entry_id = v_je_id AND a.id = jl.account_id;

    DELETE FROM journal_lines WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- Step 2: Recompute correctly using ALL COGS journal lines (no description filter)
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

    -- Actual net COGS: ALL journal lines on COGS account for this invoice (no description filter)
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) INTO v_actual
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.reference_id = v_rec.id
      AND jl.account_id = v_cogs_account;

    v_diff := v_expected - v_actual;

    IF v_diff <> 0 THEN
      RAISE NOTICE 'Fixing %: expected=%, actual=%, diff=%', v_rec.invoice_number, v_expected, v_actual, v_diff;

      IF v_diff > 0 THEN
        v_lines := json_build_array(
          json_build_object('account_id', v_cogs_account, 'debit', v_diff, 'credit', 0,
            'description', 'COGS correction for ' || v_rec.invoice_number),
          json_build_object('account_id', v_inventory_account, 'debit', 0, 'credit', v_diff,
            'description', 'Inventory correction for ' || v_rec.invoice_number)
        );
      ELSE
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
    ELSE
      RAISE NOTICE 'OK %: net_cogs=% matches expected=%', v_rec.invoice_number, v_actual, v_expected;
    END IF;
  END LOOP;
END;
$$;
