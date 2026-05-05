-- Stock issuance RPCs are browser-callable for signed-in users only.
-- Revoke the default PUBLIC execute privilege so anon cannot call these SECURITY DEFINER functions.

REVOKE ALL ON FUNCTION public.get_manual_stock_issuance_history(integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_manual_stock_issuance(integer, numeric, text, text, text, integer, timestamp with time zone)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_stock_issuance(integer, integer, numeric, bigint, text, timestamp with time zone)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_stock_issuance(integer, integer, numeric, bigint, text, timestamp with time zone, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_manual_stock_issuance_history(integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_manual_stock_issuance(integer, numeric, text, text, text, integer, timestamp with time zone)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_stock_issuance(integer, integer, numeric, bigint, text, timestamp with time zone)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_stock_issuance(integer, integer, numeric, bigint, text, timestamp with time zone, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_stock_issuance(bigint, numeric, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
