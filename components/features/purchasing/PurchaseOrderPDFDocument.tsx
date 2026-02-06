import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

export interface PurchaseOrderPDFProps {
  purchaseOrder: {
    qNumber: string;
    createdAt: string;
    notes?: string;
    supplierName: string;
    supplierEmail?: string;
    items: Array<{
      supplierCode: string;
      internalCode: string;
      description: string;
      quantity: number;
      unitPrice: number;
      notes?: string | null;
    }>;
  };
  companyInfo: {
    name: string;
    logoUrl?: string | null;
    address: string;
    phone: string;
    email: string;
  };
  importantNotice?: string;
}

const VAT_RATE = 0.15;

const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

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
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 10,
  },
  logo: {
    width: 120,
    height: 40,
    objectFit: 'contain',
    marginBottom: 6,
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  companyInfo: {
    fontSize: 9,
    lineHeight: 1.4,
    color: '#333333',
  },
  poTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  poNumber: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  poDate: {
    fontSize: 10,
    textAlign: 'right',
    marginTop: 3,
    color: '#555555',
  },
  // From/To section
  addressSection: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 20,
  },
  addressBox: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    padding: 12,
  },
  addressLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  addressText: {
    fontSize: 9,
    lineHeight: 1.5,
    color: '#1f2937',
  },
  // Items table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    fontWeight: 'bold',
    fontSize: 8,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    fontSize: 9,
  },
  tableRowAlt: {
    backgroundColor: '#f9fafb',
  },
  noteRow: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    fontSize: 8,
    fontStyle: 'italic',
    color: '#6b7280',
  },
  // Column widths
  colSupplierCode: { width: '12%' },
  colInternalCode: { width: '12%' },
  colDescription: { width: '36%' },
  colQty: { width: '10%', textAlign: 'right' },
  colPrice: { width: '15%', textAlign: 'right' },
  colTotal: { width: '15%', textAlign: 'right' },
  // Totals
  totalsSection: {
    marginTop: 2,
    alignItems: 'flex-end',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
    width: '40%',
  },
  totalLabel: {
    flex: 1,
    textAlign: 'right',
    fontSize: 9,
    paddingRight: 15,
    color: '#374151',
  },
  totalValue: {
    width: 80,
    textAlign: 'right',
    fontSize: 9,
    color: '#374151',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 8,
    width: '40%',
    borderTopWidth: 2,
    borderTopColor: '#10b981',
    marginTop: 2,
  },
  grandTotalLabel: {
    flex: 1,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 'bold',
    paddingRight: 15,
    color: '#047857',
  },
  grandTotalValue: {
    width: 80,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#047857',
  },
  // Notes section
  notesSection: {
    marginTop: 20,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    padding: 12,
  },
  notesLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9,
    lineHeight: 1.5,
    color: '#374151',
  },
  // Important notice
  noticeSection: {
    marginTop: 15,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fbbf24',
    borderRadius: 6,
    padding: 12,
  },
  noticeLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#92400e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  noticeText: {
    fontSize: 8,
    lineHeight: 1.5,
    color: '#78350f',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 8,
    color: '#9ca3af',
  },
});

export default function PurchaseOrderPDFDocument({
  purchaseOrder,
  companyInfo,
  importantNotice,
}: PurchaseOrderPDFProps) {
  const formattedDate = new Date(purchaseOrder.createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const subtotal = purchaseOrder.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const vatAmount = subtotal * VAT_RATE;
  const total = subtotal + vatAmount;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {companyInfo.logoUrl ? (
              <Image src={companyInfo.logoUrl} style={styles.logo} />
            ) : (
              <Text style={styles.companyName}>{companyInfo.name}</Text>
            )}
            <Text style={styles.companyInfo}>
              {companyInfo.name}
              {'\n'}
              {companyInfo.address}
              {'\n'}
              Phone: {companyInfo.phone}
              {'\n'}
              Email: {companyInfo.email}
            </Text>
          </View>
          <View>
            <Text style={styles.poTitle}>PURCHASE ORDER</Text>
            <Text style={styles.poNumber}>PO {purchaseOrder.qNumber}</Text>
            <Text style={styles.poDate}>Date: {formattedDate}</Text>
          </View>
        </View>

        {/* From / To */}
        <View style={styles.addressSection}>
          <View style={styles.addressBox}>
            <Text style={styles.addressLabel}>From</Text>
            <Text style={styles.addressText}>
              {companyInfo.name}
              {'\n'}
              {companyInfo.address}
              {'\n'}
              Phone: {companyInfo.phone}
              {'\n'}
              Email: {companyInfo.email}
            </Text>
          </View>
          <View style={styles.addressBox}>
            <Text style={styles.addressLabel}>To</Text>
            <Text style={styles.addressText}>
              {purchaseOrder.supplierName}
              {purchaseOrder.supplierEmail ? `\nEmail: ${purchaseOrder.supplierEmail}` : ''}
            </Text>
          </View>
        </View>

        {/* Items Table */}
        <View>
          <View style={styles.tableHeader}>
            <Text style={styles.colSupplierCode}>SUPPLIER CODE</Text>
            <Text style={styles.colInternalCode}>INTERNAL CODE</Text>
            <Text style={styles.colDescription}>DESCRIPTION</Text>
            <Text style={styles.colQty}>QTY</Text>
            <Text style={styles.colPrice}>UNIT PRICE</Text>
            <Text style={styles.colTotal}>LINE TOTAL</Text>
          </View>

          {purchaseOrder.items.map((item, index) => {
            const lineTotal = item.quantity * item.unitPrice;
            return (
              <View key={index} wrap={false}>
                <View
                  style={[
                    styles.tableRow,
                    index % 2 !== 0 ? styles.tableRowAlt : {},
                    item.notes ? { borderBottomWidth: 0 } : {},
                  ]}
                >
                  <Text style={styles.colSupplierCode}>{item.supplierCode}</Text>
                  <Text style={styles.colInternalCode}>{item.internalCode}</Text>
                  <Text style={styles.colDescription}>{item.description}</Text>
                  <Text style={styles.colQty}>{item.quantity}</Text>
                  <Text style={styles.colPrice}>{formatCurrency(item.unitPrice)}</Text>
                  <Text style={styles.colTotal}>{formatCurrency(lineTotal)}</Text>
                </View>
                {item.notes && (
                  <View
                    style={[
                      styles.noteRow,
                      index % 2 !== 0 ? styles.tableRowAlt : {},
                      { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
                    ]}
                  >
                    <Text>Note: {item.notes}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection} wrap={false}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal (excl. VAT)</Text>
            <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>VAT @ 15%</Text>
            <Text style={styles.totalValue}>{formatCurrency(vatAmount)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total (incl. VAT)</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Order Notes */}
        {purchaseOrder.notes && (
          <View style={styles.notesSection} wrap={false}>
            <Text style={styles.notesLabel}>Order Notes</Text>
            <Text style={styles.notesText}>{purchaseOrder.notes}</Text>
          </View>
        )}

        {/* Important Notice */}
        {importantNotice && (
          <View style={styles.noticeSection} wrap={false}>
            <Text style={styles.noticeLabel}>Important Notice</Text>
            <Text style={styles.noticeText}>{importantNotice}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{companyInfo.name}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
