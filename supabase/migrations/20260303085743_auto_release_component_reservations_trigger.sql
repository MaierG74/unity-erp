-- Auto-release component reservations when an order is Completed or Cancelled.
CREATE OR REPLACE FUNCTION public.auto_release_component_reservations()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status_id IN (
    SELECT status_id FROM public.order_statuses
    WHERE status_name IN ('Completed', 'Cancelled')
  ) AND OLD.status_id <> NEW.status_id THEN
    DELETE FROM public.component_reservations WHERE order_id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_auto_release_component_reservations
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_release_component_reservations();
