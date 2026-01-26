-- Comprehensive cleanup of all duplicate clusters
-- This handles all cases: empty clusters, clusters with lines, etc.
-- Strategy: For each duplicate group, keep the cluster with the earliest ID and merge/delete others

-- Step 1: Move all lines from duplicate clusters to the "keep" cluster
-- The "keep" cluster is the one with the minimum ID for each (quote_item_id, position) pair
UPDATE quote_cluster_lines qcl
SET cluster_id = keep_clusters.keep_id
FROM quote_item_clusters qc_source
JOIN (
  SELECT DISTINCT ON (qc.quote_item_id, qc.position)
    qc.quote_item_id,
    qc.position,
    qc.id as keep_id
  FROM quote_item_clusters qc
  WHERE EXISTS (
    SELECT 1 
    FROM quote_item_clusters qc2 
    WHERE qc2.quote_item_id = qc.quote_item_id 
      AND qc2.position = qc.position 
      AND qc2.id != qc.id
  )
  ORDER BY qc.quote_item_id, qc.position, qc.id
) keep_clusters ON keep_clusters.quote_item_id = qc_source.quote_item_id 
  AND keep_clusters.position = qc_source.position
WHERE qcl.cluster_id = qc_source.id
  AND qc_source.id != keep_clusters.keep_id
  AND EXISTS (
    SELECT 1 
    FROM quote_item_clusters qc2 
    WHERE qc2.quote_item_id = qc_source.quote_item_id 
      AND qc2.position = qc_source.position 
      AND qc2.id != qc_source.id
  );

-- Step 2: Delete all duplicate clusters (keeping only the one with minimum ID)
DELETE FROM quote_item_clusters qc
WHERE EXISTS (
  SELECT 1 
  FROM quote_item_clusters qc2 
  WHERE qc2.quote_item_id = qc.quote_item_id 
    AND qc2.position = qc.position 
    AND qc2.id != qc.id
)
AND qc.id NOT IN (
  SELECT DISTINCT ON (qc3.quote_item_id, qc3.position)
    qc3.id
  FROM quote_item_clusters qc3
  WHERE EXISTS (
    SELECT 1 
    FROM quote_item_clusters qc4 
    WHERE qc4.quote_item_id = qc3.quote_item_id 
      AND qc4.position = qc3.position 
      AND qc4.id != qc3.id
  )
  ORDER BY qc3.quote_item_id, qc3.position, qc3.id
);

-- Verification: Should return 0 rows
-- SELECT quote_item_id, position, COUNT(*) as cnt
-- FROM quote_item_clusters
-- GROUP BY quote_item_id, position
-- HAVING COUNT(*) > 1;
