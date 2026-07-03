/*
# Fix post_journal_entry function — replace json_array_extract with -> operator

## Problem
The post_journal_entry function used json_array_extract(json, integer)
which does NOT exist in PostgreSQL. This caused every sale (POS, invoice,
quotation conversion) to fail with:
  "function json_array_extract(json, integer) does not exist"

## Fix
Rewrote the line iteration to use json_array_elements() instead,
which is the correct PostgreSQL function for iterating JSON arrays.
The function signature and behavior are unchanged — only the internal
implementation is fixed.
*/

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_description text,
  p_entry_date date DEFAULT CURRENT_DATE,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_lines json DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line json;
  v_account_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_line_desc text;
  v_sort_order integer := 0;
BEGIN
  IF p_lines IS NULL OR json_array_length(p_lines) = 0 THEN
    RETURN NULL;
  END IF;

  -- Create the journal entry header
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, total_debit, total_credit, is_posted, customer_id, supplier_id)
  VALUES (get_next_journal_number(), p_entry_date, p_description, p_reference_type, p_reference_id, 0, 0, true, p_customer_id, p_supplier_id)
  RETURNING id INTO v_entry_id;

  -- Process each line using json_array_elements (correct PostgreSQL function)
  FOR v_line IN SELECT * FROM json_array_elements(p_lines) LOOP
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit := COALESCE(CAST(v_line->>'debit' AS numeric), 0);
    v_credit := COALESCE(CAST(v_line->>'credit' AS numeric), 0);
    v_line_desc := v_line->>'description';

    INSERT INTO journal_lines (journal_entry_id, account_id, description, debit, credit, sort_order)
    VALUES (v_entry_id, v_account_id, v_line_desc, v_debit, v_credit, v_sort_order);

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;

    -- Update account balance based on account type
    UPDATE accounts
    SET balance = CASE
      WHEN account_type IN ('asset', 'expense') THEN balance + v_debit - v_credit
      WHEN account_type IN ('liability', 'equity', 'revenue') THEN balance + v_credit - v_debit
      ELSE balance + v_debit - v_credit
    END
    WHERE id = v_account_id;

    v_sort_order := v_sort_order + 1;
  END LOOP;

  -- Update totals on the journal entry
  UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;
