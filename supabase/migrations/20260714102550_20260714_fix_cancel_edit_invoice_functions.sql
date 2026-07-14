-- ============================================================
-- Fix cancel_invoice and edit_invoice functions to use quantity
-- instead of base_quantity for COGS calculations.
-- We use a DO block to extract the function source, replace
-- 'COALESCE(v_item.base_quantity, v_item.quantity)' with 'v_item.quantity'
-- and 'COALESCE(NEW.base_quantity, NEW.quantity)' with 'NEW.quantity'
-- and recreate the functions.
-- ============================================================

DO $$
DECLARE
  v_src text;
  v_new_src text;
BEGIN
  -- Fix cancel_invoice
  SELECT pg_get_functiondef(oid) INTO v_src FROM pg_proc WHERE proname = 'cancel_invoice';
  
  -- Replace the COGS calculation: use quantity instead of base_quantity
  v_new_src := replace(v_src, 'COALESCE(v_item.base_quantity, v_item.quantity)', 'v_item.quantity');
  -- Also handle the stock restoration line
  v_new_src := replace(v_new_src, 'COALESCE(v_item.base_quantity, v_item.quantity)', 'v_item.quantity');
  
  -- Remove the function definition wrapper to get just the body
  -- Actually, pg_get_functiondef returns a full CREATE OR REPLACE FUNCTION statement
  -- We can just execute it after the replacement
  -- But we need to handle the $function$ delimiters
  v_new_src := replace(v_new_src, 'COALESCE(v_item.base_quantity, v_item.quantity)', 'v_item.quantity');
  
  EXECUTE v_new_src;
  
  RAISE NOTICE 'cancel_invoice fixed';
  
  -- Fix edit_invoice
  SELECT pg_get_functiondef(oid) INTO v_src FROM pg_proc WHERE proname = 'edit_invoice';
  
  -- Replace all base_quantity references with quantity
  v_new_src := replace(v_src, 'COALESCE(v_item.base_quantity, v_item.quantity)', 'v_item.quantity');
  v_new_src := replace(v_new_src, 'COALESCE(NEW.base_quantity, NEW.quantity)', 'NEW.quantity');
  v_new_src := replace(v_new_src, 'COALESCE(v_old_item.base_quantity, v_old_item.quantity)', 'v_old_item.quantity');
  
  EXECUTE v_new_src;
  
  RAISE NOTICE 'edit_invoice fixed';
END;
$$;
