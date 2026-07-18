/* Add cart_discount_percent column to invoices so POS cart discount is persisted and editable. */
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cart_discount_percent numeric NOT NULL DEFAULT 0;
