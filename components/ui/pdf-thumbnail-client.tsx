'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PdfThumbnailClientProps {
  url: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Canvas-based PDF thumbnail — renders only page 1 via pdf.js.
 * No browser PDF viewer chrome (no sidebar, no toolbar).
 */
export function PdfThumbnailClient({
  url,
  width,
  height,
  className,
}: PdfThumbnailClientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setStatus('loading');
      try {
        const pdfjsLib = await import('pdfjs-dist');

        // Use local worker file copied to public/
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        // Scale to fit within the container (both width and height)
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          containerWidth / unscaledViewport.width,
          containerHeight / unscaledViewport.height
        );
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2d context');

        await page.render({ canvasContext: ctx, viewport } as any).promise;
        if (!cancelled) setStatus('ready');
      } catch (err) {
        console.warn('PDF thumbnail render failed', err);
        if (!cancelled) setStatus('error');
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded border bg-white',
        className,
      )}
      style={{
        ...(width ? { minWidth: width } : {}),
        ...(height ? { minHeight: height } : {}),
      }}
    >
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
          <div className="h-4 w-4 border-t-2 border-primary rounded-full animate-spin" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={cn(
          'max-w-full max-h-full object-contain',
          status !== 'ready' && 'hidden'
        )}
      />

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
          <FileText className="h-6 w-6 text-primary/70" />
          <span className="text-[11px] font-medium">PDF</span>
        </div>
      )}
    </div>
  );
}

export default PdfThumbnailClient;
