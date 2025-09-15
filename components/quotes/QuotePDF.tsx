'use client';

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, pdf } from '@react-pdf/renderer';
import { Eye, Download } from 'lucide-react';
import { Quote, QuoteItem, QuoteAttachment } from '@/lib/db/quotes';
import { Button } from '@/components/ui/button';

// PDF Styles
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 30,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    borderBottom: 2,
    borderBottomColor: '#000000',
    paddingBottom: 10,
  },
  companyInfo: {
    fontSize: 10,
    lineHeight: 1.4,
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  quoteTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  logo: {
    width: 120,
    height: 40,
    objectFit: 'contain',
    marginBottom: 6,
  },
  quoteNumber: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 5,
  },
  quoteDate: {
    fontSize: 10,
    textAlign: 'right',
    marginTop: 2,
  },
  customerSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
    backgroundColor: '#f0f0f0',
    padding: 5,
  },
  customerInfo: {
    fontSize: 10,
    lineHeight: 1.4,
  },
  itemsTable: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    padding: 8,
    fontSize: 10,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: 1,
    borderBottomColor: '#CCCCCC',
    padding: 8,
    fontSize: 9,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottom: 1,
    borderBottomColor: '#CCCCCC',
    backgroundColor: '#f9f9f9',
    padding: 8,
    fontSize: 9,
  },
  descriptionCol: {
    flex: 4,
  },
  qtyCol: {
    flex: 1,
    textAlign: 'center',
  },
  priceCol: {
    flex: 1.5,
    textAlign: 'right',
  },
  totalCol: {
    flex: 1.5,
    textAlign: 'right',
  },
  itemDescription: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  itemSpecs: {
    fontSize: 8,
    color: '#666666',
    lineHeight: 1.3,
  },
  itemImage: {
    width: 80,
    height: 60,
    objectFit: 'contain',
    marginTop: 5,
    marginBottom: 5,
  },
  totalsSection: {
    alignSelf: 'flex-end',
    width: 200,
    marginTop: 20,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 5,
    fontSize: 10,
  },
  totalRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 5,
    fontSize: 12,
    fontWeight: 'bold',
    borderTop: 2,
    borderTopColor: '#000000',
  },
  terms: {
    marginTop: 30,
    fontSize: 8,
    color: '#666666',
    lineHeight: 1.4,
  },
  termsTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  referenceImages: {
    marginTop: 20,
  },
  referenceImage: {
    width: 150,
    height: 100,
    objectFit: 'contain',
    margin: 5,
  },
  referenceImageTitle: {
    fontSize: 8,
    textAlign: 'center',
    marginTop: 2,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    fontSize: 8,
    color: '#666666',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
}

interface QuotePDFProps {
  quote: Quote & {
    items: (QuoteItem & { attachments?: QuoteAttachment[] })[];
    attachments: QuoteAttachment[];
    customer?: { id: number; name: string; email?: string | null; telephone?: string | null };
  };
  companyInfo?: Partial<CompanyInfo>;
}

// PDF Document Component
const QuotePDFDocument: React.FC<QuotePDFProps> = ({ quote, companyInfo }) => {
  const defaultCompanyInfo: CompanyInfo = {
    name: 'Your Company Name',
    address: 'Your Address\nYour City, Postal Code',
    phone: '+27 XX XXX XXXX',
    email: 'info@yourcompany.com',
  };

  const company: CompanyInfo = { ...defaultCompanyInfo, ...(companyInfo || {}) };
  
  // Helpers
  const formatCurrency = (n: number) => `R ${n.toFixed(2)}`;

  // Calculate totals using qty * unit_price when item.total is missing
  const lineTotal = (item: QuoteItem) => {
    const qty = Number(item.qty || 0);
    const unit = Number(item.unit_price || 0);
    const fallback = qty * unit;
    const explicit = Number((item as any).total ?? 0);
    return explicit > 0 ? explicit : fallback;
  };

  const subtotal = quote.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const vatRate = typeof (quote as any).vat_rate === 'number' ? (quote as any).vat_rate : 15; // default 15%
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  // Get reference images (quote-level attachments)
  const referenceImages = quote.attachments?.filter(att => 
    att.scope === 'quote' && att.mime_type?.startsWith('image/')
  ) || [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {company.logo ? (
              <Image style={styles.logo} src={company.logo} />
            ) : (
              <Text style={styles.companyName}>{company.name}</Text>
            )}
            {!company.logo && (
              <>
                <Text style={styles.companyInfo}>{company.address}</Text>
                <Text style={styles.companyInfo}>Tel: {company.phone}</Text>
                <Text style={styles.companyInfo}>Email: {company.email}</Text>
              </>
            )}
            {company.logo && (
              <>
                <Text style={styles.companyInfo}>{company.name}</Text>
                <Text style={styles.companyInfo}>{company.address}</Text>
                <Text style={styles.companyInfo}>Tel: {company.phone}</Text>
                <Text style={styles.companyInfo}>Email: {company.email}</Text>
              </>
            )}
          </View>
          <View>
            <Text style={styles.quoteTitle}>QUOTATION</Text>
            <Text style={styles.quoteNumber}>Quote #: {quote.quote_number}</Text>
            <Text style={styles.quoteDate}>
              Date: {new Date(quote.created_at).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Customer Information */}
        <View style={styles.customerSection}>
          <Text style={styles.sectionTitle}>Quote For:</Text>
          <Text style={styles.customerInfo}>
            {quote?.customer?.name ? `Customer: ${quote.customer.name}` : `Customer ID: ${quote.customer_id}`}
          </Text>
        </View>

        {/* Items Table */}
        <View style={styles.itemsTable}>
          <View style={styles.tableHeader}>
            <Text style={styles.descriptionCol}>Description</Text>
            <Text style={styles.qtyCol}>Qty</Text>
            <Text style={styles.priceCol}>Unit Price</Text>
            <Text style={styles.totalCol}>Total Excl VAT</Text>
          </View>

          {quote.items.map((item, index) => {
            // Collect all displayable image attachments ordered by display_order
            const itemImages = (item.attachments || [])
              .filter(att => att.mime_type?.startsWith('image/') && ((att as any).display_in_quote !== false))
              .sort((a, b) => ((a as any).display_order ?? 9999) - ((b as any).display_order ?? 9999));
            // Prepare bullet points from optional field
            const bulletLines = String(((item as any).bullet_points ?? '') as string)
              .split(/\r?\n/)
              .map(s => s.trim())
              .filter(Boolean);

            return (
              <View key={item.id} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                <View style={styles.descriptionCol}>
                  {itemImages.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {itemImages.map((img, i) => (
                        <Image key={i} style={styles.itemImage} src={img.file_url} />
                      ))}
                    </View>
                  )}
                  <Text style={styles.itemDescription}>{item.description}</Text>
                  {/* Bullet point details (one per line) */}
                  {bulletLines.length > 0 && (
                    <Text style={styles.itemSpecs}>
                      {bulletLines
                        .map((l, i) => `• ${l}${i < bulletLines.length - 1 ? '\n' : ''}`)
                        .join('')}
                    </Text>
                  )}
                </View>
                <Text style={styles.qtyCol}>{item.qty}</Text>
                <Text style={styles.priceCol}>{formatCurrency(Number(item.unit_price || 0))}</Text>
                <Text style={styles.totalCol}>{formatCurrency(lineTotal(item))}</Text>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text>Subtotal:</Text>
            <Text>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>VAT ({vatRate}%):</Text>
            <Text>{formatCurrency(vatAmount)}</Text>
          </View>
          <View style={styles.totalRowBold}>
            <Text>Total:</Text>
            <Text>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Reference Images */}
        {referenceImages.length > 0 && (
          <View style={styles.referenceImages}>
            <Text style={styles.sectionTitle}>Reference Images</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {referenceImages.map((img, index) => (
                <View key={index}>
                  <Image 
                    style={styles.referenceImage} 
                    src={img.file_url}
                  />
                  <Text style={styles.referenceImageTitle}>
                    {img.original_name || 'Reference Image'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Terms and Conditions */}
        <View style={styles.terms}>
          <Text style={styles.termsTitle}>Terms & Conditions:</Text>
          {((quote as any).terms || (quote as any).notes) ? (
            <Text>{((quote as any).terms || (quote as any).notes) as string}</Text>
          ) : (
            <Text>
              • Payment terms: 30 days from invoice date{'\n'}
              • All prices exclude VAT unless otherwise stated{'\n'}
              • This quotation is valid for 30 days from the date above{'\n'}
              • Delivery times may vary depending on stock availability
            </Text>
          )}
        </View>

        {/* Footer with page numbers */}
        <View style={styles.footer} fixed>
          <Text>Unity ERP</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};

// Download Button Component
interface QuotePDFDownloadProps extends QuotePDFProps {
  fileName?: string;
}

export const QuotePDFDownload: React.FC<QuotePDFDownloadProps> = ({ 
  quote, 
  companyInfo,
  fileName 
}) => {
  const date = new Date(quote.created_at);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const defaultFileName = `Quote-${quote.quote_number}-${y}${m}${d}.pdf`;
  const [downloading, setDownloading] = React.useState(false);
  const [customLogoDataUrl, setCustomLogoDataUrl] = React.useState<string | null>(null);

  const mergedCompanyInfo: CompanyInfo = React.useMemo(() => ({
    name: 'Your Company Name',
    address: 'Your Address\nYour City, Postal Code',
    phone: '+27 XX XXX XXXX',
    email: 'info@yourcompany.com',
    ...(companyInfo || {}),
    // Ensure the document receives `logo`
    logo: customLogoDataUrl || (companyInfo as any)?.logo || (companyInfo as any)?.logoUrl,
  }), [companyInfo, customLogoDataUrl]);

  const onPickLogo: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomLogoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      // Generate the PDF as a Blob in the browser
      const blob = await pdf(
        <QuotePDFDocument quote={quote} companyInfo={mergedCompanyInfo} />
      ).toBlob();
      // Force correct MIME type and extension
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      console.log('[QuotePDF] Generated PDF blob size (bytes):', pdfBlob.size);
      const finalName = (fileName || defaultFileName).toLowerCase().endsWith('.pdf')
        ? (fileName || defaultFileName)
        : `${fileName || defaultFileName}.pdf`;
      console.log('[QuotePDF] Using filename:', finalName);
      if (pdfBlob.size < 10240) {
        console.warn('[QuotePDF] PDF size is under 10KB; this may indicate missing content.');
      }

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
        // Fallback to anchor download which uses the browser's default Downloads folder
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Some browsers need a short delay before revoking
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (err) {
      console.error('Failed to generate/download PDF:', err);
      try {
        // Fallback: open in a new tab for manual save (Safari/iOS)
        const blob = await pdf(
          <QuotePDFDocument quote={quote} companyInfo={companyInfo} />
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
        <QuotePDFDocument quote={quote} companyInfo={mergedCompanyInfo} />
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
      <input
        type="file"
        accept="image/*"
        onChange={onPickLogo}
        className="text-sm"
        aria-label="Choose logo image"
      />
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

export default QuotePDFDocument;
