import { supabase } from '@/lib/supabase';

const DRAWING_BUCKET = 'QButton';
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function validateImageFile(file: File): void {
  const ext = getFileExtension(file.name);
  if (!ALLOWED_MIME_TYPES.has(file.type) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('PNG or JPEG required');
  }
}

export function bolDrawingStoragePath(bolId: number, uuid: string, ext: string): string {
  if (!Number.isInteger(bolId) || bolId <= 0) {
    throw new Error('bolId must be a positive integer');
  }
  const normalizedExt = ext.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(normalizedExt)) {
    throw new Error('PNG or JPEG required');
  }
  return `BOL Drawings/${bolId}/${uuid}.${normalizedExt}`;
}

export async function uploadBolDrawing(file: File, bolId: number): Promise<string> {
  validateImageFile(file);
  const ext = getFileExtension(file.name);
  const path = bolDrawingStoragePath(bolId, crypto.randomUUID(), ext);

  const { error: uploadError } = await supabase.storage
    .from(DRAWING_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (uploadError) {
    throw new Error(`Failed to upload BOL drawing: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(DRAWING_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) {
    throw new Error('Failed to get public URL for BOL drawing');
  }
  return data.publicUrl;
}
