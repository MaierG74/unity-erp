'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import type { SheetLayout } from '@/lib/cutlist/types';

export interface CuttingDiagramButtonProps {
  sheets: SheetLayout[];
  stockWidth: number;
  stockLength: number;
  materialLabel?: string;
  kerfMm?: number;
}

export function CuttingDiagramButton({
  sheets,
  stockWidth,
  stockLength,
  materialLabel,
  kerfMm,
}: CuttingDiagramButtonProps) {
  const [generating, setGenerating] = useState(false);

  const handleDownload = async () => {
    setGenerating(true);
    try {
      // LAZY IMPORT - critical for build performance
      const [{ pdf }, { CuttingDiagramPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('../CuttingDiagramPDF'),
      ]);

      const blob = await pdf(
        <CuttingDiagramPDF
          sheets={sheets}
          stockWidth={stockWidth}
          stockLength={stockLength}
          materialLabel={materialLabel}
          kerfMm={kerfMm}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cutting-diagram-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={generating || sheets.length === 0}
    >
      {generating ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <FileDown className="h-4 w-4 mr-2" />
      )}
      {generating ? 'Generating...' : 'Cutting Diagram'}
    </Button>
  );
}
