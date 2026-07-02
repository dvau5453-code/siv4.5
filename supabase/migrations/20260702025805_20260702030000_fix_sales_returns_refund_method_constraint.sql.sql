/*
# Fix Sales Returns Refund Method Constraint

## Problem
The sales_returns table only allows 'cash', 'bank_transfer', 'store_credit' as refund_method values.
This doesn't match our actual payment methods (bkash, card, nagad, rocket, cheque, etc).

## Fix
Update the constraint to allow all valid payment method codes.
*/

ALTER TABLE sales_returns DROP CONSTRAINT IF EXISTS sales_returns_refund_method_check;

ALTER TABLE sales_returns ADD CONSTRAINT sales_returns_refund_method_check
  CHECK (refund_method IN ('cash', 'bank_transfer', 'bkash', 'nagad', 'rocket', 'sslcommerz', 'cheque', 'card', 'other', 'store_credit'));