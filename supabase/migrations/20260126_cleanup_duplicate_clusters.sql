-- Migration: Clean up duplicate clusters created by the duplicate item bug
-- Quote ID: 41c6e6f7-774f-48c3-b6f8-6d9149a11cf2
-- Date: 2026-01-26
--
-- ROLLBACK INSTRUCTIONS (if needed):
-- The backup data is preserved in comments below. To restore:
-- 1. Re-create the deleted clusters
-- 2. Move lines back to their original clusters
-- 3. Update line quantities if they were modified

-- ============================================
-- BACKUP DATA (for rollback if needed)
-- ============================================
--
-- 2700mm table (d0721ccc-0cf5-4e8f-a62c-19f2274d3e19):
--   - Empty cluster to delete: 934f9653-df9f-4a27-a107-b366ac4913da (no lines)
--   - Keep cluster: 52337ec0-96cc-4110-8f06-8721084eadff (11 lines)
--
-- 3500mm table (bcfc2bda-8955-406d-8bb0-06c6eac71892):
--   - Keep cluster: 94c5f3a2-784b-4970-880f-3338729dab1e
--     Original lines: MELAMINE SHEET(2.3), BACKER BOARD(1.8), EDGE BANDING 16mm(27.6), EDGE BANDING 32mm(19)
--   - Delete cluster: e4f9381c-1f26-47e0-bde3-cf9c321eb97b
--     Lines to move: Adjuster M8(12), Grommets(12), Cut and edge(18), Shaping(2), Hand edging(4), QC and Wrapping(2), Box Base labour(3)

-- ============================================
-- CLEANUP OPERATIONS
-- ============================================

-- Step 1: Move lines from second cluster to first cluster for 3500mm table
UPDATE quote_cluster_lines
SET cluster_id = '94c5f3a2-784b-4970-880f-3338729dab1e'
WHERE cluster_id = 'e4f9381c-1f26-47e0-bde3-cf9c321eb97b';

-- Step 2: Delete the now-empty second cluster for 3500mm table
DELETE FROM quote_item_clusters
WHERE id = 'e4f9381c-1f26-47e0-bde3-cf9c321eb97b';

-- Step 3: Delete the empty first cluster for 2700mm table
DELETE FROM quote_item_clusters
WHERE id = '934f9653-df9f-4a27-a107-b366ac4913da';

-- ============================================
-- VERIFICATION QUERY (run after migration)
-- ============================================
-- SELECT qi.description, COUNT(qc.id) as cluster_count
-- FROM quote_items qi
-- JOIN quote_item_clusters qc ON qc.quote_item_id = qi.id
-- WHERE qi.quote_id = '41c6e6f7-774f-48c3-b6f8-6d9149a11cf2'
-- GROUP BY qi.id, qi.description
-- ORDER BY qi.description;
-- Expected: Each item should have exactly 1 cluster
