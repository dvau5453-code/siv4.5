/*
# Final payment cleanup — fix remaining is_reversed flags and one missing reversal

## Plain-English explanation
After the bulk cleanup, two residual payment issues remain:

1. 7 original/edited payments for cancelled invoices were actually reversed by
   cancel (a REV- row with ref_type='invoice_cancel' exists), but the original
   payment rows were never marked is_reversed=true. This is a cosmetic fix —
   setting the flag so future operations don't try to reverse them again.

2. INV-940530 (28cfb0cd-...) was edited twice, creating two EDIT-PAY-28cfb0cd
   payments (amount 0 and amount 4). The cancel only reversed the 0-amount one
   (REV-EDIT-PAY-28cfb0cd amount 0). The 4-amount payment was never reversed,
   leaving a net payment of +4 on a cancelled invoice. This creates the missing
   reversal and marks the original as reversed.

## Idempotency
All UPDATEs are guarded by is_reversed = false. The missing reversal INSERT is
guarded by a NOT EXISTS check.
*/

-- ============================================================
-- 1. Mark the 7 originals as is_reversed=true (they were already reversed by cancel)
-- ============================================================
UPDATE payments p
SET is_reversed = true
WHERE p.payment_number NOT LIKE 'REV-%'
  AND p.reference_type = 'invoice'
  AND p.is_reversed = false
  AND EXISTS (
    SELECT 1 FROM payments rev
    WHERE rev.reference_id = p.reference_id
      AND rev.payment_number = 'REV-' || p.payment_number
      AND rev.reference_type = 'invoice_cancel'
  )
  AND p.reference_id IN (SELECT id FROM invoices WHERE edit_count > 0 AND status = 'cancelled');

-- ============================================================
-- 2. Create the missing reversal for INV-940530's second EDIT-PAY-28cfb0cd (4 BDT)
--    and mark it as reversed.
-- ============================================================
INSERT INTO payments (payment_number, payment_type, payment_method, amount, payment_date,
                      reference_type, reference_id, reference_number, notes, is_reversed)
SELECT 'REV-EDIT-PAY-28cfb0cd', 'refund', 'cash', p.amount, CURRENT_DATE,
       'invoice_cancel', p.reference_id, 'INV-940530',
       'Missing reversal for second edit payment - cleanup correction', true
FROM payments p
WHERE p.id = 'bf736aea-d325-477c-9ea1-93fcb1a48ff3'
  AND p.payment_number = 'EDIT-PAY-28cfb0cd'
  AND p.amount = 4
  AND p.is_reversed = false
  AND NOT EXISTS (
    SELECT 1 FROM payments rev
    WHERE rev.reference_id = p.reference_id
      AND rev.payment_number = 'REV-EDIT-PAY-28cfb0cd'
      AND rev.reference_type = 'invoice_cancel'
      AND rev.amount = 4
  );

-- Mark the original 4-amount payment as reversed
UPDATE payments
SET is_reversed = true
WHERE id = 'bf736aea-d325-477c-9ea1-93fcb1a48ff3'
  AND payment_number = 'EDIT-PAY-28cfb0cd'
  AND amount = 4
  AND is_reversed = false;
