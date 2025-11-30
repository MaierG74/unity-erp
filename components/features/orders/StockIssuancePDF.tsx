'use client';

import React, { useState, useEffect } from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import type { Order } from '@/types/orders';

// PDF Styles
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 20,
    fontFamily: 'Helvetica',
    fontSize: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    borderBottomStyle: 'solid',
    paddingBottom: 6,
  },
  companyInfo: {
    fontSize: 8,
    lineHeight: 1.3,
  },
  companyName: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  documentTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  documentNumber: {
    fontSize: 9,
    textAlign: 'right',
    marginTop: 2,
  },
  documentDate: {
    fontSize: 8,
    textAlign: 'right',
    marginTop: 1,
  },
  orderSection: {
    marginBottom: 8,
    padding: 6,
    backgroundColor: '#f9f9f9',
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
    color: '#333',
  },
  sectionContent: {
    fontSize: 8,
    lineHeight: 1.3,
  },
  itemsTable: {
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    color: '#FFFFFF',
    padding: 4,
    fontSize: 7,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 7,
    minHeight: 18,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    backgroundColor: '#fafafa',
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 7,
    minHeight: 18,
  },
  componentCol: {
    width: 70,
    fontWeight: 'bold',
  },
  descriptionCol: {
    flex: 1,
    paddingLeft: 3,
    paddingRight: 5,
  },
  qtyCol: {
    width: 40,
    textAlign: 'right',
  },
  notesSection: {
    marginTop: 6,
    marginBottom: 6,
  },
  notesTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  notesContent: {
    fontSize: 7,
    padding: 4,
    backgroundColor: '#f9f9f9',
    borderWidth: 0.5,
    borderColor: '#e0e0e0',
    borderStyle: 'solid',
    minHeight: 25,
  },
  signatureSection: {
    marginTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#ccc',
    borderTopStyle: 'solid',
    paddingTop: 8,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  signatureBox: {
    width: 150,
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    paddingBottom: 3,
    marginTop: 20,
  },
  signatureLabel: {
    fontSize: 7,
    color: '#666',
    marginTop: 3,
  },
  footer: {
    position: 'absolute',
    bottom: 10,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    fontSize: 6,
    color: '#999',
  },
});

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
}

interface StockIssuancePDFProps {
  order: Order;
  issuances: Array<{
    issuance_id: number;
    component_id: number;
    component: {
      internal_code: string;
      description: string | null;
    };
    quantity_issued: number;
    issuance_date: string;
    notes: string | null;
  }>;
  issuanceDate: string;
  companyInfo?: Partial<CompanyInfo>;
}

// PDF Document Component
export const StockIssuancePDFDocument: React.FC<StockIssuancePDFProps> = ({
  order,
  issuances,
  issuanceDate,
  companyInfo,
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

  // Aggregate issuances by component (in case same component appears multiple times)
  const aggregatedIssuances = issuances.reduce((acc, issuance) => {
    const key = issuance.component_id;
    if (acc[key]) {
      acc[key].quantity_issued += Number(issuance.quantity_issued || 0);
    } else {
      acc[key] = {
        ...issuance,
        quantity_issued: Number(issuance.quantity_issued || 0),
      };
    }
    return acc;
  }, {} as Record<number, typeof issuances[0]>);

  const issuanceList = Object.values(aggregatedIssuances);
  const totalQuantity = issuanceList.reduce((sum, item) => sum + item.quantity_issued, 0);
  const allNotes = issuances.map(i => i.notes).filter(Boolean).join('; ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name}</Text>
          </View>
          <View>
            <Text style={styles.documentTitle}>STOCK ISSUANCE</Text>
            <Text style={styles.documentNumber}>Order #: {order.order_id}</Text>
            <Text style={styles.documentDate}>
              Issuance Date: {format(new Date(issuanceDate), 'MMM d, yyyy HH:mm')}
            </Text>
          </View>
        </View>

        {/* Order Information */}
        <View style={styles.orderSection}>
          <Text style={styles.sectionTitle}>Order Information</Text>
          <Text style={styles.sectionContent}>
            Order Number: {order.order_id}
          </Text>
          {order.customer && (
            <Text style={styles.sectionContent}>
              Customer: {order.customer.name || `Customer ID: ${order.customer_id}`}
            </Text>
          )}
          {order.order_date && (
            <Text style={styles.sectionContent}>
              Order Date: {format(new Date(order.order_date), 'MMM d, yyyy')}
            </Text>
          )}
        </View>

        {/* Components Issued Table */}
        <View style={styles.itemsTable}>
          <Text style={styles.sectionTitle}>Components Issued</Text>
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
          </View>
          {issuanceList.map((issuance, index) => (
            <View key={issuance.issuance_id} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={styles.componentCol}>
                <Text>{issuance.component?.internal_code || 'N/A'}</Text>
              </View>
              <View style={styles.descriptionCol}>
                <Text>{issuance.component?.description || '-'}</Text>
              </View>
              <View style={styles.qtyCol}>
                <Text>{formatQuantity(issuance.quantity_issued)}</Text>
              </View>
            </View>
          ))}
          <View style={[styles.tableRow, { backgroundColor: '#f0f0f0', fontWeight: 'bold' }]}>
            <View style={[styles.componentCol, { flex: 5 }]}>
              <Text style={{ fontWeight: 'bold' }}>Total Components Issued</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text style={{ fontWeight: 'bold' }}>{issuanceList.length}</Text>
            </View>
          </View>
          <View style={[styles.tableRow, { backgroundColor: '#f0f0f0', fontWeight: 'bold' }]}>
            <View style={[styles.componentCol, { flex: 5 }]}>
              <Text style={{ fontWeight: 'bold' }}>Total Quantity</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text style={{ fontWeight: 'bold' }}>{formatQuantity(totalQuantity)}</Text>
            </View>
          </View>
        </View>

        {/* Notes Section */}
        {allNotes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Notes</Text>
            <View style={styles.notesContent}>
              <Text>{allNotes}</Text>
            </View>
          </View>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Issued By (Name & Signature)</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Received By (Name & Signature)</Text>
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
          <Text>This document confirms the issuance of stock items from inventory.</Text>
        </View>
      </Page>
    </Document>
  );
};

interface StockIssuancePDFDownloadProps {
  order: Order;
  issuances: Array<{
    issuance_id: number;
    component_id: number;
    component: {
      internal_code: string;
      description: string | null;
    };
    quantity_issued: number;
    issuance_date: string;
    notes: string | null;
  }>;
  issuanceDate: string;
  companyInfo?: Partial<CompanyInfo>;
}

export const StockIssuancePDFDownload: React.FC<StockIssuancePDFDownloadProps> = ({
  order,
  issuances,
  issuanceDate,
  companyInfo,
}) => {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const blob = await pdf(
        <StockIssuancePDFDocument
          order={order}
          issuances={issuances}
          issuanceDate={issuanceDate}
          companyInfo={companyInfo}
        />
      ).toBlob();
      
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const filename = `stock_issuance_order_${order.order_id}_${format(new Date(issuanceDate), 'yyyy-MM-dd')}.pdf`;

      // Prefer native Save dialog when supported
      const anyWindow = window as any;
      if (anyWindow && typeof anyWindow.showSaveFilePicker === 'function') {
        const handle = await anyWindow.showSaveFilePicker({
          suggestedName: filename,
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
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      // Fallback: open in new tab
      try {
        const blob = await pdf(
          <StockIssuancePDFDocument
            order={order}
            issuances={issuances}
            issuanceDate={issuanceDate}
            companyInfo={companyInfo}
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

  const handlePrint = async () => {
    try {
      setDownloading(true);
      const blob = await pdf(
        <StockIssuancePDFDocument
          order={order}
          issuances={issuances}
          issuanceDate={issuanceDate}
          companyInfo={companyInfo}
        />
      ).toBlob();
      
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('Failed to generate PDF for printing:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleDownload} disabled={downloading} variant="outline" size="sm">
        <Download className="mr-2 h-4 w-4" />
        {downloading ? 'Generating...' : 'Download PDF'}
      </Button>
      <Button onClick={handlePrint} disabled={downloading} variant="outline" size="sm">
        <Printer className="mr-2 h-4 w-4" />
        Print
      </Button>
    </div>
  );
};

export default StockIssuancePDFDocument;

