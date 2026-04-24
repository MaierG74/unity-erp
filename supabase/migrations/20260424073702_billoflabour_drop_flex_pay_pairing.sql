BEGIN;

ALTER TABLE public.billoflabour
  DROP CONSTRAINT IF EXISTS billoflabour_pay_pairing_flex_chk;

COMMIT;
