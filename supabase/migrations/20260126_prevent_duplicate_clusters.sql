-- Prevent duplicate clusters at the same position for the same quote item
-- This catches any code path that accidentally creates duplicate clusters

-- First, check if there are any existing violations (there shouldn't be after cleanup)
DO $$
DECLARE
  violation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO violation_count
  FROM (
    SELECT quote_item_id, position, COUNT(*) as cnt
    FROM quote_item_clusters
    GROUP BY quote_item_id, position
    HAVING COUNT(*) > 1
  ) violations;

  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Cannot add constraint: % duplicate position(s) exist. Clean up first.', violation_count;
  END IF;
END $$;

-- Add unique constraint on (quote_item_id, position)
-- This prevents multiple clusters at position 0 (or any position) for the same item
ALTER TABLE quote_item_clusters
ADD CONSTRAINT quote_item_clusters_unique_position
UNIQUE (quote_item_id, position);

-- Add a comment explaining the constraint
COMMENT ON CONSTRAINT quote_item_clusters_unique_position ON quote_item_clusters IS
'Prevents duplicate clusters at the same position. Added after bug where item duplication created duplicate "Costing Cluster" entries.';
