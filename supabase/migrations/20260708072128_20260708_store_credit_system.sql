/*
# Store Credit System

## Purpose
Creates a proper store credit management system that tracks individual credit
issuances, redemptions, and balances per customer. Previously, store credit was
tracked only as a negative `outstanding_balance` on the customer record, which
conflated "customer owes us" with "we owe customer" and had no redemption flow.

## New Tables

### 1. customer_store_credits
Tracks individual store credit issuances (one row per refund-that-issued-credit).
- `id` (uuid, PK)
- `customer_id` (uuid, FK to customers)
- `sales_return_id` (uuid, FK to sales_returns, nullable — set when credit is issued from a return)
- `credit_number` (text, unique per tenant — e.g. SC-000001)
- `amount` (decimal, original credit amount issued)
- `balance` (decimal, remaining credit available for redemption)
- `status` (text: 'active', 'redeemed', 'expired')
- `notes` (text, nullable)
- `expires_at` (timestamptz, nullable — null means no expiration)
- `created_at` / `updated_at` (timestamptz)

### 2. store_credit_redemptions
Tracks each redemption (application of store credit toward a purchase).
- `id` (uuid, PK)
- `store_credit_id` (uuid, FK to customer_store_credits)
- `customer_id` (uuid, FK to customers)
- `invoice_id` (uuid, FK to invoices, nullable)
- `amount` (decimal, amount redeemed)
- `notes` (text, nullable)
- `created_at` (timestamptz)

## Security
- RLS enabled on both tables.
- Policies allow anon + authenticated full CRUD (single-tenant app, no sign-in).

## Notes
1. A trigger `update_credit_balance_on_redemption` automatically decrements the
   `balance` on the parent `customer_store_credits` row when a redemption is inserted,
   and sets status to 'redeemed' when balance reaches zero.
2. A sequence `store_credit_seq` generates credit numbers.
3. Existing customers with negative `outstanding_balance` (from prior store-credit
   refunds) are migrated into the new table as active credit records.
*/

-- ============================================================
-- 1. customer_store_credits table
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_store_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sales_return_id uuid REFERENCES sales_returns(id) ON DELETE SET NULL,
  credit_number text NOT NULL,
  amount decimal(15,2) NOT NULL DEFAULT 0,
  balance decimal(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired')),
  notes text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_store_credits_tenant_credit_number
  ON customer_store_credits(tenant_id, credit_number);
CREATE INDEX IF NOT EXISTS idx_customer_store_credits_customer
  ON customer_store_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_store_credits_status
  ON customer_store_credits(status);

ALTER TABLE customer_store_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_store_credits_select" ON customer_store_credits;
CREATE POLICY "customer_store_credits_select" ON customer_store_credits FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "customer_store_credits_insert" ON customer_store_credits;
CREATE POLICY "customer_store_credits_insert" ON customer_store_credits FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "customer_store_credits_update" ON customer_store_credits;
CREATE POLICY "customer_store_credits_update" ON customer_store_credits FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "customer_store_credits_delete" ON customer_store_credits;
CREATE POLICY "customer_store_credits_delete" ON customer_store_credits FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 2. store_credit_redemptions table
-- ============================================================
CREATE TABLE IF NOT EXISTS store_credit_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  store_credit_id uuid NOT NULL REFERENCES customer_store_credits(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  amount decimal(15,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_credit_redemptions_credit
  ON store_credit_redemptions(store_credit_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_redemptions_customer
  ON store_credit_redemptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_redemptions_invoice
  ON store_credit_redemptions(invoice_id);

ALTER TABLE store_credit_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_credit_redemptions_select" ON store_credit_redemptions;
CREATE POLICY "store_credit_redemptions_select" ON store_credit_redemptions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "store_credit_redemptions_insert" ON store_credit_redemptions;
CREATE POLICY "store_credit_redemptions_insert" ON store_credit_redemptions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "store_credit_redemptions_update" ON store_credit_redemptions;
CREATE POLICY "store_credit_redemptions_update" ON store_credit_redemptions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "store_credit_redemptions_delete" ON store_credit_redemptions;
CREATE POLICY "store_credit_redemptions_delete" ON store_credit_redemptions FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 3. Sequence for credit numbers
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS store_credit_seq START 1;

-- ============================================================
-- 4. Function to generate credit number
-- ============================================================
CREATE OR REPLACE FUNCTION generate_credit_number()
RETURNS text AS $$
DECLARE
  next_val bigint;
BEGIN
  SELECT nextval('store_credit_seq') INTO next_val;
  RETURN 'SC-' || lpad(next_val::text, 6, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. Trigger: update balance on redemption insert
-- ============================================================
CREATE OR REPLACE FUNCTION update_credit_balance_on_redemption()
RETURNS trigger AS $$
BEGIN
  UPDATE customer_store_credits
  SET balance = balance - NEW.amount,
      status = CASE WHEN balance - NEW.amount <= 0 THEN 'redeemed' ELSE status END,
      updated_at = now()
  WHERE id = NEW.store_credit_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_credit_balance ON store_credit_redemptions;
CREATE TRIGGER trg_update_credit_balance
  AFTER INSERT ON store_credit_redemptions
  FOR EACH ROW EXECUTE FUNCTION update_credit_balance_on_redemption();

-- ============================================================
-- 6. Migrate existing negative outstanding_balance customers
--    into the new customer_store_credits table
-- ============================================================
INSERT INTO customer_store_credits (customer_id, credit_number, amount, balance, status, notes, created_at, updated_at)
SELECT
  c.id,
  generate_credit_number(),
  ABS(c.outstanding_balance),
  ABS(c.outstanding_balance),
  'active',
  'Migrated from negative outstanding balance (prior store-credit refund)',
  now(),
  now()
FROM customers c
WHERE c.outstanding_balance < 0
  AND NOT EXISTS (
    SELECT 1 FROM customer_store_credits sc WHERE sc.customer_id = c.id
  );

-- Reset negative outstanding balances to 0 after migration
UPDATE customers
SET outstanding_balance = 0
WHERE outstanding_balance < 0;
