'use client';

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { Download, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReturnGoodsPDFDocument from './ReturnGoodsPDFDocument';

interface ReturnItem {
  component_code: string;
  component_name: string;
  quantity_returned: number;
  reason: string;
  return_type: 'rejection' | 'later_return';
}

interface SupplierInfo {
  supplier_name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
}

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

interface ReturnGoodsPDFDownloadProps {
  goodsReturnNumber: string;
  purchaseOrderNumber: string;
  purchaseOrderId: number;
  returnDate: string;
  items: ReturnItem[];
  supplierInfo: SupplierInfo;
  companyInfo?: Partial<CompanyInfo>;
  notes?: string;
  returnType: 'rejection' | 'later_return' | 'mixed';
  fileName?: string;
}

export const ReturnGoodsPDFDownload: React.FC<ReturnGoodsPDFDownloadProps> = ({
  goodsReturnNumber,
  purchaseOrderNumber,
  purchaseOrderId,
  returnDate,
  items,
  supplierInfo,
  companyInfo,
  notes,
  returnType,
  fileName,
}) => {
  const [downloading, setDownloading] = React.useState(false);

  const defaultFileName = fileName || `GoodsReturned-${goodsReturnNumber}-${purchaseOrderNumber}.pdf`;

  const handleDownload = async () => {
    try {
      setDownloading(true);

      // Generate the PDF as a Blob in the browser
      const blob = await pdf(
        <ReturnGoodsPDFDocument
          goodsReturnNumber={goodsReturnNumber}
          purchaseOrderNumber={purchaseOrderNumber}
          purchaseOrderId={purchaseOrderId}
          returnDate={returnDate}
          items={items}
          supplierInfo={supplierInfo}
          companyInfo={companyInfo}
          notes={notes}
          returnType={returnType}
        />
      ).toBlob();

      // Force correct MIME type
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      console.log('[ReturnGoodsPDF] Generated PDF blob size (bytes):', pdfBlob.size);

      const finalName = defaultFileName.toLowerCase().endsWith('.pdf')
        ? defaultFileName
        : `${defaultFileName}.pdf`;

      // Prefer the File System Access API when available (Chrome/Edge desktop)
      const anyWindow = window as any;
      if (anyWindow && typeof anyWindow.showSaveFilePicker === 'function') {
        const handle = await anyWindow.showSaveFilePicker({
          suggestedName: finalName,
          types: [
            {
              description: 'PDF Document',
              accept: { 'application/pdf': ['.pdf'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(pdfBlob);
        await writable.close();
      } else {
        // Fallback to anchor download
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (err) {
      console.error('Failed to generate/download PDF:', err);
      try {
        // Fallback: open in a new tab for manual save
        const blob = await pdf(
          <ReturnGoodsPDFDocument
            goodsReturnNumber={goodsReturnNumber}
            purchaseOrderNumber={purchaseOrderNumber}
            purchaseOrderId={purchaseOrderId}
            returnDate={returnDate}
            items={items}
            supplierInfo={supplierInfo}
            companyInfo={companyInfo}
            notes={notes}
            returnType={returnType}
          />
        ).toBlob();
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const url = URL.createObjectURL(pdfBlob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) {
        console.error('PDF open fallback failed:', e);
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleOpen = async () => {
    try {
      setDownloading(true);
      const blob = await pdf(
        <ReturnGoodsPDFDocument
          goodsReturnNumber={goodsReturnNumber}
          purchaseOrderNumber={purchaseOrderNumber}
          purchaseOrderId={purchaseOrderId}
          returnDate={returnDate}
          items={items}
          supplierInfo={supplierInfo}
          companyInfo={companyInfo}
          notes={notes}
          returnType={returnType}
        />
      ).toBlob();
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleDownload} disabled={downloading} className="flex items-center gap-2">
        <Download size={16} />
        {downloading ? 'Generating PDF...' : 'Download PDF'}
      </Button>
      <Button variant="outline" onClick={handleOpen} disabled={downloading} className="flex items-center gap-2">
        <Eye size={16} />
        Open PDF
      </Button>
    </div>
  );
};

export default ReturnGoodsPDFDownload;
