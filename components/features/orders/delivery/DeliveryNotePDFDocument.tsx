'use client';

import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// This file imports from '@react-pdf/renderer' at the top level. It is ONLY ever
// reached via a dynamic import() from the delivery-note modals (never eagerly bundled
// into a page), which keeps build times sane per the project @react-pdf rule.

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 28,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    borderBottomStyle: 'solid',
    paddingBottom: 10,
  },
  letterhead: {
    flexDirection: 'column',
    maxWidth: 280,
  },
  logo: {
    maxWidth: 160,
    maxHeight: 56,
    marginBottom: 6,
    objectFit: 'contain',
  },
  companyName: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  companyLine: {
    fontSize: 8,
    color: '#444',
    lineHeight: 1.35,
  },
  titleBlock: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  documentTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  documentNumber: {
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: 3,
  },
  documentMeta: {
    fontSize: 8,
    color: '#444',
    textAlign: 'right',
    marginTop: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  metaBlock: {
    flex: 1,
    padding: 8,
    borderWidth: 0.5,
    borderColor: '#d0d0d0',
    borderStyle: 'solid',
    borderRadius: 3,
  },
  metaLabel: {
    fontSize: 7,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#777',
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 9,
    lineHeight: 1.4,
  },
  table: {
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    color: '#FFFFFF',
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 8,
    minHeight: 20,
  },
  codeCol: {
    width: 110,
    fontWeight: 'bold',
  },
  nameCol: {
    flex: 1,
    paddingHorizontal: 4,
  },
  qtyCol: {
    width: 60,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 8,
    backgroundColor: '#f2f2f2',
    fontWeight: 'bold',
  },
  notesSection: {
    marginTop: 4,
    marginBottom: 12,
  },
  notesLabel: {
    fontSize: 7,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#777',
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  notesContent: {
    fontSize: 8,
    padding: 6,
    backgroundColor: '#f9f9f9',
    borderWidth: 0.5,
    borderColor: '#e0e0e0',
    borderStyle: 'solid',
    minHeight: 26,
    lineHeight: 1.4,
  },
  signatureSection: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 32,
  },
  signatureBox: {
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 28,
  },
  signatureLabel: {
    fontSize: 7,
    color: '#666',
    marginTop: 4,
  },
  signatureValue: {
    fontSize: 9,
    marginBottom: 2,
  },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#999',
    borderTopWidth: 0.5,
    borderTopColor: '#e0e0e0',
    borderTopStyle: 'solid',
    paddingTop: 6,
  },
});

export interface DeliveryNotePDFLineItem {
  product_code: string | null;
  product_name: string;
  quantity: number;
}

export interface DeliveryNotePDFCompanyInfo {
  name?: string;
  addressLines?: string[];
  phone?: string;
  email?: string;
  /** Optional letterhead logo URL. */
  logoUrl?: string | null;
}

export interface DeliveryNotePDFProps {
  /** Convenience alias for the company logo URL (letterhead). */
  logoUrl?: string | null;
  company?: DeliveryNotePDFCompanyInfo;
  noteNumber: string;
  /** Display label for the source order (e.g. order number or "Order #123"). */
  orderReference: string;
  deliveryDate: string;
  /** Customer block lines (name, address, etc.). Customer orders may have no customer under RLS. */
  customer?: {
    name?: string | null;
    lines?: string[];
  } | null;
  items: DeliveryNotePDFLineItem[];
  notes?: string | null;
  /** Optional pre-filled signed-by name (printed above the signature line). */
  signedBy?: string | null;
}

function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0';
  const numeric = Number(value);
  if (Math.abs(numeric - Math.round(numeric)) < 0.001) return Math.round(numeric).toString();
  return numeric.toFixed(2);
}

function formatDisplayDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: '2-digit' });
}

const DeliveryNotePDFDocument: React.FC<DeliveryNotePDFProps> = ({
  logoUrl,
  company,
  noteNumber,
  orderReference,
  deliveryDate,
  customer,
  items,
  notes,
  signedBy,
}) => {
  const resolvedLogo = company?.logoUrl ?? logoUrl ?? null;
  const companyName = company?.name ?? 'Unity';
  const companyAddressLines = (company?.addressLines ?? []).filter((line) => !!line && line.trim().length > 0);
  const customerLines = (customer?.lines ?? []).filter((line) => !!line && line.trim().length > 0);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header / letterhead */}
        <View style={styles.header}>
          <View style={styles.letterhead}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {resolvedLogo ? <Image src={resolvedLogo} style={styles.logo} /> : null}
            <Text style={styles.companyName}>{companyName}</Text>
            {companyAddressLines.map((line, index) => (
              <Text key={`addr-${index}`} style={styles.companyLine}>
                {line}
              </Text>
            ))}
            {company?.phone ? <Text style={styles.companyLine}>Tel: {company.phone}</Text> : null}
            {company?.email ? <Text style={styles.companyLine}>{company.email}</Text> : null}
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.documentTitle}>DELIVERY NOTE</Text>
            <Text style={styles.documentNumber}>{noteNumber}</Text>
            <Text style={styles.documentMeta}>Date: {formatDisplayDate(deliveryDate)}</Text>
          </View>
        </View>

        {/* Customer + order meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Deliver To</Text>
            <Text style={styles.metaValue}>{customer?.name ?? '—'}</Text>
            {customerLines.map((line, index) => (
              <Text key={`cust-${index}`} style={styles.metaValue}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Order Reference</Text>
            <Text style={styles.metaValue}>{orderReference}</Text>
            <Text style={[styles.metaValue, { marginTop: 4 }]}>Delivery date: {formatDisplayDate(deliveryDate)}</Text>
          </View>
        </View>

        {/* Line items */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={styles.codeCol}>
              <Text>Code</Text>
            </View>
            <View style={styles.nameCol}>
              <Text>Product</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text>Qty</Text>
            </View>
          </View>
          {items.map((item, index) => (
            <View key={`${item.product_code ?? 'line'}-${index}`} style={styles.tableRow}>
              <View style={styles.codeCol}>
                <Text>{item.product_code || '—'}</Text>
              </View>
              <View style={styles.nameCol}>
                <Text>{item.product_name}</Text>
              </View>
              <View style={styles.qtyCol}>
                <Text>{formatQuantity(item.quantity)}</Text>
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <View style={styles.codeCol}>
              <Text>Total</Text>
            </View>
            <View style={styles.nameCol}>
              <Text>{items.length} line{items.length === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text>{formatQuantity(totalQuantity)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {notes && notes.trim().length > 0 ? (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notes</Text>
            <View style={styles.notesContent}>
              <Text>{notes}</Text>
            </View>
          </View>
        ) : null}

        {/* Signature */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            {signedBy ? <Text style={styles.signatureValue}>{signedBy}</Text> : null}
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Received by (name &amp; signature)</Text>
          </View>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Date</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{companyName} — Delivery Note</Text>
          <Text>{noteNumber}</Text>
        </View>
      </Page>
    </Document>
  );
};

export default DeliveryNotePDFDocument;
