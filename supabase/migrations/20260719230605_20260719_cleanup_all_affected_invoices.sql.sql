/*
# Programmatic cleanup for ALL invoices corrupted by the pre-fix edit/cancel bugs

## Plain-English explanation
The fix migration (20260719_fix_invoice_edit_double_posting.sql) stops NEW
corruption, but many invoices edited BEFORE the fix still carry corrupted data:
- Duplicate `sale` stock_movements from the old manual STEP 9 (Bug 1)
- Excess COGS journal balances from duplicate COGS postings (Bug 2)
- Duplicate REV- payment rows from cancel re-reversing already-reversed payments (Bug 3)

INV-940585 was already cleaned up in the prior migration
(20260719_cleanup_inv940585_corrupted_data.sql). This migration handles ALL
other affected invoices programmatically.

## Approach

### Stock (Bug 1)
For every `sale` stock_movement with ref_type='invoice_edit' and
notes='Stock deduction - invoice edited' (the signature of the old manual STEP 9):
1. Add its quantity back to the corresponding inventory_items.quantity_on_hand
   (reversing the extra deduction).
2. Delete the duplicate stock_movement row.

### COGS (Bug 2)
For each edited invoice where the net COGS balance does not match the expected
COGS (sum of quantity * cost_price from current invoice_items):
- If non-cancelled and discrepancy != 0: post a correcting journal entry
  (credit COGS, debit Inventory) to zero out the excess.
- If cancelled and discrepancy < 0 (excess COGS): post a correcting journal entry
  to zero out the excess.
Cancelled invoices with discrepancy = expected_cogs (net = 0) are correct — no action.

### Payments (Bug 3)
For each (invoice, payment_number) with more than one REV- row:
1. Keep the FIRST reversal row (by created_at).
2. Delete the extra reversal rows.
3. Mark the original (non-REV) payment as is_reversed = true.
Also mark ALL remaining REV- rows as is_reversed = true so no future operation
tries to reverse them again.

## Idempotency
The DO blocks use WHERE clauses that only match rows still needing cleanup.
Re-running affects zero rows once cleanup is complete. Correcting journal entries
are posted with reference_type='cleanup' so they are identifiable and not
double-posted on re-run (guarded by description check).
*/

-- ============================================================
-- 1. STOCK CLEANUP — remove duplicate 'sale' movements from old STEP 9
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_inv uuid;
BEGIN
  FOR r IN
    SELECT sm.id, sm.reference_id, sm.product_id, sm.warehouse_id, sm.quantity
    FROM stock_movements sm
    WHERE sm.reference_type = 'invoice_edit'
      AND sm.movement_type = 'sale'
      AND sm.notes = 'Stock deduction - invoice edited'
    ORDER BY sm.reference_id, sm.product_id
  LOOP
    -- Add the duplicate quantity back to inventory (reversing the extra deduction)
    UPDATE inventory_items
    SET quantity_on_hand = quantity_on_hand + r.quantity, updated_at = now()
    WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;

    -- If no inventory_items row exists, create one (edge case)
    SELECT id INTO v_inv FROM inventory_items
    WHERE product_id = r.product_id AND warehouse_id = r.warehouse_id;
    IF v_inv IS NULL THEN
      INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming)
      VALUES (r.product_id, r.warehouse_id, r.quantity, 0, 0);
    END IF;

    -- Delete the duplicate stock movement
    DELETE FROM stock_movements WHERE id = r.id;
  END LOOP;
END $$;

-- ============================================================
-- 2. COGS CLEANUP — post correcting journal entries for excess COGS
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_cogs_account uuid;
  v_inv_account uuid;
  v_je_exists boolean;
BEGIN
  SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inv_account FROM accounts WHERE code = '1200' LIMIT 1;
  IF v_cogs_account IS NULL OR v_inv_account IS NULL THEN RETURN; END IF;

  FOR r IN
    WITH edited AS (SELECT id, invoice_number, status FROM invoices WHERE edit_count > 0),
    expected AS (
      SELECT i.id as invoice_id, COALESCE(SUM(ii.quantity * COALESCE(ii.cost_price, 0)), 0) as exp_cogs
      FROM edited i LEFT JOIN invoice_items ii ON ii.invoice_id = i.id GROUP BY i.id
    ),
    actual AS (
      SELECT je.reference_id as invoice_id, COALESCE(SUM(jl.debit - jl.credit), 0) as act_cogs
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_id = v_cogs_account AND je.reference_id IN (SELECT id FROM edited)
      GROUP BY je.reference_id
    )
    SELECT i.id, i.invoice_number, i.status, e.exp_cogs, a.act_cogs,
           e.exp_cogs - a.act_cogs as discrepancy
    FROM edited i JOIN expected e ON e.invoice_id = i.id JOIN actual a ON a.invoice_id = i.id
    WHERE (i.status <> 'cancelled' AND e.exp_cogs - a.act_cogs <> 0)
       OR (i.status = 'cancelled' AND e.exp_cogs - a.act_cogs < 0)
  LOOP
    -- The discrepancy is negative when actual COGS is too high (excess).
    -- Correction: credit COGS by abs(discrepancy), debit Inventory by abs(discrepancy).
    -- This reverses the excess COGS and restores the inventory balance.
    v_je_exists := false;
    PERFORM 1 FROM journal_entries
      WHERE reference_type = 'cleanup' AND reference_id = r.id
        AND description = 'CORRECTION - Excess COGS - ' || r.invoice_number;
    IF FOUND THEN v_je_exists := true; END IF;

    IF NOT v_je_exists AND r.discrepancy < 0 THEN
      -- Excess COGS: credit COGS, debit Inventory
      PERFORM post_journal_entry(
        'CORRECTION - Excess COGS - ' || r.invoice_number,
        CURRENT_DATE,
        'cleanup',
        r.id,
        json_build_array(
          json_build_object('account_id', v_inv_account, 'debit', ABS(r.discrepancy), 'credit', 0,
            'description', 'Correct excess COGS from duplicate posting - ' || r.invoice_number),
          json_build_object('account_id', v_cogs_account, 'debit', 0, 'credit', ABS(r.discrepancy),
            'description', 'Reverse duplicate COGS - ' || r.invoice_number)
        )::json,
        NULL, NULL
      );
    ELSIF NOT v_je_exists AND r.discrepancy > 0 AND r.status <> 'cancelled' THEN
      -- Under-posted COGS (rare): debit COGS, credit Inventory
      PERFORM post_journal_entry(
        'CORRECTION - Missing COGS - ' || r.invoice_number,
        CURRENT_DATE,
        'cleanup',
        r.id,
        json_build_array(
          json_build_object('account_id', v_cogs_account, 'debit', r.discrepancy, 'credit', 0,
            'description', 'Post missing COGS - ' || r.invoice_number),
          json_build_object('account_id', v_inv_account, 'debit', 0, 'credit', r.discrepancy,
            'description', 'Release inventory for missing COGS - ' || r.invoice_number)
        )::json,
        NULL, NULL
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 3. PAYMENT CLEANUP — remove duplicate REV- rows and mark originals reversed
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_original_id uuid;
  v_first_id uuid;
  v_count int;
BEGIN
  FOR r IN
    SELECT reference_id, payment_number,
           count(*) as rev_count,
           (array_agg(id ORDER BY created_at))[1] as first_rev_id,
           array_agg(id ORDER BY created_at) as rev_ids
    FROM payments
    WHERE payment_number LIKE 'REV-%'
      AND reference_type IN ('invoice_edit', 'invoice_cancel')
    GROUP BY reference_id, payment_number
    HAVING count(*) > 1
  LOOP
    -- Keep the first REV- row (v_first_rev_id), delete the rest
    v_first_id := r.first_rev_id;

    -- Delete all REV- rows except the first one for this (invoice, payment_number)
    DELETE FROM payments
    WHERE reference_id = r.reference_id
      AND payment_number = r.payment_number
      AND reference_type IN ('invoice_edit', 'invoice_cancel')
      AND id <> v_first_id;

    -- Mark the first REV- row as is_reversed = true
    UPDATE payments SET is_reversed = true WHERE id = v_first_id;

    -- Find and mark the original payment (the one being reversed) as is_reversed = true
    -- The original payment_number is the REV- prefix stripped: 'PAY-996746' from 'REV-PAY-996746'
    -- or 'EDIT-INV-940580' from 'REV-EDIT-INV-940580'
    v_original_id := NULL;
    SELECT id INTO v_original_id
    FROM payments
    WHERE reference_id = r.reference_id
      AND payment_number = substring(r.payment_number from 5)
      AND payment_type IN ('received', 'made')
      AND reference_type = 'invoice'
    LIMIT 1;

    IF v_original_id IS NOT NULL THEN
      UPDATE payments SET is_reversed = true WHERE id = v_original_id;
    END IF;
  END LOOP;

  -- Also mark any standalone REV- rows (no duplicates) as is_reversed = true
  -- so no future operation tries to reverse them again.
  UPDATE payments
  SET is_reversed = true
  WHERE payment_number LIKE 'REV-%'
    AND reference_type IN ('invoice_edit', 'invoice_cancel')
    AND is_reversed = false;
END $$;
