-- Add reference column to invoices and quotations for "Reference" person info
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reference text;
