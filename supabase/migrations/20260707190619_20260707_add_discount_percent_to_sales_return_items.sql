/*
# Add discount_percent to sales_return_items

1. Changes
- Add `discount_percent` column to `sales_return_items` table (NUMERIC(5,2), default 0).
  This mirrors the `discount_percent` column on `invoice_items` so that per-line
  discounts applied at sale time are preserved and reflected in refund calculations.
2. Security
- No RLS policy changes. Existing policies on `sales_return_items` remain in effect.
3. Notes
- The column is nullable-safe with a default of 0, so existing rows backfill cleanly.
- Frontend sales-returns flow will now read `discount_percent` from the source
  `invoice_items` row and persist it on the returned item, and the refund subtotal
  will be computed as `qty * unit_price * (1 - discount_percent / 100)`.
*/

ALTER TABLE sales_return_items
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
