-- No-op: ambiguity fix was folded into 20260303085548_component_reservation_rpcs.sql
-- Original migration aliased subquery columns to 'cid' to resolve PL/pgSQL RETURNING
-- clause conflicts. The RPCs file already contains the fixed version.
SELECT 1;
