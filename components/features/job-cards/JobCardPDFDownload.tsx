'use client';

import React, { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import type { JobCardPDFData, JobCardPDFItem, CompanyInfo } from './JobCardPDFDocument';

interface JobCardPDFDownloadProps {
  jobCard: JobCardPDFData;
  items: JobCardPDFItem[];
  companyInfo?: Partial<CompanyInfo>;
  drawingUrl?: string | null;
}

/** Generate a QR code data URL for the job card scan page. */
async function generateQRCodeDataURL(jobCardId: number): Promise<string | null> {
  try {
    const QRCode = await import('qrcode');
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/scan/jc/${jobCardId}`;
    return await QRCode.toDataURL(url, {
      width: 160,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.warn('QR code generation failed:', err);
    return null;
  }
}

/** Dynamically import react-pdf and the document component, then generate the blob. */
async function buildPDFBlob(props: {
  jobCard: JobCardPDFData;
  items: JobCardPDFItem[];
  companyInfo?: Partial<CompanyInfo>;
  drawingUrl?: string | null;
}): Promise<Blob> {
  const [{ pdf }, { default: JobCardPDFDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./JobCardPDFDocument'),
  ]);

  const qrCodeDataUrl = await generateQRCodeDataURL(props.jobCard.job_card_id);

  const element = React.createElement(JobCardPDFDocument, {
    jobCard: props.jobCard,
    items: props.items,
    companyInfo: props.companyInfo,
    qrCodeDataUrl,
    drawingUrl: props.drawingUrl,
  }) as React.ReactElement;

  const blob = await pdf(element).toBlob();
  return new Blob([blob], { type: 'application/pdf' });
}

export function JobCardPDFDownload({
  jobCard,
  items,
  companyInfo,
  drawingUrl,
}: JobCardPDFDownloadProps) {
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    try {
      setBusy(true);
      const pdfBlob = await buildPDFBlob({ jobCard, items, companyInfo, drawingUrl });
      const filename = `job_card_${jobCard.job_card_id}_${format(new Date(jobCard.issue_date + 'T00:00:00'), 'yyyy-MM-dd')}.pdf`;

      // Prefer native Save dialog when supported
      const anyWindow = window as any;
      if (anyWindow && typeof anyWindow.showSaveFilePicker === 'function') {
        try {
          const handle = await anyWindow.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(pdfBlob);
          await writable.close();
          return;
        } catch {
          // User cancelled or API unavailable — fall through
        }
      }

      // Fallback anchor download
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error('PDF generation failed:', err);
      // Fallback: open in new tab
      try {
        const pdfBlob = await buildPDFBlob({ jobCard, items, companyInfo, drawingUrl });
        const url = URL.createObjectURL(pdfBlob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) {
        console.error('PDF open fallback failed:', e);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = async () => {
    try {
      setBusy(true);
      const pdfBlob = await buildPDFBlob({ jobCard, items, companyInfo, drawingUrl });
      const url = URL.createObjectURL(pdfBlob);
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.onload = () => printWindow.print();
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('PDF print failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleDownload} disabled={busy} variant="outline" size="sm">
        <Download className="mr-1.5 h-4 w-4" />
        {busy ? 'Generating…' : 'Download PDF'}
      </Button>
      <Button onClick={handlePrint} disabled={busy} variant="outline" size="sm">
        <Printer className="mr-1.5 h-4 w-4" />
        Print
      </Button>
    </div>
  );
}

export default JobCardPDFDownload;
