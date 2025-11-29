'use client';

import React, { useState } from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  infoRow: {
    flexDirection: 'row',
    marginBottom: 1,
  },
  infoLabel: {
    width: 70,
    fontSize: 7,
    color: '#666',
  },
  infoValue: {
    flex: 1,
    fontSize: 8,
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
  checkCol: {
    width: 20,
    textAlign: 'center',
  },
  checkBox: {
    width: 10,
    height: 10,
    borderWidth: 0.5,
    borderColor: '#333',
    borderStyle: 'solid',
    backgroundColor: '#fff',
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
    textAlign: 'center',
    fontWeight: 'bold',
  },
  pickedCol: {
    width: 40,
    textAlign: 'center',
  },
  pickedBox: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#999',
    borderBottomStyle: 'solid',
    minHeight: 10,
    marginHorizontal: 3,
  },
  totalsRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 4,
    fontSize: 8,
    fontWeight: 'bold',
    borderTopWidth: 1,
    borderTopColor: '#333',
    borderTopStyle: 'solid',
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
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#ccc',
    borderTopStyle: 'solid',
  },
  signatureTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  signatureGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureBlock: {
    width: '45%',
  },
  signatureBox: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 25,
    marginBottom: 2,
  },
  signatureLabel: {
    fontSize: 7,
    color: '#666',
    marginBottom: 8,
  },
  dateBox: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    width: 80,
    height: 12,
    marginTop: 4,
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
  footerText: {
    marginBottom: 0,
  },
});

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

interface ComponentToIssue {
  component_id: number;
  internal_code: string;
  description: string | null;
  quantity: number;
  location?: string;
}

interface StockPickingListPDFProps {
  order: Order;
  components: ComponentToIssue[];
  issuedTo?: string | null;
  notes?: string | null;
  companyInfo?: Partial<CompanyInfo>;
}

// PDF Document Component
export const StockPickingListPDFDocument: React.FC<StockPickingListPDFProps> = ({
  order,
  components,
  issuedTo,
  notes,
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

  const totalItems = components.length;
  const totalQuantity = components.reduce((sum, c) => sum + (c.quantity || 0), 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name}</Text>
          </View>
          <View>
            <Text style={styles.documentTitle}>STOCK PICKING LIST</Text>
            <Text style={styles.documentNumber}>Order #: {order.order_id}</Text>
            <Text style={styles.documentDate}>
              Date: {format(new Date(), 'MMM d, yyyy')}
            </Text>
            <Text style={styles.documentDate}>
              Time: {format(new Date(), 'HH:mm')}
            </Text>
          </View>
        </View>

        {/* Order & Customer Information */}
        <View style={styles.orderSection}>
          <Text style={styles.sectionTitle}>Order Details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Order ID:</Text>
            <Text style={styles.infoValue}>{order.order_id}</Text>
          </View>
          {order.order_number && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Order Number:</Text>
              <Text style={styles.infoValue}>{order.order_number}</Text>
            </View>
          )}
          {order.customer && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Customer:</Text>
              <Text style={styles.infoValue}>{order.customer.name}</Text>
            </View>
          )}
          {order.delivery_date && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Delivery Date:</Text>
              <Text style={styles.infoValue}>{format(new Date(order.delivery_date), 'MMM d, yyyy')}</Text>
            </View>
          )}
          {issuedTo && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Issue To:</Text>
              <Text style={styles.infoValue}>{issuedTo}</Text>
            </View>
          )}
        </View>

        {/* Components to Pick Table */}
        <View style={styles.itemsTable}>
          <View style={styles.tableHeader}>
            <View style={styles.checkCol}>
              <Text>✓</Text>
            </View>
            <View style={styles.componentCol}>
              <Text>Code</Text>
            </View>
            <View style={styles.descriptionCol}>
              <Text>Description</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text>Qty</Text>
            </View>
            <View style={styles.pickedCol}>
              <Text>Picked</Text>
            </View>
          </View>
          {components.map((component, index) => (
            <View key={component.component_id} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={styles.checkCol}>
                <View style={styles.checkBox} />
              </View>
              <View style={styles.componentCol}>
                <Text>{component.internal_code || 'N/A'}</Text>
              </View>
              <View style={styles.descriptionCol}>
                <Text>{component.description || '-'}</Text>
              </View>
              <View style={styles.qtyCol}>
                <Text>{formatQuantity(component.quantity)}</Text>
              </View>
              <View style={styles.pickedCol}>
                <View style={styles.pickedBox} />
              </View>
            </View>
          ))}
          {/* Totals Row */}
          <View style={styles.totalsRow}>
            <View style={styles.checkCol}>
              <Text></Text>
            </View>
            <View style={[styles.componentCol, { flex: 1 }]}>
              <Text>TOTAL: {totalItems} items</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text>{formatQuantity(totalQuantity)}</Text>
            </View>
            <View style={styles.pickedCol}>
              <Text></Text>
            </View>
          </View>
        </View>

        {/* Notes Section */}
        <View style={styles.notesSection}>
          <Text style={styles.notesTitle}>Notes / Discrepancies</Text>
          <View style={styles.notesContent}>
            {notes ? <Text>{notes}</Text> : <Text style={{ color: '#999' }}>(Record any discrepancies or notes here)</Text>}
          </View>
        </View>

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <Text style={styles.signatureTitle}>Acknowledgement</Text>
          <View style={styles.signatureGrid}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>Picked By:</Text>
              <View style={styles.signatureBox} />
              <Text style={styles.signatureLabel}>Name & Signature</Text>
              <View style={styles.dateBox} />
              <Text style={styles.signatureLabel}>Date</Text>
            </View>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>Received By:</Text>
              <View style={styles.signatureBox} />
              <Text style={styles.signatureLabel}>Name & Signature</Text>
              <View style={styles.dateBox} />
              <Text style={styles.signatureLabel}>Date</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Generated: {format(new Date(), 'MMM d, yyyy HH:mm')}</Text>
        </View>
      </Page>
    </Document>
  );
};

interface StockPickingListDownloadProps {
  order: Order;
  components: ComponentToIssue[];
  issuedTo?: string | null;
  notes?: string | null;
  companyInfo?: Partial<CompanyInfo>;
  disabled?: boolean;
}

export const StockPickingListDownload: React.FC<StockPickingListDownloadProps> = ({
  order,
  components,
  issuedTo,
  notes,
  companyInfo,
  disabled,
}) => {
  const [downloading, setDownloading] = useState(false);

  const handleOpenPDF = async () => {
    if (components.length === 0) return;
    
    try {
      setDownloading(true);
      const blob = await pdf(
        <StockPickingListPDFDocument
          order={order}
          components={components}
          issuedTo={issuedTo}
          notes={notes}
          companyInfo={companyInfo}
        />
      ).toBlob();
      
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, '_blank');
      // Clean up after a delay to allow the new tab to load
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('Failed to generate picking list PDF:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button 
      onClick={handleOpenPDF} 
      disabled={disabled || downloading || components.length === 0} 
      variant="outline" 
      size="sm"
    >
      {downloading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Generating...
        </>
      ) : (
        <>
          <FileText className="mr-2 h-4 w-4" />
          Picking List
        </>
      )}
    </Button>
  );
};

export default StockPickingListPDFDocument;
