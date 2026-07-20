-- ============================================================
-- Fix COGS account balance to match sum of journal lines.
-- Previous cleanup migrations (20260719) adjusted balances directly
-- in some cases without posting offsetting journal entries, causing
-- a 132,967 BDT drift between the account balance and the actual
-- journal lines. This recalculates the balance from journal lines.
-- ============================================================

UPDATE accounts 
SET balance = (
  SELECT COALESCE(SUM(COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)), 0)
  FROM journal_lines jl
  WHERE jl.account_id = accounts.id
)
WHERE account_type IN ('asset', 'expense')
  AND id NOT IN ('cc000000-0000-0000-0000-000000000002', 
                 'cc000000-0000-0000-0000-000000000003',
                 'cc000000-0000-0000-0000-000000000004',
                 'cc000000-0000-0000-0000-000000000006');

UPDATE accounts 
SET balance = (
  SELECT COALESCE(SUM(COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)), 0)
  FROM journal_lines jl
  WHERE jl.account_id = accounts.id
)
WHERE account_type IN ('liability', 'equity', 'revenue')
  AND id NOT IN ('cc000000-0000-0000-0000-000000000002', 
                 'cc000000-0000-0000-0000-000000000003',
                 'cc000000-0000-0000-0000-000000000004',
                 'cc000000-0000-0000-0000-000000000006');

-- Verify
SELECT code, name, account_type, balance,
  (SELECT COALESCE(SUM(COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)), 0)
   FROM journal_lines jl WHERE jl.account_id = accounts.id) as sum_of_journal_lines
FROM accounts
WHERE code IN ('5000', '1200', '1100', '4000', '1000')
ORDER BY code;
