'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { cn } from '@/lib/utils';

interface ImagePreviewProps {
  src: string;
  alt?: string;
  onRemove?: () => void;
  className?: string;
}

export function ImagePreview({ src, alt = 'Preview', onRemove, className }: ImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);

  const initPanzoom = useCallback((el: HTMLImageElement | null) => {
    if (!el) return;
    panzoomRef.current = Panzoom(el, {
      maxScale: 5,
      minScale: 0.5,
      contain: 'outside',
    });
    el.parentElement?.addEventListener('wheel', panzoomRef.current.zoomWithWheel);
  }, []);

  useEffect(() => {
    return () => {
      panzoomRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* Thumbnail */}
      <div className={cn('relative group inline-block', className)}>
        <img
          src={src}
          alt={alt}
          className="h-20 w-20 rounded-md object-cover cursor-pointer border border-border hover:opacity-80 transition-opacity"
          onClick={() => setIsOpen(true)}
        />
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Fullscreen overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setIsOpen(false)}
        >
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute top-4 right-4 z-10 h-10 w-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="w-full h-full flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              ref={initPanzoom}
              src={src}
              alt={alt}
              className="max-w-full max-h-full object-contain touch-none"
            />
          </div>
        </div>
      )}
    </>
  );
}
