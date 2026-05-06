'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getCutterCutListFilename } from '@/lib/cutlist/cutter-cut-list-helpers';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';
import type { CutterCutListPdfData } from '@/lib/cutlist/cutter-cut-list-types';

interface CutterCutListViewerButtonProps {
  orderNumber: string;
  customerName: string;
  generatedAt: string;
  group: CuttingPlanMaterialGroup;
  partLabelMap: Map<string, string>;
  disabled?: boolean;
  preparingLabels?: boolean;
  draft?: boolean;
}

function buildData({
  orderNumber,
  customerName,
  generatedAt,
  group,
  partLabelMap,
  draft,
}: CutterCutListViewerButtonProps): CutterCutListPdfData {
  const materialName = group.material_name;
  return {
    orderNumber,
    customerName,
    generatedAt,
    group,
    materialName,
    materialColor: materialName,
    draft,
    sheetsRequired: group.sheets_required,
    layouts: group.layouts,
    partLabelEntries: Array.from(partLabelMap.entries()),
  };
}

export function CutterCutListViewerButton(props: CutterCutListViewerButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const disabled =
    props.disabled ||
    props.preparingLabels ||
    generating ||
    props.group.layouts.length === 0;

  const revokeBlobUrl = () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    setBlobUrl(null);
  };

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const createPdfBlob = async (): Promise<Blob> => {
    const [{ pdf }, { CutterCutListPDF }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('./CutterCutListPDF'),
    ]);

    return pdf(<CutterCutListPDF data={buildData(props)} />).toBlob();
  };

  const handleOpen = async () => {
    setGenerating(true);
    try {
      const blob = await createPdfBlob();
      revokeBlobUrl();
      const nextUrl = URL.createObjectURL(blob);
      blobUrlRef.current = nextUrl;
      setBlobUrl(nextUrl);
      setOpen(true);
    } catch (err) {
      console.error('Cutter cut-list PDF preview failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) revokeBlobUrl();
  };

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const blob = await createPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getCutterCutListFilename(props.orderNumber, props.group, { draft: props.draft });
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Cutter cut-list PDF download failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const label =
    generating
      ? 'Generating...'
      : props.preparingLabels
        ? 'Preparing labels...'
        : props.draft
          ? 'View Draft'
          : 'View';

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} disabled={disabled}>
        {generating ? (
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        ) : (
          <Eye className="mr-2 h-3 w-3" />
        )}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[min(100vw-2rem,900px)] gap-0 p-0 [&>div]:h-full [&>div]:max-h-none [&>div]:overflow-hidden [&>div]:p-0"
          aria-describedby={undefined}
        >
          <div className="flex h-full flex-col">
            <DialogHeader className="border-b px-4 py-3 pr-14">
              <div className="flex items-center justify-between gap-3">
                <DialogTitle className="text-base">
                  {props.draft ? 'Draft Cut List' : 'Cut List'}
                </DialogTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={generating}
                  className="gap-2"
                >
                  {generating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Download
                </Button>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 bg-muted">
              {blobUrl && (
                <iframe
                  src={blobUrl}
                  title={props.draft ? 'Draft cutter cut list preview' : 'Cutter cut list preview'}
                  className="h-full w-full border-0 bg-background"
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
