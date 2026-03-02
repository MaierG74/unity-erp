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

// Load pdfjs-dist from public/ via script tag to bypass webpack ESM issues.
// pdfjs-dist v5 ESM modules fail with Next.js webpack (`Object.defineProperty called on non-object`).
let pdfjsPromise: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    // Already loaded from a previous call?
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }

    const script = document.createElement('script');
    script.src = '/pdf.min.mjs';
    script.type = 'module';

    // The ESM script sets `window.pdfjsLib` after eval — but ESM scripts
    // don't expose to window by default. Instead, use a module-scoped import.
    // We'll use a different approach: inline module that imports and exposes it.
    const inlineScript = document.createElement('script');
    inlineScript.type = 'module';
    inlineScript.textContent = `
      import * as pdfjsLib from '/pdf.min.mjs';
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      window.__pdfjsLib = pdfjsLib;
      window.dispatchEvent(new Event('pdfjsReady'));
    `;

    const onReady = () => {
      window.removeEventListener('pdfjsReady', onReady);
      resolve((window as any).__pdfjsLib);
    };
    window.addEventListener('pdfjsReady', onReady);

    // Timeout fallback
    setTimeout(() => {
      window.removeEventListener('pdfjsReady', onReady);
      if ((window as any).__pdfjsLib) {
        resolve((window as any).__pdfjsLib);
      } else {
        reject(new Error('pdfjs-dist load timeout'));
      }
    }, 10000);

    document.head.appendChild(inlineScript);
  });
  return pdfjsPromise;
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
        const pdfjsLib = await loadPdfJs();

        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        // Scale to fit within the container
        const containerWidth = container.clientWidth || 200;
        const containerHeight = container.clientHeight || 200;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          containerWidth / unscaledViewport.width,
          containerHeight / unscaledViewport.height
        ) || 0.5;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2d context');

        await page.render({ canvasContext: ctx, viewport } as any).promise;
        if (!cancelled) setStatus('ready');
      } catch (err) {
        console.warn('PDF thumbnail render failed for', url, err);
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
