-- Create product_images table
CREATE TABLE IF NOT EXISTS product_images (
  image_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  alt_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- Create function to ensure only one primary image per product
CREATE OR REPLACE FUNCTION ensure_one_primary_image() 
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = TRUE THEN
    UPDATE product_images 
    SET is_primary = FALSE 
    WHERE product_id = NEW.product_id AND image_id != NEW.image_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to manage primary images
CREATE TRIGGER set_primary_image
BEFORE INSERT OR UPDATE ON product_images
FOR EACH ROW
EXECUTE FUNCTION ensure_one_primary_image();

-- Add example comment on how to use the table
COMMENT ON TABLE product_images IS 'Stores images for products, with support for multiple images per product and designation of a primary image';

-- Add comment explaining trigger
COMMENT ON FUNCTION ensure_one_primary_image() IS 'Ensures only one image can be marked as primary for each product'; 