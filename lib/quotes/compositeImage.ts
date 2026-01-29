import type { CropParams, ArrowAnnotation, ImageDisplaySize } from '@/types/image-editor';
import { IMAGE_SIZE_MAP } from '@/types/image-editor';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  ann: ArrowAnnotation,
  w: number,
  h: number,
) {
  const color = ann.color || '#FF0000';
  const x1 = ann.x1 * w;
  const y1 = ann.y1 * h;
  const x2 = ann.x2 * w;
  const y2 = ann.y2 * h;

  const headLen = Math.max(10, Math.min(w, h) * 0.04);
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();

  if (ann.label) {
    // Use custom label position if set, otherwise default to arrow midpoint
    const lx = ann.labelX != null ? ann.labelX * w : (x1 + x2) / 2;
    const ly = ann.labelY != null ? ann.labelY * h : (y1 + y2) / 2 - 16;

    const fontSize = Math.max(12, Math.min(w, h) * 0.05);
    ctx.font = `bold ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Background pill
    const metrics = ctx.measureText(ann.label);
    const padX = fontSize * 0.4;
    const padY = fontSize * 0.3;
    const boxW = metrics.width + padX * 2;
    const boxH = fontSize + padY * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(lx - boxW / 2, ly - boxH / 2, boxW, boxH, 4);
    ctx.fill();

    // White text
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(ann.label, lx, ly);
  }
}

/**
 * Composites an image with crop and annotation data into a data URL.
 * Runs client-side using an offscreen canvas.
 */
export async function compositeImage(
  imageUrl: string,
  cropParams: CropParams | null,
  annotations: ArrowAnnotation[] | null,
  outputWidth: number,
  outputHeight: number,
): Promise<string> {
  const img = await loadImage(imageUrl);

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d')!;

  // Determine source dimensions (cropped region or full image)
  const srcW = cropParams ? cropParams.width : img.naturalWidth;
  const srcH = cropParams ? cropParams.height : img.naturalHeight;

  // Fit source into output canvas preserving aspect ratio (contain)
  const srcAspect = srcW / srcH;
  const outAspect = outputWidth / outputHeight;
  let drawW: number, drawH: number, drawX: number, drawY: number;
  if (srcAspect > outAspect) {
    // Source is wider – fit to width
    drawW = outputWidth;
    drawH = outputWidth / srcAspect;
    drawX = 0;
    drawY = (outputHeight - drawH) / 2;
  } else {
    // Source is taller – fit to height
    drawH = outputHeight;
    drawW = outputHeight * srcAspect;
    drawX = (outputWidth - drawW) / 2;
    drawY = 0;
  }

  // Fill background white so letterbox areas aren't transparent
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (cropParams) {
    ctx.drawImage(
      img,
      cropParams.x, cropParams.y, cropParams.width, cropParams.height,
      drawX, drawY, drawW, drawH,
    );
  } else {
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }

  if (annotations?.length) {
    for (const ann of annotations) {
      drawArrow(ctx, ann, outputWidth, outputHeight);
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Pre-processes all quote images that have crop/annotation data,
 * replacing their file_url with composited data URLs.
 * Call this before PDF generation.
 */
export async function preprocessQuoteImages<T extends {
  items: Array<{ attachments?: Array<{
    file_url: string;
    mime_type: string;
    crop_params?: CropParams | null;
    annotations?: ArrowAnnotation[] | null;
    display_in_quote?: boolean;
    display_size?: ImageDisplaySize | null;
  }> }>;
  attachments: Array<{
    file_url: string;
    mime_type: string;
    scope?: 'quote' | 'item';
    crop_params?: CropParams | null;
    annotations?: ArrowAnnotation[] | null;
    display_in_quote?: boolean;
    display_size?: ImageDisplaySize | null;
  }>;
}>(quote: T): Promise<T> {
  // Deep clone so we don't mutate the original
  const cloned = JSON.parse(JSON.stringify(quote)) as T;

  const processAttachment = async (att: {
    file_url: string;
    mime_type: string;
    scope?: string;
    crop_params?: CropParams | null;
    annotations?: ArrowAnnotation[] | null;
    display_in_quote?: boolean;
    display_size?: ImageDisplaySize | null;
  }) => {
    if (!att.mime_type?.startsWith('image/')) return;
    if (!att.crop_params && (!att.annotations || att.annotations.length === 0)) return;

    // Determine output size: use display_size for items, fixed for quote-level (3x for retina)
    const isQuoteLevel = att.scope === 'quote';
    const baseSize = isQuoteLevel
      ? { width: 150, height: 100 }
      : IMAGE_SIZE_MAP[att.display_size || 'small'];
    const outputWidth = baseSize.width * 3;
    const outputHeight = baseSize.height * 3;

    try {
      att.file_url = await compositeImage(
        att.file_url,
        att.crop_params ?? null,
        att.annotations ?? null,
        outputWidth,
        outputHeight,
      );
    } catch (err) {
      console.error('Failed to composite image:', att.file_url, err);
      // Fall back to original URL
    }
  };

  // Process all attachments in parallel
  const promises: Promise<void>[] = [];

  for (const item of cloned.items) {
    for (const att of item.attachments || []) {
      promises.push(processAttachment(att));
    }
  }
  for (const att of cloned.attachments || []) {
    promises.push(processAttachment(att));
  }

  await Promise.all(promises);
  return cloned;
}
