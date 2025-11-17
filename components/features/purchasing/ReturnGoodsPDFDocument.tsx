'use client';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { format } from 'date-fns';

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
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    borderBottomStyle: 'solid',
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
  documentTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  documentNumber: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 5,
  },
  documentDate: {
    fontSize: 10,
    textAlign: 'right',
    marginTop: 3,
  },
  grn: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: 5,
    color: '#cc0000',
  },
  supplierSection: {
    marginBottom: 20,
  },
  poSection: {
    marginBottom: 20,
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderStyle: 'solid',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  sectionContent: {
    fontSize: 10,
    lineHeight: 1.4,
  },
  itemsTable: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#cc0000',
    color: '#FFFFFF',
    padding: 8,
    fontSize: 10,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#CCCCCC',
    borderBottomStyle: 'solid',
    padding: 8,
    fontSize: 9,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#CCCCCC',
    borderBottomStyle: 'solid',
    backgroundColor: '#f9f9f9',
    padding: 8,
    fontSize: 9,
  },
  componentCol: {
    flex: 2,
  },
  descriptionCol: {
    flex: 3,
    paddingLeft: 5,
  },
  qtyCol: {
    flex: 1,
    textAlign: 'right',
  },
  reasonCol: {
    flex: 2,
    paddingLeft: 5,
  },
  notesSection: {
    marginTop: 10,
    marginBottom: 20,
  },
  notesTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  notesContent: {
    fontSize: 9,
    padding: 8,
    backgroundColor: '#fff9e6',
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderStyle: 'solid',
    minHeight: 40,
  },
  signatureSection: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#CCCCCC',
    borderTopStyle: 'solid',
    paddingTop: 20,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  signatureBox: {
    width: 220,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    borderBottomStyle: 'solid',
    paddingBottom: 5,
    marginTop: 40,
  },
  signatureLabel: {
    fontSize: 9,
    color: '#666',
    marginTop: 5,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: 'column',
    fontSize: 8,
    color: '#666',
    textAlign: 'center',
  },
  returnType: {
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: '#fff9e6',
    padding: 5,
    marginBottom: 10,
    textAlign: 'center',
  },
  warningBox: {
    backgroundColor: '#fff3cd',
    borderWidth: 1,
    borderColor: '#ffc107',
    borderStyle: 'solid',
    padding: 10,
    marginBottom: 15,
  },
  warningText: {
    fontSize: 9,
    color: '#856404',
    textAlign: 'center',
  },
});

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
}

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

interface ReturnGoodsPDFProps {
  goodsReturnNumber: string; // GRN-25-0001
  purchaseOrderNumber: string;
  purchaseOrderId: number;
  returnDate: string;
  items: ReturnItem[];
  supplierInfo: SupplierInfo;
  companyInfo?: Partial<CompanyInfo>;
  notes?: string;
  returnType: 'rejection' | 'later_return' | 'mixed';
}

// PDF Document Component
export const ReturnGoodsPDFDocument: React.FC<ReturnGoodsPDFProps> = ({
  goodsReturnNumber,
  purchaseOrderNumber,
  purchaseOrderId,
  returnDate,
  items,
  supplierInfo,
  companyInfo,
  notes,
  returnType,
}) => {
  const defaultCompanyInfo: CompanyInfo = {
    name: 'Your Company Name',
    address: 'Your Address\nYour City, Postal Code',
    phone: '+27 XX XXX XXXX',
    email: 'info@yourcompany.com',
  };

  const company: CompanyInfo = { ...defaultCompanyInfo, ...(companyInfo || {}) };

  const formatQuantity = (value: number | null | undefined): string => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '0';
    }
    const numeric = Number(value);
    if (Math.abs(numeric - Math.round(numeric)) < 0.001) {
      return Math.round(numeric).toString();
    }
    return numeric.toFixed(2);
  };

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity_returned, 0);

  // Determine document type label
  const getReturnTypeLabel = (): string => {
    if (returnType === 'rejection') {
      return 'REJECTION AT GATE';
    } else if (returnType === 'later_return') {
      return 'GOODS RETURNED FROM STOCK';
    }
    return 'GOODS RETURNED';
  };

  const getReturnTypeDescription = (): string => {
    if (returnType === 'rejection') {
      return 'These goods were rejected during delivery inspection and never entered inventory.';
    } else if (returnType === 'later_return') {
      return 'These goods were previously received into inventory and are now being returned.';
    }
    return 'Mixed return: Some items rejected at gate, others returned from stock.';
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name}</Text>
            <Text style={styles.companyInfo}>{company.address}</Text>
            <Text style={styles.companyInfo}>Tel: {company.phone}</Text>
            <Text style={styles.companyInfo}>Email: {company.email}</Text>
          </View>
          <View>
            <Text style={styles.documentTitle}>GOODS RETURNED</Text>
            <Text style={styles.grn}>{goodsReturnNumber}</Text>
            <Text style={styles.documentNumber}>PO #: {purchaseOrderNumber}</Text>
            <Text style={styles.documentDate}>
              Return Date: {format(new Date(returnDate), 'MMM d, yyyy HH:mm')}
            </Text>
          </View>
        </View>

        {/* Return Type Indicator */}
        <View style={styles.returnType}>
          <Text>{getReturnTypeLabel()}</Text>
        </View>

        {/* Warning Box for Gate Rejections */}
        {returnType === 'rejection' && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              IMPORTANT: These goods were rejected during delivery inspection and did NOT enter inventory.
            </Text>
            <Text style={styles.warningText}>
              A credit note or invoice adjustment is required from the supplier.
            </Text>
          </View>
        )}

        {/* Supplier Information */}
        <View style={styles.supplierSection}>
          <Text style={styles.sectionTitle}>Supplier Information</Text>
          <Text style={styles.sectionContent}>
            Supplier: {supplierInfo.supplier_name}
          </Text>
          {supplierInfo.contact_person && (
            <Text style={styles.sectionContent}>
              Contact: {supplierInfo.contact_person}
            </Text>
          )}
          {supplierInfo.phone && (
            <Text style={styles.sectionContent}>
              Phone: {supplierInfo.phone}
            </Text>
          )}
          {supplierInfo.email && (
            <Text style={styles.sectionContent}>
              Email: {supplierInfo.email}
            </Text>
          )}
        </View>

        {/* Purchase Order Information */}
        <View style={styles.poSection}>
          <Text style={styles.sectionTitle}>Purchase Order Reference</Text>
          <Text style={styles.sectionContent}>
            PO Number: {purchaseOrderNumber}
          </Text>
          <Text style={styles.sectionContent}>
            PO ID: {purchaseOrderId}
          </Text>
          <Text style={styles.sectionContent}>
            Return Type: {getReturnTypeDescription()}
          </Text>
        </View>

        {/* Components Returned Table */}
        <View style={styles.itemsTable}>
          <Text style={styles.sectionTitle}>Components Returned</Text>
          <View style={styles.tableHeader}>
            <View style={styles.componentCol}>
              <Text>Component Code</Text>
            </View>
            <View style={styles.descriptionCol}>
              <Text>Description</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text>Quantity</Text>
            </View>
            <View style={styles.reasonCol}>
              <Text>Reason</Text>
            </View>
          </View>
          {items.map((item, index) => (
            <View key={index} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={styles.componentCol}>
                <Text>{item.component_code}</Text>
              </View>
              <View style={styles.descriptionCol}>
                <Text>{item.component_name || '-'}</Text>
              </View>
              <View style={styles.qtyCol}>
                <Text>{formatQuantity(item.quantity_returned)}</Text>
              </View>
              <View style={styles.reasonCol}>
                <Text>{item.reason}</Text>
              </View>
            </View>
          ))}
          <View style={[styles.tableRow, { backgroundColor: '#f0f0f0', fontWeight: 'bold' }]}>
            <View style={[styles.componentCol, { flex: 5 }]}>
              <Text style={{ fontWeight: 'bold' }}>Total Components</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text style={{ fontWeight: 'bold' }}>{items.length}</Text>
            </View>
            <View style={styles.reasonCol}></View>
          </View>
          <View style={[styles.tableRow, { backgroundColor: '#f0f0f0', fontWeight: 'bold' }]}>
            <View style={[styles.componentCol, { flex: 5 }]}>
              <Text style={{ fontWeight: 'bold' }}>Total Quantity</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text style={{ fontWeight: 'bold' }}>{formatQuantity(totalQuantity)}</Text>
            </View>
            <View style={styles.reasonCol}></View>
          </View>
        </View>

        {/* Notes Section */}
        {notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Additional Notes</Text>
            <View style={styles.notesContent}>
              <Text>{notes}</Text>
            </View>
          </View>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Operator (Name & Signature)</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>
                {returnType === 'rejection' ? 'Driver (Name & Signature)' : 'Supplier Rep (Name & Signature)'}
              </Text>
            </View>
          </View>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Date</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Date</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={{ marginBottom: 3 }}>
            This document confirms the return of goods to supplier.
          </Text>
          <Text>
            {returnType === 'rejection'
              ? 'Goods were rejected and never entered inventory - credit required.'
              : 'Goods were previously received - credit or replacement required.'}
          </Text>
          <Text style={{ marginTop: 5, fontWeight: 'bold' }}>
            Reference: {goodsReturnNumber}
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default ReturnGoodsPDFDocument;
