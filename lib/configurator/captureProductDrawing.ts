import { supabase } from '@/lib/supabase';

const DRAWING_BUCKET = 'QButton';
const DEFAULT_CAPTURE_TIMEOUT_MS = 10_000;

export function productDrawingStoragePath(productId: number, uuid: string): string {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error('productId must be a positive integer');
  }
  return `Product Drawings/${productId}/${uuid}.png`;
}

export function withDrawingCaptureTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function readSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox?.width || svg.width.baseVal.value || svg.getBoundingClientRect().width;
  const height = viewBox?.height || svg.height.baseVal.value || svg.getBoundingClientRect().height;

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('Unable to determine drawing size');
  }

  return { width, height };
}

async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = readSvgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new window.Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load serialized SVG'));
    });
    image.src = objectUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * 2);
    canvas.height = Math.ceil(height * 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create drawing canvas');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to render drawing PNG');
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function nodeToPngBlob(node: Element): Promise<Blob> {
  if (node instanceof SVGSVGElement) {
    return svgToPngBlob(node);
  }

  const { toPng } = await import('dom-to-image-more');
  const dataUrl = await toPng(node as HTMLElement, {
    cacheBust: true,
    bgcolor: '#ffffff',
    pixelRatio: 2,
    filter: (candidate: Node) => {
      if (!(candidate instanceof Element)) return true;
      return !candidate.closest('[data-capture-exclude="true"]');
    },
  });
  return (await fetch(dataUrl)).blob();
}

export async function captureAndUploadProductDrawing(
  node: Element,
  productId: number,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<string> {
  const blob = await withDrawingCaptureTimeout(
    nodeToPngBlob(node),
    timeoutMs,
    `Product drawing capture timed out after ${timeoutMs}ms`,
  );
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
