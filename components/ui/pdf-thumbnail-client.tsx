'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PdfThumbnailClientProps {
  url: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Lightweight PDF thumbnail renderer.
 *
 * Strategy:
 * - Fetch the PDF once, create an object URL, and render via <object> so we avoid
 *   iframe/GDocs hacks and reduce flicker.
 * - Show a subtle loading state while the blob is fetched.
 * - Fail fast to a neutral icon when rendering fails (e.g., CORS or corrupt file).
 */
export function PdfThumbnailClient({
  url,
  width,
  height,
  className,
}: PdfThumbnailClientProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // Stable key so caches don't explode on re-renders but still update when URL changes.
  const cacheKey = useMemo(() => `${url}`, [url]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    async function hydrate() {
      setStatus('loading');
      try {
        const resp = await fetch(cacheKey, { cache: 'force-cache' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(blob);
        revokedUrl = nextUrl;
        setObjectUrl(nextUrl);
        setStatus('ready');
      } catch (err) {
        console.warn('PDF thumbnail fetch failed', err);
        if (!cancelled) {
          setObjectUrl(null);
          setStatus('error');
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [cacheKey]);

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded border bg-muted/30',
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

      {status === 'ready' && objectUrl ? (
        <object
          data={objectUrl}
          type="application/pdf"
          className="h-full w-full"
          aria-label="PDF preview"
          onError={() => setStatus('error')}
        />
      ) : null}

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
