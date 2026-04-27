'use client';

import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CutEdgeCardPdfData } from './CutEdgeCardPdf';

interface CutEdgeCardPdfButtonProps {
  card: CutEdgeCardPdfData;
}

function slugPart(value: string | null | undefined, fallback: string): string {
  const cleaned = (value || fallback)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function buildCutEdgeCardFilename(card: CutEdgeCardPdfData): string {
  const prefix = card.cardType === 'edge' ? 'edge-card' : 'cut-card';
  return `${prefix}-${slugPart(card.orderNumber, `card-${card.id}`)}-${slugPart(card.materialColorLabel, 'material')}.pdf`;
}

export function CutEdgeCardPdfButton({ card }: CutEdgeCardPdfButtonProps) {
  const [generating, setGenerating] = useState(false);

  const handleDownload = async () => {
    setGenerating(true);
    try {
      // LAZY IMPORT - critical for build performance
      const [{ pdf }, { CutEdgeCardPdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./CutEdgeCardPdf'),
      ]);

      const blob = await pdf(<CutEdgeCardPdf card={card} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildCutEdgeCardFilename(card);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Cut/edge card PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={generating}
    >
      {generating ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <FileDown className="h-4 w-4 mr-2" />
      )}
      {generating ? 'Generating...' : 'Print Cut/Edge Card'}
    </Button>
  );
}
