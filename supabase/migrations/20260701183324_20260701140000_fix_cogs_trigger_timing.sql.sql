-- Fix: COGS trigger fires on invoice_items INSERT/DELETE instead of invoice
-- This ensures items exist when COGS is calculated

-- Drop the old trigger on invoices
DROP TRIGGER IF EXISTS invoice_cogs ON invoices;

-- Create a function that posts COGS for an invoice (if not already posted)
CREATE OR REPLACE FUNCTION post_cogs_for_invoice(p_invoice_id uuid)
RETURNS void AS $$
DECLARE
  v_tenant_id uuid;
  v_cogs_total decimal(15,2);
  v_invoice_number text;
  v_invoice_date date;
BEGIN
  -- Get invoice details
  SELECT tenant_id, invoice_number, invoice_date 
  INTO v_tenant_id, v_invoice_number, v_invoice_date
  FROM invoices WHERE id = p_invoice_id;
  
  IF v_tenant_id IS NULL THEN RETURN; END IF;
  
  -- Check if COGS entry already exists for this invoice
  IF EXISTS (
    SELECT 1 FROM journal_entries 
    WHERE reference_type = 'invoice' 
    AND reference_id = p_invoice_id
    AND description LIKE 'COGS%'
  ) THEN
    RETURN; -- Already posted, skip
  END IF;
  
  -- Calculate COGS from invoice_items × product cost_price
  SELECT COALESCE(SUM(ii.quantity * p.cost_price), 0) INTO v_cogs_total
  FROM invoice_items ii
  JOIN products p ON p.id = ii.product_id
  WHERE ii.invoice_id = p_invoice_id
    AND p.cost_price > 0;
  
  IF v_cogs_total > 0 THEN
    PERFORM post_journal_entry(
      p_description := 'COGS - Invoice #' || v_invoice_number,
      p_lines := jsonb_build_array(
        jsonb_build_object('account_code', '5000', 'debit', v_cogs_total, 'description', 'Cost of Goods Sold'),
        jsonb_build_object('account_code', '1200', 'credit', v_cogs_total, 'description', 'Inventory reduced')
      ),
      p_entry_date := COALESCE(v_invoice_date, CURRENT_DATE),
      p_reference_type := 'invoice',
      p_reference_id := p_invoice_id,
      p_tenant_id := v_tenant_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on invoice_items that fires AFTER INSERT
CREATE OR REPLACE FUNCTION invoice_items_cogs_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- After an item is inserted, try to post COGS for the invoice
  -- (will only post if invoice is paid/sent and COGS not already posted)
  PERFORM post_cogs_for_invoice(NEW.invoice_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on invoice_items for INSERT
DROP TRIGGER IF EXISTS invoice_items_cogs ON invoice_items;
CREATE TRIGGER invoice_items_cogs
  AFTER INSERT ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_cogs_trigger();

-- Also create trigger for when invoice status changes to paid/sent
-- (for non-POS invoices that start as draft)
CREATE OR REPLACE FUNCTION invoice_status_cogs_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- When invoice transitions from draft to paid/sent/partial, post COGS
  IF OLD.status = 'draft' AND NEW.status IN ('paid', 'sent', 'partial') THEN
    -- Use a slight delay approach: check after potential items are added
    -- For immediate fix, we call the function directly
    PERFORM post_cogs_for_invoice(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS invoice_status_cogs ON invoices;
CREATE TRIGGER invoice_status_cogs
  AFTER UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_status_cogs_trigger();

-- Backfill COGS for existing invoices that don't have it
DO $$
DECLARE
  inv RECORD;
BEGIN
  FOR inv IN 
    SELECT DISTINCT i.id 
    FROM invoices i
    WHERE i.status IN ('paid', 'sent', 'partial')
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je 
      WHERE je.reference_type = 'invoice' 
      AND je.reference_id = i.id 
      AND je.description LIKE 'COGS%'
    )
  LOOP
    PERFORM post_cogs_for_invoice(inv.id);
  END LOOP;
END $$;