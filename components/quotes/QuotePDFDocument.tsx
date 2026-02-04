import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { Quote, QuoteItem, QuoteAttachment, QuoteItemType, QuoteItemTextAlign } from '@/lib/db/quotes';

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
    marginTop: 3,
  },
  customerSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  customerInfo: {
    fontSize: 10,
  },
  itemsTable: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottom: 2,
    borderBottomColor: '#000000',
    paddingBottom: 5,
    marginBottom: 5,
    fontWeight: 'bold',
    fontSize: 10,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    fontSize: 9,
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 3,
    fontSize: 9,
    backgroundColor: '#f9f9f9',
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
    flex: 3,
    paddingRight: 10,
  },
  qtyCol: {
    flex: 0.5,
    textAlign: 'right',
    paddingRight: 10,
  },
  priceCol: {
    flex: 1,
    textAlign: 'right',
    paddingRight: 10,
  },
  totalCol: {
    flex: 1,
    textAlign: 'right',
  },
  itemDescription: {
    fontWeight: 'bold',
    marginBottom: 0,
  },
  itemSpecs: {
    fontSize: 8,
    color: '#555',
    marginTop: 0,
  },
  itemDetailBlock: {
    marginTop: 0,
  },
  itemImage: {
    width: 60,
    height: 60,
    objectFit: 'cover',
    marginBottom: 5,
    marginRight: 5,
  },
  totalsSection: {
    marginLeft: 'auto',
    width: 200,
    marginBottom: 20,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    fontSize: 10,
  },
  totalRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
    paddingTop: 5,
    borderTop: 2,
    borderTopColor: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  referenceImages: {
    marginBottom: 20,
  },
  referenceImage: {
    width: 150,
    height: 150,
    objectFit: 'cover',
    marginRight: 10,
    marginBottom: 5,
  },
  referenceImageTitle: {
    fontSize: 8,
    textAlign: 'center',
    marginBottom: 10,
  },
  terms: {
    marginTop: 20,
    fontSize: 8,
    padding: 10,
    backgroundColor: '#f9f9f9',
  },
  termsTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    fontSize: 10,
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
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: '#666',
  },
});

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
}

export interface QuotePDFProps {
  quote: Quote & {
    items: (QuoteItem & { attachments?: QuoteAttachment[] })[];
    attachments: QuoteAttachment[];
    customer?: { id: number; name: string; email?: string | null; telephone?: string | null };
  };
  companyInfo?: Partial<CompanyInfo>;
  /** Default terms template from settings, used when quote has no specific terms */
  defaultTermsTemplate?: string;
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

            // Render heading items - bold text spanning full width
            if (isHeading) {
              return (
                <View key={item.id} wrap={false}>
                  <View style={styles.headingRow}>
                    <View style={styles.fullWidthCol}>
                      <Text style={styles.headingText}>{item.description}</Text>
                    </View>
                  </View>
                  {hasDetails && (
                    <View style={styles.noteRow}>
                      <View style={styles.fullWidthCol}>
                        {itemImages.length > 0 && (
                          <View style={[styles.itemDetailBlock, { flexDirection: 'row', flexWrap: 'wrap' }]}>
                            {itemImages.map((img, i) => (
                              <Image
                                key={i}
                                style={[styles.itemImage, { marginBottom: 1 }]}
                                src={img.file_url}
                              />
                            ))}
                          </View>
                        )}
                        {bulletLines.length > 0 && (
                          <Text style={[styles.itemSpecs, styles.itemDetailBlock]}>
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

            // Render note items - normal text spanning full width
            if (isNote) {
              return (
                <View key={item.id} wrap={false}>
                  <View style={styles.noteRow}>
                    <View style={styles.fullWidthCol}>
                      {item.description && <Text style={styles.noteText}>{item.description}</Text>}
                      {itemImages.length > 0 && (
                        <View style={[styles.itemDetailBlock, { flexDirection: 'row', flexWrap: 'wrap', marginTop: item.description ? 4 : 0 }]}>
                          {itemImages.map((img, i) => (
                            <Image
                              key={i}
                              style={[styles.itemImage, { marginBottom: 1 }]}
                              src={img.file_url}
                            />
                          ))}
                        </View>
                      )}
                      {bulletLines.length > 0 && (
                        <Text style={[styles.itemSpecs, styles.itemDetailBlock]}>
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

            // Render priced items - full row with qty/price/total columns
            const rowBase = index % 2 === 0 ? styles.tableRow : styles.tableRowAlt;
            const headerRowStyle = hasDetails ? [rowBase, styles.tableRowHead] : rowBase;

            return (
              <View key={item.id} wrap={false}>
                <View style={headerRowStyle}>
                  <View style={styles.descriptionCol}>
                    <Text style={styles.itemDescription}>{item.description}</Text>
                  </View>
                  <Text style={styles.qtyCol}>{item.qty}</Text>
                  <Text style={styles.priceCol}>{formatCurrency(Number(item.unit_price || 0))}</Text>
                  <Text style={styles.totalCol}>{formatCurrency(lineTotal(item))}</Text>
                </View>
                {hasDetails && (
                  <View style={[rowBase, styles.tableRowDetail]}>
                    <View style={styles.descriptionCol}>
                      {itemImages.length > 0 && (
                        <View style={[styles.itemDetailBlock, { flexDirection: 'row', flexWrap: 'wrap' }]}>
                          {itemImages.map((img, i) => (
                            <Image
                              key={i}
                              style={[styles.itemImage, { marginBottom: 1 }]}
                              src={img.file_url}
                            />
                          ))}
                        </View>
                      )}
                      {bulletLines.length > 0 && (
                        <Text style={[styles.itemSpecs, styles.itemDetailBlock]}>
                          {bulletLines
                            .map((l, i) => `• ${l}${i < bulletLines.length - 1 ? '\n' : ''}`)
                            .join('')}
                        </Text>
                      )}
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
          <Text>
            {(quote as any).terms || (quote as any).notes || defaultTermsTemplate || FALLBACK_TERMS}
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

export default QuotePDFDocument;
