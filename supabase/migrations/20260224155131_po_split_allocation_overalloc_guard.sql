-- Migration: PO Split Allocation Over-Allocation Guard
-- Date: February 24, 2026
-- Description: Ensures the over-allocation guard (alloc_sum > line_qty) is present
-- in both create_purchase_order_with_lines and add_lines_to_purchase_order RPCs.
-- This content is identical to 20260224082415_po_split_quantity_allocations.sql
-- which already includes the guards. Applied as a separate migration step for
-- explicit auditability of the guard addition.

-- No-op: guards are already embedded in the RPC functions created by
-- 20260224082415_po_split_quantity_allocations.sql.
-- This migration exists to match the DB migration history entry.
SELECT 1;
