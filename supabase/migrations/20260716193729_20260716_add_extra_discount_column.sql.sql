/*
# Add extra_discount column to invoices and quotations

1. Changes
- Adds `extra_discount` (numeric, default 0) to the `invoices` table.
  This stores a flat-amount discount applied after percentage-based item discounts.
  The frontend computes `total_amount = subtotal - discount_amount - extra_discount`,
  so the existing generated column `balance_due = total_amount - amount_paid` stays correct.
- Adds `extra_discount` (numeric, default 0) to the `quotations` table for the same purpose.

2. Security
- No RLS policy changes — existing policies cover the new column automatically.

3. Notes
- The column is nullable-safe with a default of 0 so existing rows are unaffected.
- No triggers need updating because `total_amount` is set by the application, not by a trigger.
*/

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS extra_discount numeric DEFAULT 0;

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS extra_discount numeric DEFAULT 0;
