import { format } from 'date-fns';

export function generateUniqueImageName(productCode: string, originalFilename: string): string {
  // Get timestamp in format YYYYMMDDHHMMSS
  const timestamp = format(new Date(), 'yyyyMMddHHmmss');
  
  // Clean up the original filename
  // Remove file extension, replace spaces and special chars with underscore
  const cleanFilename = originalFilename
    .replace(/\.[^/.]+$/, "") // Remove extension
    .replace(/[^a-zA-Z0-9]/g, "_") // Replace special chars with underscore
    .toLowerCase();
  
  // Get the file extension from original file
  const extension = originalFilename.split('.').pop()?.toLowerCase() || 'jpg';
  
  // Combine all parts
  return `${productCode}_${timestamp}_${cleanFilename}.${extension}`;
}

export function getProductImagePath(productCode: string, filename: string): string {
  return `products/${productCode}/${filename}`;
}

// Example usage:
// const filename = generateUniqueImageName('APOHB', 'Front View.jpg');
// const path = getProductImagePath('APOHB', filename);
// Result: "products/APOHB/APOHB_20240315123456_front_view.jpg" 