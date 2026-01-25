'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CutlistWorkspace from './CutlistWorkspace';
import { useQuoteCutlistAdapter } from './adapters';
import { exportCutlistToQuote } from './export';
import type { CutlistSummary, CutlistLineInput, CutlistLineRefs } from '@/lib/cutlist/types';

export interface QuoteCutlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteItemId: string | null | undefined;
  onExportSuccess?: () => void;
}

/**
 * Modal wrapper for CutlistWorkspace with quote-specific export functionality.
 *
 * Uses the CutlistWorkspace with useQuoteCutlistAdapter for persistence,
 * and adds an "Export to Quote" button that creates quote cluster lines.
 */
export function QuoteCutlistModal({
  open,
  onOpenChange,
  quoteItemId,
  onExportSuccess,
}: QuoteCutlistModalProps) {
  const adapter = useQuoteCutlistAdapter(quoteItemId);
  const [summary, setSummary] = React.useState<CutlistSummary | null>(null);
  const [isExporting, setIsExporting] = React.useState(false);
  const [lineRefs, setLineRefs] = React.useState<CutlistLineRefs>({});

  // Store costing info for export (loaded from persistence)
  const [costingInfo, setCostingInfo] = React.useState<{
    primaryDescription: string;
    primaryPrice: number | null;
    primaryComponentId: number | undefined;
    backerDescription: string;
    backerPrice: number | null;
    backerComponentId: number | undefined;
    band16Description: string;
    band16Price: number | null;
    band16ComponentId: number | undefined;
    band32Description: string;
    band32Price: number | null;
    band32ComponentId: number | undefined;
  } | null>(null);

  // Load costing info from adapter when modal opens
  React.useEffect(() => {
    if (!open || !quoteItemId) {
      setCostingInfo(null);
      setLineRefs({});
      return;
    }

    // Load initial data to get costing info and line refs
    adapter.load().then((snapshot) => {
      if (!snapshot) return;

      const c = snapshot.costing;
      const comp = snapshot.components;

      setCostingInfo({
        primaryDescription: c?.primarySheetDescription || 'MELAMINE SHEET',
        primaryPrice: typeof c?.primaryPricePerSheet === 'number' ? c.primaryPricePerSheet : (comp?.primary?.unit_cost ?? null),
        primaryComponentId: comp?.primary?.component_id,
        backerDescription: c?.backerSheetDescription || 'BACKER BOARD',
        backerPrice: typeof c?.backerPricePerSheet === 'number' ? c.backerPricePerSheet : (comp?.backer?.unit_cost ?? null),
        backerComponentId: comp?.backer?.component_id,
        band16Description: c?.bandingDesc16 || 'EDGE BANDING 16mm (m)',
        band16Price: typeof c?.bandingPrice16 === 'number' ? c.bandingPrice16 : (comp?.band16?.unit_cost ?? null),
        band16ComponentId: comp?.band16?.component_id,
        band32Description: c?.bandingDesc32 || 'EDGE BANDING 32mm (m)',
        band32Price: typeof c?.bandingPrice32 === 'number' ? c.bandingPrice32 : (comp?.band32?.unit_cost ?? null),
        band32ComponentId: comp?.band32?.component_id,
      });
    }).catch((err) => {
      console.warn('Failed to load costing info', err);
    });
  }, [open, quoteItemId, adapter]);

  // Update costing info when summary changes (user may have modified costing in the workspace)
  const handleSummaryChange = React.useCallback((newSummary: CutlistSummary | null) => {
    setSummary(newSummary);

    // Re-load costing info in case it was updated
    if (newSummary) {
      adapter.load().then((snapshot) => {
        if (!snapshot) return;

        const c = snapshot.costing;
        const comp = snapshot.components;

        setCostingInfo({
          primaryDescription: c?.primarySheetDescription || 'MELAMINE SHEET',
          primaryPrice: typeof c?.primaryPricePerSheet === 'number' ? c.primaryPricePerSheet : (comp?.primary?.unit_cost ?? null),
          primaryComponentId: comp?.primary?.component_id,
          backerDescription: c?.backerSheetDescription || 'BACKER BOARD',
          backerPrice: typeof c?.backerPricePerSheet === 'number' ? c.backerPricePerSheet : (comp?.backer?.unit_cost ?? null),
          backerComponentId: comp?.backer?.component_id,
          band16Description: c?.bandingDesc16 || 'EDGE BANDING 16mm (m)',
          band16Price: typeof c?.bandingPrice16 === 'number' ? c.bandingPrice16 : (comp?.band16?.unit_cost ?? null),
          band16ComponentId: comp?.band16?.component_id,
          band32Description: c?.bandingDesc32 || 'EDGE BANDING 32mm (m)',
          band32Price: typeof c?.bandingPrice32 === 'number' ? c.bandingPrice32 : (comp?.band32?.unit_cost ?? null),
          band32ComponentId: comp?.band32?.component_id,
        });
      }).catch((err) => {
        console.warn('Failed to reload costing info', err);
      });
    }
  }, [adapter]);

  const handleExport = async () => {
    if (!quoteItemId || !summary || !costingInfo) return;

    setIsExporting(true);
    try {
      const primaryLine: CutlistLineInput | null = summary.primarySheetsBillable > 0.0001
        ? {
            description: costingInfo.primaryDescription,
            qty: summary.primarySheetsBillable,
            unit_cost: costingInfo.primaryPrice ?? undefined,
            component_id: costingInfo.primaryComponentId,
          }
        : null;

      const backerLine: CutlistLineInput | null = summary.backerResult && summary.backerSheetsBillable > 0.0001 && summary.laminationOn
        ? {
            description: costingInfo.backerDescription,
            qty: summary.backerSheetsBillable,
            unit_cost: costingInfo.backerPrice ?? undefined,
            component_id: costingInfo.backerComponentId,
          }
        : null;

      const band16Line: CutlistLineInput | null = summary.edgebanding16mm > 0.0001
        ? {
            description: costingInfo.band16Description,
            qty: summary.edgebanding16mm / 1000, // Convert mm to meters
            unit_cost: costingInfo.band16Price ?? undefined,
            component_id: costingInfo.band16ComponentId,
          }
        : null;

      const band32Line: CutlistLineInput | null = summary.edgebanding32mm > 0.0001
        ? {
            description: costingInfo.band32Description,
            qty: summary.edgebanding32mm / 1000, // Convert mm to meters
            unit_cost: costingInfo.band32Price ?? undefined,
            component_id: costingInfo.band32ComponentId,
          }
        : null;

      const updatedRefs = await exportCutlistToQuote({
        quoteItemId,
        existingLineRefs: lineRefs,
        primaryLine,
        backerLine,
        band16Line,
        band32Line,
      });

      setLineRefs(updatedRefs);
      onExportSuccess?.();
    } catch (err) {
      console.error('Cutlist export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const canExport = !!summary && !!quoteItemId && !!costingInfo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cutlist Calculator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CutlistWorkspace
            mode="manual"
            showCSVImport={true}
            showCosting={true}
            showResults={true}
            showMaterialPalette={false}
            showStockTab={true}
            persistenceAdapter={adapter}
            onSummaryChange={handleSummaryChange}
          />

          {/* Export Button */}
          <div className="flex justify-end pt-2 border-t">
            <Button
              onClick={handleExport}
              disabled={!canExport || isExporting}
            >
              {isExporting ? 'Exporting...' : 'Export to Quote'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QuoteCutlistModal;
