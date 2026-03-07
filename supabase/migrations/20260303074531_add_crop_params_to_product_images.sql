alter table public.product_images
  add column if not exists crop_params jsonb;

comment on column public.product_images.crop_params is
  'Non-destructive crop metadata for product image editing (source-image pixel region + zoom).';
