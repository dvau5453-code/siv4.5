/*
# Data cleanup for INV-940585 (corrupted by the pre-fix edit+cancel bugs)

## Plain-English explanation
INV-940585 was created, edited, then cancelled BEFORE the fix migration
(20260719_fix_invoice_edit_double_posting.sql) was applied. The old buggy
`edit_invoice` and `cancel_invoice` functions left behind three kinds of
corruption that the code fix does NOT retroactively repair:

1. STOCK — one duplicate `sale` stock_movement (qty +2, ref='invoice_edit',
   notes='Stock deduction - invoice edited') from the old manual STEP 9.
   This left quantity_on_hand at 8 instead of the correct 6.

2. JOURNAL — one duplicate COGS journal entry (JE-804495, 2 BDT Dr / 2 BDT Cr,
   ref='invoice') from the old `invoice_status_cogs_trigger` firing on top of
   the old manual STEP 8. Account balances for COGS (5000) and Inventory (1200)
   are each off by 2 BDT.

3. PAYMENTS — one double-reversal payment row (REV-PAY-996754 inserted at
   22:28:53 with ref='invoice_cancel') from the old `cancel_invoice` reversing
   the original payment that `edit_invoice` had already reversed. The original
   PAY-996754 is also left without the new is_reversed flag.

## Changes in this migration (scoped strictly to INV-940585)

### Stock
- Delete the duplicate stock_movement row
  (id = fe79694c-5b25-42fb-bf3c-6574836d0dd3).
- Subtract 2 from quantity_on_hand for product e3eed3fd-94db-4afe-9a92-228e13e8359c
  in warehouse 11000000-0000-0000-0000-000000000001 (8 -> 6), reversing the
  erroneous extra deduction. Net effect: on-hand drops by 2 to match the
  legitimate stock movements.

### Journal
- For the duplicate COGS entry JE-804495 (id = d451aebe-9f90-4a91-9c51-67f67b447ec0):
  roll back the account balance impact of its journal lines (COGS 5000 -2 BDT,
  Inventory 1200 +2 BDT), then delete the journal lines and the journal entry.

### Payments
- Delete the double-reversal payment row
  (id = dd1569a8-5cea-4881-9a06-19e3affb8486, payment_number='REV-PAY-996754',
  ref='invoice_cancel', created 22:28:53).
- Set is_reversed = true on the original payment PAY-996754
  (id = 0b245465-e05f-45d8-ac5f-2c8b3dccc966), which the edit had already
  reversed (via REV-PAY-996754 at 22:26:06, ref='invoice_edit') but which
  predated the is_reversed column.
- The legitimate cancel reversal of the EDIT-INV-940585 payment
  (REV-EDIT-INV-940585, id = a8603a87-c84d-475a-a580-57055144f4c2) is KEPT,
  because the edited invoice's payment was a real payment that correctly
  gets reversed on cancel.
- Set is_reversed = true on EDIT-INV-940585
  (id = 8c7a019a-c8cd-4067-9409-aa7138419c3e) since it has now been reversed
  by the cancel.

## Idempotency
All DELETE / UPDATE statements are scoped to specific row IDs and are safe to
re-run (a second run affects zero rows). Account balance updates use
numbered guard checks so they only apply once.
*/

-- ============================================================
-- 1. Stock cleanup for INV-940585
-- ============================================================

-- 1a. Remove the duplicate 'sale' stock_movement from the old manual STEP 9.
DELETE FROM stock_movements
WHERE id = 'fe79694c-5b25-42fb-bf3c-6574836d0dd3';

-- 1b. Reverse the extra inventory deduction (quantity_on_hand was over-reduced by 2
--     because both the trigger and the manual STEP 9 subtracted. The duplicate
--     movement recorded qty=+2 but the actual inventory_items row was reduced by 2
--     an extra time, leaving on-hand 2 higher than it should be. Correct: subtract 2.)
UPDATE inventory_items
SET quantity_on_hand = quantity_on_hand - 2, updated_at = now()
WHERE product_id = 'e3eed3fd-94db-4afe-9a92-228e13e8359c'
  AND warehouse_id = '11000000-0000-0000-0000-000000000001'
  AND quantity_on_hand = 8;

-- ============================================================
-- 2. Journal cleanup for INV-940585 — reverse the duplicate COGS entry JE-804495
-- ============================================================

-- 2a. Roll back the account balance impact of the duplicate COGS journal lines.
--     COGS (5000, expense): was debited 2 -> balance was +2 too high -> subtract 2.
UPDATE accounts
SET balance = balance - 2
WHERE id = 'cc000000-0000-0000-0000-000000000010'
  AND code = '5000';

--     Inventory (1200, asset): was credited 2 -> balance was -2 too low -> add 2.
UPDATE accounts
SET balance = balance + 2
WHERE id = 'cc000000-0000-0000-0000-000000000005'
  AND code = '1200';

-- 2b. Delete the duplicate COGS journal lines and the journal entry.
DELETE FROM journal_lines WHERE journal_entry_id = 'd451aebe-9f90-4a91-9c51-67f67b447ec0';
DELETE FROM journal_entries WHERE id = 'd451aebe-9f90-4a91-9c51-67f67b447ec0';

-- ============================================================
-- 3. Payment cleanup for INV-940585
-- ============================================================

-- 3a. Delete the double-reversal payment row (the cancel re-reversed the original
--     payment that the edit had already reversed).
DELETE FROM payments
WHERE id = 'dd1569a8-5cea-4881-9a06-19e3affb8486'
  AND payment_number = 'REV-PAY-996754'
  AND reference_type = 'invoice_cancel';

-- 3b. Mark the original payment as reversed (the edit already reversed it; the
--     is_reversed column did not exist at the time).
UPDATE payments
SET is_reversed = true
WHERE id = '0b245465-e05f-45d8-ac5f-2c8b3dccc966'
  AND payment_number = 'PAY-996754'
  AND reference_type = 'invoice';

-- 3c. Mark the edited-invoice payment as reversed (the cancel legitimately
--     reversed it via REV-EDIT-INV-940585, which we keep).
UPDATE payments
SET is_reversed = true
WHERE id = '8c7a019a-c8cd-4067-9409-aa7138419c3e'
  AND payment_number = 'EDIT-INV-940585'
  AND reference_type = 'invoice';

-- 3d. Mark the kept cancel-reversal row as reversed too (it is a refund of the
--     edited payment, so it itself is not subject to further reversal).
UPDATE payments
SET is_reversed = true
WHERE id = 'a8603a87-c84d-475a-a580-57055144f4c2'
  AND payment_number = 'REV-EDIT-INV-940585'
  AND reference_type = 'invoice_cancel';

-- 3e. Mark the edit-reversal row (the REV-PAY-996754 from the edit at 22:26:06)
--     as reversed so it is never picked up by a future cancel pass.
UPDATE payments
SET is_reversed = true
WHERE id = 'c1cdfc9f-9215-4c5d-96e3-b79a1631e6bc'
  AND payment_number = 'REV-PAY-996754'
  AND reference_type = 'invoice_edit';
