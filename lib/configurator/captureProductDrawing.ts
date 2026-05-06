import { supabase } from '@/lib/supabase';

const DRAWING_BUCKET = 'QButton';

export function productDrawingStoragePath(productId: number, uuid: string): string {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error('productId must be a positive integer');
  }
  return `Product Drawings/${productId}/${uuid}.png`;
}

export async function captureAndUploadProductDrawing(node: HTMLElement, productId: number): Promise<string> {
  const { toPng } = await import('dom-to-image-more');
  const dataUrl = await toPng(node, {
    cacheBust: true,
    bgcolor: '#ffffff',
    pixelRatio: 2,
  });
  const blob = await (await fetch(dataUrl)).blob();
  const path = productDrawingStoragePath(productId, crypto.randomUUID());

  const { error: uploadError } = await supabase.storage
    .from(DRAWING_BUCKET)
    .upload(path, blob, { upsert: false, contentType: 'image/png' });

  if (uploadError) {
    throw new Error(`Failed to upload product drawing: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(DRAWING_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) {
    throw new Error('Failed to get public URL for product drawing');
  }

  const { error: updateError } = await supabase
    .from('products')
    .update({ configurator_drawing_url: data.publicUrl })
    .eq('product_id', productId);

  if (updateError) {
    throw new Error(`Failed to persist drawing URL: ${updateError.message}`);
  }

  return data.publicUrl;
}
