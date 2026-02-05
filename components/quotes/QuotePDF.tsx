'use client';

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, pdf } from '@react-pdf/renderer';
import { Eye, Download } from 'lucide-react';
import { Quote, QuoteItem, QuoteAttachment, QuoteItemType, QuoteItemTextAlign } from '@/lib/db/quotes';
import { Button } from '@/components/ui/button';
import { preprocessQuoteImages } from '@/lib/quotes/compositeImage';
import { IMAGE_SIZE_MAP } from '@/types/image-editor';

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
    padding: 5,
    fontSize: 9,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottom: 1,
    borderBottomColor: '#CCCCCC',
    backgroundColor: '#f9f9f9',
    padding: 5,
    fontSize: 9,
  },
  tableRowHead: {
    borderBottom: 0,
    paddingBottom: 2,
  },
  tableRowDetail: {
    borderBottom: 1,
    borderBottomColor: '#CCCCCC',
    paddingTop: 0,
    paddingBottom: 2,
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
    marginBottom: 0,
  },
  itemSpecs: {
    fontSize: 8,
    color: '#666666',
    lineHeight: 1.3,
  },
  itemDetailBlock: {
    marginTop: 0,
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
  // Heading item - bold, larger text spanning full width
  headingRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingTop: 12,
    borderBottom: 1,
    borderBottomColor: '#CCCCCC',
  },
  headingText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  // Note item - normal text spanning full width
  noteRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  noteText: {
    fontSize: 9,
    color: '#333333',
  },
  // Full width column for non-priced items
  fullWidthCol: {
    flex: 1,
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
  /** Default terms template from settings, used when quote has no specific terms */
  defaultTermsTemplate?: string;
}

/**
 * Converts simple HTML (from TipTap) into @react-pdf/renderer elements.
 * Supports nested tags: <p>, <strong>/<b>, <em>/<i>, <mark>, <br>, plain text.
 */
const TAG_STYLES: Record<string, Record<string, any>> = {
  strong: { fontWeight: 'bold' },
  b: { fontWeight: 'bold' },
  em: { fontStyle: 'italic' },
  i: { fontStyle: 'italic' },
  mark: { backgroundColor: '#FFFF00' },
};

let _htmlKeyCounter = 0;

/** Recursively parse inline HTML into nested <Text> elements */
function parseInlineHtml(html: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match: opening tag with content, <br>, or plain text
  const regex = /<(strong|b|em|i|mark)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<br\s*\/?>|([^<]+)/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const [fullMatch, tag, innerHtml, plainText] = match;

    // Skip any unmatched gap (shouldn't happen normally but safety)
    if (match.index > lastIndex) {
      const gap = html.slice(lastIndex, match.index);
      if (gap.trim()) nodes.push(<Text key={`h${_htmlKeyCounter++}`}>{gap}</Text>);
    }
    lastIndex = match.index + fullMatch.length;

    if (plainText) {
      nodes.push(<Text key={`h${_htmlKeyCounter++}`}>{plainText}</Text>);
    } else if (tag) {
      const style = TAG_STYLES[tag.toLowerCase()] || {};
      // Recurse into inner HTML to handle nesting
      const children = parseInlineHtml(innerHtml);
      nodes.push(<Text key={`h${_htmlKeyCounter++}`} style={style}>{children}</Text>);
    } else {
      // <br>
      nodes.push(<Text key={`h${_htmlKeyCounter++}`}>{'\n'}</Text>);
    }
  }

  // Trailing text after last match
  if (lastIndex < html.length) {
    const rest = html.slice(lastIndex);
    if (rest.trim()) nodes.push(<Text key={`h${_htmlKeyCounter++}`}>{rest}</Text>);
  }

  return nodes;
}

function renderHtmlToPdf(
  html: string,
  baseStyle: Record<string, any> = {}
): React.ReactNode[] {
  _htmlKeyCounter = 0;

  // If no HTML tags, return as plain text
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return [<Text key="plain" style={baseStyle}>{html}</Text>];
  }

  // Split into paragraphs by <p> tags
  const paragraphs = html.split(/<\/?p[^>]*>/gi).filter(s => s.trim());

  return paragraphs.map((para, pIdx) => (
    <Text key={`p${pIdx}`} style={baseStyle}>{parseInlineHtml(para)}</Text>
  ));
}

// Hardcoded fallback terms if no template provided
const FALLBACK_TERMS = `• Payment terms: 30 days from invoice date
• All prices exclude VAT unless otherwise stated
• This quotation is valid for 30 days from the date above
• Delivery times may vary depending on stock availability`;

// PDF Document Component
const QuotePDFDocument: React.FC<QuotePDFProps> = ({ quote, companyInfo, defaultTermsTemplate }) => {
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
  // Only priced items contribute to totals
  const lineTotal = (item: QuoteItem) => {
    // Non-priced items (heading, note) don't contribute to totals
    if (item.item_type && item.item_type !== 'priced') return 0;
    const qty = Number(item.qty || 0);
    const unit = Number(item.unit_price || 0);
    const fallback = qty * unit;
    const explicit = Number((item as any).total ?? 0);
    return explicit > 0 ? explicit : fallback;
  };

  // Only sum priced items
  const subtotal = quote.items
    .filter(item => !item.item_type || item.item_type === 'priced')
    .reduce((sum, item) => sum + lineTotal(item), 0);
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
            const itemType = item.item_type || 'priced';
            const isPriced = itemType === 'priced';
            const isHeading = itemType === 'heading';
            const isNote = itemType === 'note';
            const textAlign = item.text_align || 'left';

            // Collect all displayable image attachments ordered by display_order
            const itemImages = (item.attachments || [])
              .filter(att => att.mime_type?.startsWith('image/') && ((att as any).display_in_quote !== false))
              .sort((a, b) => ((a as any).display_order ?? 9999) - ((b as any).display_order ?? 9999));
            // Prepare bullet points from optional field
            const bulletLines = String(((item as any).bullet_points ?? '') as string)
              .split(/\r?\n/)
              .map(s => s.trim())
              .filter(Boolean);
            const hasDetails = itemImages.length > 0 || bulletLines.length > 0;

            // Render heading items - bold text spanning full width, no pricing columns
            if (isHeading) {
              return (
                <View key={item.id} wrap={false}>
                  <View style={styles.headingRow}>
                    <View style={styles.fullWidthCol}>
                      <Text style={[styles.headingText, { textAlign }]}>{item.description}</Text>
                    </View>
                  </View>
                  {hasDetails && (
                    <View style={styles.noteRow}>
                      <View style={styles.fullWidthCol}>
                        {itemImages.length > 0 && (
                          <View style={[styles.itemDetailBlock, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start' }]}>
                            {itemImages.map((img, i) => {
                              const size = IMAGE_SIZE_MAP[(img as any).display_size || 'small'];
                              return (
                                <Image
                                  key={i}
                                  style={{
                                    width: size.width,
                                    height: size.height,
                                    objectFit: 'contain' as const,
                                    marginTop: 1,
                                    marginBottom: 1,
                                  }}
                                  src={img.file_url}
                                />
                              );
                            })}
                          </View>
                        )}
                        {bulletLines.length > 0 && (
                          <Text style={[styles.itemSpecs, styles.itemDetailBlock, { textAlign }]}>
                            {bulletLines
                              .map((l, i) => `• ${l}${i < bulletLines.length - 1 ? '\n' : ''}`)
                              .join('')}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}
                </View>
              );
            }

            // Render note items - normal text spanning full width, no pricing columns
            if (isNote) {
              return (
                <View key={item.id} wrap={false}>
                  <View style={styles.noteRow}>
                    <View style={styles.fullWidthCol}>
                      {item.description && <Text style={[styles.noteText, { textAlign }]}>{item.description}</Text>}
                      {itemImages.length > 0 && (
                        <View style={[styles.itemDetailBlock, { flexDirection: 'row', flexWrap: 'wrap', marginTop: item.description ? 4 : 0, justifyContent: textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start' }]}>
                          {itemImages.map((img, i) => {
                            const size = IMAGE_SIZE_MAP[(img as any).display_size || 'small'];
                            return (
                              <Image
                                key={i}
                                style={{
                                  width: size.width,
                                  height: size.height,
                                  objectFit: 'contain' as const,
                                  marginTop: 1,
                                  marginBottom: 1,
                                }}
                                src={img.file_url}
                              />
                            );
                          })}
                        </View>
                      )}
                      {bulletLines.length > 0 && (
                        <Text style={[styles.itemSpecs, styles.itemDetailBlock, { textAlign }]}>
                          {bulletLines
                            .map((l, i) => `• ${l}${i < bulletLines.length - 1 ? '\n' : ''}`)
                            .join('')}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            }

            // Render priced items - Photo first, then item name/qty/price, then details
            const rowBase = index % 2 === 0 ? styles.tableRow : styles.tableRowAlt;
            const hasBullets = bulletLines.length > 0;

            return (
              <View key={item.id} wrap={false}>
                {/* Row 1: Image(s) - only if there are images */}
                {itemImages.length > 0 && (
                  <View style={[rowBase, styles.tableRowHead, { borderBottom: 0 }]}>
                    <View style={styles.descriptionCol}>
                      <View style={[styles.itemDetailBlock, { flexDirection: 'row', flexWrap: 'wrap' }]}>
                        {itemImages.map((img, i) => {
                          const size = IMAGE_SIZE_MAP[(img as any).display_size || 'small'];
                          return (
                            <Image
                              key={i}
                              style={{
                                width: size.width,
                                height: size.height,
                                objectFit: 'contain' as const,
                                marginTop: 1,
                                marginBottom: 1,
                              }}
                              src={img.file_url}
                            />
                          );
                        })}
                      </View>
                    </View>
                    <Text style={styles.qtyCol}> </Text>
                    <Text style={styles.priceCol}> </Text>
                    <Text style={styles.totalCol}> </Text>
                  </View>
                )}
                {/* Row 2: Item name + Qty + Price + Total */}
                <View style={hasBullets ? [rowBase, styles.tableRowHead] : rowBase}>
                  <View style={styles.descriptionCol}>
                    <Text style={styles.itemDescription}>{item.description}</Text>
                  </View>
                  <Text style={styles.qtyCol}>{item.qty}</Text>
                  <Text style={styles.priceCol}>{formatCurrency(Number(item.unit_price || 0))}</Text>
                  <Text style={styles.totalCol}>{formatCurrency(lineTotal(item))}</Text>
                </View>
                {/* Row 3: Bullet points / details - only if there are bullets */}
                {hasBullets && (
                  <View style={[rowBase, styles.tableRowDetail]}>
                    <View style={styles.descriptionCol}>
                      <Text style={[styles.itemSpecs, styles.itemDetailBlock]}>
                        {bulletLines
                          .map((l, i) => `• ${l}${i < bulletLines.length - 1 ? '\n' : ''}`)
                          .join('')}
                      </Text>
                    </View>
                    <Text style={styles.qtyCol}> </Text>
                    <Text style={styles.priceCol}> </Text>
                    <Text style={styles.totalCol}> </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View wrap={false} style={styles.totalsSection}>
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

        {/* Notes */}
        {(quote as any).notes && (quote as any).notes.replace(/<[^>]*>/g, '').trim() ? (
          <View wrap={false} style={{ marginTop: 15 }}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>Notes:</Text>
            {renderHtmlToPdf((quote as any).notes, { fontSize: 9, color: '#333333', lineHeight: 1.4 })}
          </View>
        ) : null}

        {/* Terms and Conditions */}
        <View style={styles.terms}>
          <Text style={styles.termsTitle}>Terms & Conditions:</Text>
          <Text>
            {(quote as any).terms_conditions || defaultTermsTemplate || FALLBACK_TERMS}
          </Text>
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
  fileName,
  defaultTermsTemplate
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
      // Pre-process images with crop/annotations before PDF generation
      const processedQuote = await preprocessQuoteImages(quote);
      // Generate the PDF as a Blob in the browser
      const blob = await pdf(
        <QuotePDFDocument quote={processedQuote} companyInfo={mergedCompanyInfo} defaultTermsTemplate={defaultTermsTemplate} />
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
          <QuotePDFDocument quote={quote} companyInfo={companyInfo} defaultTermsTemplate={defaultTermsTemplate} />
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
      const processedQuote = await preprocessQuoteImages(quote);
      const blob = await pdf(
        <QuotePDFDocument quote={processedQuote} companyInfo={mergedCompanyInfo} defaultTermsTemplate={defaultTermsTemplate} />
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
      <Button size="sm" variant="outline" onClick={handleOpen} disabled={downloading} className="flex items-center gap-2">
        <Eye size={16} />
        <span className="hidden sm:inline">Preview PDF</span>
        <span className="sm:hidden">Preview</span>
      </Button>
      <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading} className="flex items-center gap-2">
        <Download size={16} />
        <span className="hidden sm:inline">{downloading ? 'Generating...' : 'Download PDF'}</span>
        <span className="sm:hidden">PDF</span>
      </Button>
    </div>
  );
};

export default QuotePDFDocument;
