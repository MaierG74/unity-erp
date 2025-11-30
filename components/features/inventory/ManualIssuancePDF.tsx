'use client';

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  logo: {
    width: 120,
    height: 50,
    objectFit: 'contain',
  },
  companyInfo: {
    textAlign: 'right',
    fontSize: 9,
    color: '#666',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  infoSection: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 4,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  infoLabel: {
    width: 120,
    fontWeight: 'bold',
    color: '#555',
  },
  infoValue: {
    flex: 1,
  },
  table: {
    marginTop: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#333',
    color: '#fff',
    padding: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    padding: 8,
  },
  tableRowAlt: {
    backgroundColor: '#f8f9fa',
  },
  colComponent: {
    flex: 3,
  },
  colDescription: {
    flex: 4,
  },
  colQuantity: {
    flex: 1,
    textAlign: 'right',
  },
  colPicked: {
    flex: 1,
    textAlign: 'center',
  },
  notesSection: {
    marginTop: 30,
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
  },
  notesTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  notesText: {
    color: '#666',
    lineHeight: 1.4,
  },
  signatureSection: {
    marginTop: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureBox: {
    width: '45%',
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginBottom: 5,
    height: 40,
  },
  signatureLabel: {
    fontSize: 9,
    color: '#666',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: '#999',
  },
});

interface ComponentItem {
  component_id: number;
  internal_code: string;
  description: string | null;
  quantity: number;
}

interface ManualIssuancePDFProps {
  components: ComponentItem[];
  externalReference: string;
  issueCategory: string;
  issuedTo: string | null;
  notes: string | null;
  issuanceDate: string;
  companyInfo?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    logo?: string;
  };
  type: 'picking' | 'issuance';
}

export function ManualIssuancePDFDocument({
  components,
  externalReference,
  issueCategory,
  issuedTo,
  notes,
  issuanceDate,
  companyInfo,
  type,
}: ManualIssuancePDFProps) {
  const isPicking = type === 'picking';
  const title = isPicking ? 'Stock Picking List' : 'Stock Issuance Record';
  const subtitle = isPicking 
    ? 'Components to be picked from inventory' 
    : 'Record of stock issued from inventory';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {companyInfo?.logo && (
              <Image src={companyInfo.logo} style={styles.logo} />
            )}
            {companyInfo?.name && (
              <Text style={{ fontSize: 14, fontWeight: 'bold', marginTop: 5 }}>
                {companyInfo.name}
              </Text>
            )}
          </View>
          <View style={styles.companyInfo}>
            {companyInfo?.address && <Text>{companyInfo.address}</Text>}
            {companyInfo?.phone && <Text>Tel: {companyInfo.phone}</Text>}
            {companyInfo?.email && <Text>Email: {companyInfo.email}</Text>}
          </View>
        </View>

        {/* Title */}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Reference:</Text>
            <Text style={styles.infoValue}>{externalReference || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Category:</Text>
            <Text style={styles.infoValue}>{issueCategory}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Date:</Text>
            <Text style={styles.infoValue}>
              {format(new Date(issuanceDate), 'MMMM d, yyyy HH:mm')}
            </Text>
          </View>
          {issuedTo && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Issued To:</Text>
              <Text style={styles.infoValue}>{issuedTo}</Text>
            </View>
          )}
        </View>

        {/* Components Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colComponent}>Component Code</Text>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQuantity}>Qty</Text>
            {isPicking && <Text style={styles.colPicked}>Picked</Text>}
          </View>
          {components.map((comp, index) => (
            <View 
              key={comp.component_id} 
              style={index % 2 === 1 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow}
            >
              <Text style={styles.colComponent}>{comp.internal_code}</Text>
              <Text style={styles.colDescription}>{comp.description || '-'}</Text>
              <Text style={styles.colQuantity}>{comp.quantity}</Text>
              {isPicking && <Text style={styles.colPicked}>☐</Text>}
            </View>
          ))}
        </View>

        {/* Notes */}
        {notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Notes:</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Picked By / Date</Text>
          </View>
          <View style={styles.signatureBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Received By / Date</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Generated on {format(new Date(), 'MMMM d, yyyy HH:mm')} | Manual Stock Issuance
        </Text>
      </Page>
    </Document>
  );
}
