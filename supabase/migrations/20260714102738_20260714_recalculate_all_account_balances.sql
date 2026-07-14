-- ============================================================
-- Recalculate ALL account balances from journal lines
-- The stored balances are stale and inconsistent with actual journal entries.
-- This resets every account balance to the correct computed value.
-- ============================================================

DO $$
DECLARE
  v_account RECORD;
  v_computed numeric;
BEGIN
  FOR v_account IN SELECT id, account_type FROM accounts LOOP
    SELECT 
      CASE
        WHEN v_account.account_type IN ('asset', 'expense') THEN
          COALESCE(SUM(COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)), 0)
        WHEN v_account.account_type IN ('liability', 'equity', 'revenue') THEN
          COALESCE(SUM(COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)), 0)
        ELSE
          COALESCE(SUM(COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)), 0)
      END
    INTO v_computed
    FROM journal_lines jl
    WHERE jl.account_id = v_account.id;
    
    UPDATE accounts SET balance = v_computed WHERE id = v_account.id;
  END LOOP;
END;
$$;
