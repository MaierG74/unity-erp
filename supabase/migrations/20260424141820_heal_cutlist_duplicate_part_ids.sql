-- Heal duplicate part.id values inside product_cutlist_groups.parts JSONB.
-- For each group, scan parts in order; the first occurrence of an id keeps it,
-- subsequent occurrences get a fresh UUID. Idempotent: re-running finds no work.

CREATE OR REPLACE FUNCTION _tmp_heal_cutlist_dup_part_ids() RETURNS TABLE (
  group_id bigint,
  rewritten_count int
) AS $func$
DECLARE
  r RECORD;
  new_parts jsonb;
  seen_ids text[];
  part jsonb;
  pid text;
  rewrites int;
BEGIN
  FOR r IN
    SELECT g.id, g.parts
    FROM product_cutlist_groups g
    WHERE jsonb_typeof(g.parts) = 'array'
  LOOP
    new_parts := '[]'::jsonb;
    seen_ids := ARRAY[]::text[];
    rewrites := 0;

    FOR part IN SELECT * FROM jsonb_array_elements(r.parts) LOOP
      pid := part ->> 'id';
      IF pid IS NULL OR pid = '' OR pid = ANY (seen_ids) THEN
        pid := gen_random_uuid()::text;
        part := jsonb_set(part, '{id}', to_jsonb(pid));
        rewrites := rewrites + 1;
      END IF;
      seen_ids := array_append(seen_ids, pid);
      new_parts := new_parts || part;
    END LOOP;

    IF rewrites > 0 THEN
      UPDATE product_cutlist_groups
         SET parts = new_parts
       WHERE id = r.id;
      group_id := r.id;
      rewritten_count := rewrites;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$func$ LANGUAGE plpgsql;

-- Run the heal and log results. If RAISE NOTICE output is noisy, remove the loop.
DO $$
DECLARE
  rec RECORD;
  total_groups int := 0;
  total_rewrites int := 0;
BEGIN
  FOR rec IN SELECT * FROM _tmp_heal_cutlist_dup_part_ids() LOOP
    total_groups := total_groups + 1;
    total_rewrites := total_rewrites + rec.rewritten_count;
    RAISE NOTICE 'Rewrote % part ids in group %', rec.rewritten_count, rec.group_id;
  END LOOP;
  RAISE NOTICE 'Heal complete: % groups, % part ids rewritten', total_groups, total_rewrites;
END
$$;

DROP FUNCTION _tmp_heal_cutlist_dup_part_ids();
