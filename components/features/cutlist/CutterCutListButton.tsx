'use client';

import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCutterCutListFilename } from '@/lib/cutlist/cutter-cut-list-helpers';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';
import type { CutterCutListPdfData } from '@/lib/cutlist/cutter-cut-list-types';

interface CutterCutListButtonProps {
  orderNumber: string;
  customerName: string;
  generatedAt: string;
  group: CuttingPlanMaterialGroup;
  partLabelMap: Map<string, string>;
  disabled?: boolean;
  preparingLabels?: boolean;
}

function buildData({
  orderNumber,
  customerName,
  generatedAt,
  group,
  partLabelMap,
}: CutterCutListButtonProps): CutterCutListPdfData {
  const materialName = group.material_name;
  return {
    orderNumber,
    customerName,
    generatedAt,
    group,
    materialName,
    materialColor: materialName,
    sheetsRequired: group.sheets_required,
    layouts: group.layouts,
    partLabelEntries: Array.from(partLabelMap.entries()),
  };
}

export function CutterCutListButton(props: CutterCutListButtonProps) {
  const [generating, setGenerating] = useState(false);
  const disabled =
    props.disabled ||
    props.preparingLabels ||
    generating ||
    props.group.layouts.length === 0;

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const [{ pdf }, { CutterCutListPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./CutterCutListPDF'),
      ]);

      const data = buildData(props);
      const blob = await pdf(<CutterCutListPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getCutterCutListFilename(props.orderNumber, props.group);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Cutter cut-list PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const label =
    generating
      ? 'Generating...'
      : props.preparingLabels
        ? 'Preparing labels...'
        : props.group.kind === 'backer'
          ? 'Print Backer'
          : 'Print Cut List';

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={disabled}>
      {generating ? (
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      ) : (
        <FileDown className="mr-2 h-3 w-3" />
      )}
      {label}
    </Button>
  );
}
