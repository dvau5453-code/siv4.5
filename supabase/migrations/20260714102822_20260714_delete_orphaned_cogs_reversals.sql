-- ============================================================
-- Delete orphaned COGS reversal entries for cancelled invoices
-- The previous backfill deleted all old COGS entries and re-posted
-- only for active invoices. But the reversal entries for cancelled
-- invoices are still present, crediting COGS that was never debited.
-- These reversal entries need to be deleted and their account balance
-- impact reversed.
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
