-- ============================================================
-- Fix COGS trigger: post per-invoice (all items at once) instead of per-item
-- Root cause: per-item trigger had an invoice-level duplicate check
-- that skipped all items after the first one.
-- ============================================================

-- Drop old triggers
DROP TRIGGER IF EXISTS trg_invoice_items_cogs ON invoice_items;
DROP TRIGGER IF EXISTS trg_invoice_status_cogs ON invoices;

-- Drop old functions
DROP FUNCTION IF EXISTS invoice_items_cogs_trigger();
DROP FUNCTION IF EXISTS invoice_status_cogs_trigger();

-- New function: fires AFTER INSERT on invoice_items
-- Posts COGS only for the specific item (no invoice-level dedup check)
-- Includes product name, SKU, qty, and amount in the description
CREATE OR REPLACE FUNCTION invoice_items_cogs_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_qty numeric;
  v_cost numeric;
  v_cogs_amount numeric;
  v_invoice_record RECORD;
  v_product RECORD;
  v_desc text;
BEGIN
  SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_invoice_record FROM invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Only post COGS for non-draft invoices
  IF v_invoice_record.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Calculate COGS: quantity * cost_price (use base_quantity for multi-unit)
  v_qty := COALESCE(NEW.base_quantity, NEW.quantity);
  v_cost := COALESCE(NEW.cost_price, 0);
  v_cogs_amount := v_qty * v_cost;

  IF v_cogs_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Get product details for the description
  SELECT name, sku INTO v_product FROM products WHERE id = NEW.product_id;

  v_desc := 'COGS: ' || COALESCE(v_product.name, 'Unknown') ||
    ' (SKU: ' || COALESCE(v_product.sku, 'N/A') || ') - Qty: ' || v_qty ||
    ' x Cost: ' || v_cost || ' = ' || v_cogs_amount;

  -- Post: Debit COGS, Credit Inventory (per-item, no dedup check)
  PERFORM post_journal_entry(
    'COGS - ' || v_invoice_record.invoice_number || ' - ' || COALESCE(v_product.name, 'item'),
    COALESCE(v_invoice_record.invoice_date, CURRENT_DATE),
    'invoice',
    NEW.invoice_id,
    json_build_array(
      json_build_object('account_id', v_cogs_account, 'debit', v_cogs_amount, 'credit', 0,
        'description', v_desc),
      json_build_object('account_id', v_inventory_account, 'debit', 0, 'credit', v_cogs_amount,
        'description', 'Inventory released: ' || COALESCE(v_product.name, 'item') ||
        ' (Qty: ' || v_qty || ') for ' || v_invoice_record.invoice_number)
    )::json,
    v_invoice_record.customer_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- New function: fires AFTER UPDATE of status on invoices
-- Posts COGS for all items that were inserted while invoice was draft
-- Includes product details in descriptions
CREATE OR REPLACE FUNCTION invoice_status_cogs_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_item RECORD;
  v_product RECORD;
  v_qty numeric;
  v_cost numeric;
  v_cogs_amount numeric;
  v_total_cogs numeric := 0;
  v_lines json[] := '{}';
  v_desc text;
  v_inv_desc text;
BEGIN
  -- Only fire on status change from draft to non-draft
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status IN ('sent', 'partially_paid', 'paid') THEN
    SELECT id INTO v_cogs_account FROM accounts WHERE code = '5000' LIMIT 1;
    SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

    IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
      RETURN NEW;
    END IF;

    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = NEW.id LOOP
      v_qty := COALESCE(v_item.base_quantity, v_item.quantity);
      v_cost := COALESCE(v_item.cost_price, 0);
      v_cogs_amount := v_qty * v_cost;

      IF v_cogs_amount > 0 THEN
        SELECT name, sku INTO v_product FROM products WHERE id = v_item.product_id;

        v_desc := 'COGS: ' || COALESCE(v_product.name, 'Unknown') ||
          ' (SKU: ' || COALESCE(v_product.sku, 'N/A') || ') - Qty: ' || v_qty ||
          ' x Cost: ' || v_cost || ' = ' || v_cogs_amount;

        v_lines := array_append(v_lines, json_build_object(
          'account_id', v_cogs_account, 'debit', v_cogs_amount, 'credit', 0,
          'description', v_desc
        ));
        v_lines := array_append(v_lines, json_build_object(
          'account_id', v_inventory_account, 'debit', 0, 'credit', v_cogs_amount,
          'description', 'Inventory released: ' || COALESCE(v_product.name, 'item') ||
          ' (Qty: ' || v_qty || ') for ' || NEW.invoice_number
        ));

        v_total_cogs := v_total_cogs + v_cogs_amount;
      END IF;
    END LOOP;

    -- Post single journal entry with all items as separate lines
    IF v_total_cogs > 0 THEN
      v_inv_desc := 'COGS - ' || NEW.invoice_number || ' (' || array_length(v_lines, 1) / 2 || ' items, total: ' || v_total_cogs || ')';
      PERFORM post_journal_entry(
        v_inv_desc,
        COALESCE(NEW.invoice_date, CURRENT_DATE),
        'invoice',
        NEW.id,
        to_json(v_lines),
        NEW.customer_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate triggers
CREATE TRIGGER trg_invoice_items_cogs
  AFTER INSERT ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_cogs_trigger();

CREATE TRIGGER trg_invoice_status_cogs
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_status_cogs_trigger();
