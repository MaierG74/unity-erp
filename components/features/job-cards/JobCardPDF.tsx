'use client';

import React, { useState } from 'react';
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

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
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  documentNumber: {
    fontSize: 10,
    textAlign: 'right',
    marginTop: 2,
  },
  documentDate: {
    fontSize: 8,
    textAlign: 'right',
    marginTop: 1,
  },
  infoSection: {
    marginBottom: 10,
    padding: 8,
    backgroundColor: '#f9f9f9',
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  infoItem: {
    width: '50%',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 7,
    color: '#666',
    textTransform: 'uppercase',
  },
  infoValue: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 6,
    marginTop: 8,
    textTransform: 'uppercase',
    color: '#333',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    borderBottomStyle: 'solid',
    paddingBottom: 2,
  },
  itemsTable: {
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    color: '#FFFFFF',
    padding: 5,
    fontSize: 7,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    minHeight: 22,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
    borderBottomStyle: 'solid',
    backgroundColor: '#fafafa',
    paddingVertical: 6,
    paddingHorizontal: 5,
    fontSize: 8,
    minHeight: 22,
  },
  productCol: {
    width: '35%',
  },
  jobCol: {
    width: '25%',
  },
  qtyCol: {
    width: '15%',
    textAlign: 'right',
  },
  rateCol: {
    width: '12%',
    textAlign: 'right',
  },
  totalCol: {
    width: '13%',
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 6,
    marginTop: 2,
  },
  totalLabel: {
    flex: 1,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'right',
    paddingRight: 10,
  },
  totalValue: {
    width: 70,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  workLogSection: {
    marginTop: 15,
    marginBottom: 10,
  },
  workLogTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  workLogRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  workLogField: {
    flex: 1,
    marginRight: 10,
  },
  workLogLabel: {
    fontSize: 7,
    color: '#666',
    marginBottom: 2,
  },
  workLogLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 20,
  },
  notesBox: {
    borderWidth: 0.5,
    borderColor: '#ccc',
    borderStyle: 'solid',
    padding: 6,
    minHeight: 40,
    marginTop: 4,
    fontSize: 8,
  },
  signatureSection: {
    marginTop: 20,
    borderTopWidth: 0.5,
    borderTopColor: '#ccc',
    borderTopStyle: 'solid',
    paddingTop: 10,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureBlock: {
    width: '45%',
  },
  signatureLabel: {
    fontSize: 7,
    color: '#666',
    marginBottom: 2,
  },
  signatureLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 25,
    marginBottom: 4,
  },
  dateLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 15,
    width: 100,
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
  address?: string;
  phone?: string;
  email?: string;
}

interface JobCardItem {
  item_id: number;
  product_name: string;
  product_code: string;
  job_name: string;
  quantity: number;
  piece_rate: number;
}

interface JobCardPDFProps {
  jobCard: {
    job_card_id: number;
    staff_name: string;
    order_number: string | null;
    customer_name: string | null;
    issue_date: string;
    due_date: string | null;
    notes: string | null;
  };
  items: JobCardItem[];
  companyInfo?: Partial<CompanyInfo>;
}

// PDF Document Component
export const JobCardPDFDocument: React.FC<JobCardPDFProps> = ({
  jobCard,
  items,
  companyInfo,
}) => {
  const totalValue = items.reduce((sum, item) => sum + item.quantity * item.piece_rate, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>{companyInfo?.name || 'Unity Manufacturing'}</Text>
            {companyInfo?.address && <Text>{companyInfo.address}</Text>}
            {companyInfo?.phone && <Text>Tel: {companyInfo.phone}</Text>}
            {companyInfo?.email && <Text>{companyInfo.email}</Text>}
          </View>
          <View>
            <Text style={styles.documentTitle}>JOB CARD</Text>
            <Text style={styles.documentNumber}>#{jobCard.job_card_id}</Text>
            <Text style={styles.documentDate}>
              Issued: {format(new Date(jobCard.issue_date), 'MMM d, yyyy')}
            </Text>
          </View>
        </View>

        {/* Assignment Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoGrid}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Assigned To</Text>
              <Text style={styles.infoValue}>{jobCard.staff_name}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Due Date</Text>
              <Text style={styles.infoValue}>
                {jobCard.due_date
                  ? format(new Date(jobCard.due_date), 'MMM d, yyyy')
                  : 'No due date'}
              </Text>
            </View>
            {jobCard.order_number && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Order</Text>
                <Text style={styles.infoValue}>{jobCard.order_number}</Text>
              </View>
            )}
            {jobCard.customer_name && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Customer</Text>
                <Text style={styles.infoValue}>{jobCard.customer_name}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Notes */}
        {jobCard.notes && (
          <View>
            <Text style={styles.sectionTitle}>Instructions / Notes</Text>
            <View style={styles.notesBox}>
              <Text>{jobCard.notes}</Text>
            </View>
          </View>
        )}

        {/* Items Table */}
        <Text style={styles.sectionTitle}>Work Items</Text>
        <View style={styles.itemsTable}>
          <View style={styles.tableHeader}>
            <View style={styles.productCol}>
              <Text>Product</Text>
            </View>
            <View style={styles.jobCol}>
              <Text>Job / Operation</Text>
            </View>
            <View style={styles.qtyCol}>
              <Text>Qty</Text>
            </View>
            <View style={styles.rateCol}>
              <Text>Rate</Text>
            </View>
            <View style={styles.totalCol}>
              <Text>Total</Text>
            </View>
          </View>
          {items.map((item, index) => (
            <View key={item.item_id} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={styles.productCol}>
                <Text style={{ fontWeight: 'bold' }}>{item.product_name}</Text>
                <Text style={{ fontSize: 6, color: '#666' }}>{item.product_code}</Text>
              </View>
              <View style={styles.jobCol}>
                <Text>{item.job_name}</Text>
              </View>
              <View style={styles.qtyCol}>
                <Text>{item.quantity}</Text>
              </View>
              <View style={styles.rateCol}>
                <Text>${item.piece_rate.toFixed(2)}</Text>
              </View>
              <View style={styles.totalCol}>
                <Text>${(item.quantity * item.piece_rate).toFixed(2)}</Text>
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Items: {items.length} | Total Qty: {totalQuantity}</Text>
            <Text style={styles.totalValue}>${totalValue.toFixed(2)}</Text>
          </View>
        </View>

        {/* Work Log Section */}
        <View style={styles.workLogSection}>
          <Text style={styles.workLogTitle}>Work Log</Text>
          <View style={styles.workLogRow}>
            <View style={styles.workLogField}>
              <Text style={styles.workLogLabel}>Start Time</Text>
              <View style={styles.workLogLine} />
            </View>
            <View style={styles.workLogField}>
              <Text style={styles.workLogLabel}>End Time</Text>
              <View style={styles.workLogLine} />
            </View>
            <View style={styles.workLogField}>
              <Text style={styles.workLogLabel}>Total Hours</Text>
              <View style={styles.workLogLine} />
            </View>
          </View>
          <Text style={styles.workLogLabel}>Work Notes / Issues</Text>
          <View style={[styles.notesBox, { minHeight: 50 }]} />
        </View>

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>Issued By</Text>
              <View style={styles.signatureLine} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.signatureLabel}>Name & Signature</Text>
                <View>
                  <Text style={styles.signatureLabel}>Date</Text>
                  <View style={styles.dateLine} />
                </View>
              </View>
            </View>
            <View style={styles.signatureBlock}>
              <Text style={styles.signatureLabel}>Received By</Text>
              <View style={styles.signatureLine} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.signatureLabel}>Name & Signature</Text>
                <View>
                  <Text style={styles.signatureLabel}>Date</Text>
                  <View style={styles.dateLine} />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Job Card #{jobCard.job_card_id} - Please return this card upon completion of work</Text>
        </View>
      </Page>
    </Document>
  );
};

// Download/Print Button Component
interface JobCardPDFDownloadProps {
  jobCard: {
    job_card_id: number;
    staff_name: string;
    order_number: string | null;
    customer_name: string | null;
    issue_date: string;
    due_date: string | null;
    notes: string | null;
  };
  items: JobCardItem[];
  companyInfo?: Partial<CompanyInfo>;
}

export const JobCardPDFDownload: React.FC<JobCardPDFDownloadProps> = ({
  jobCard,
  items,
  companyInfo,
}) => {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const blob = await pdf(
        <JobCardPDFDocument
          jobCard={jobCard}
          items={items}
          companyInfo={companyInfo}
        />
      ).toBlob();

      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const filename = `job_card_${jobCard.job_card_id}_${format(new Date(jobCard.issue_date), 'yyyy-MM-dd')}.pdf`;

      // Prefer native Save dialog when supported
      const anyWindow = window as any;
      if (anyWindow && typeof anyWindow.showSaveFilePicker === 'function') {
        try {
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
          return;
        } catch (e) {
          // User cancelled or API not available, fall through to anchor download
        }
      }

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
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      // Fallback: open in new tab
      try {
        const blob = await pdf(
          <JobCardPDFDocument
            jobCard={jobCard}
            items={items}
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
        <JobCardPDFDocument
          jobCard={jobCard}
          items={items}
          companyInfo={companyInfo}
        />
      ).toBlob();

      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);

      // Open in new tab for printing
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('Failed to generate PDF for printing:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleDownload} disabled={downloading} variant="outline">
        <Download className="mr-2 h-4 w-4" />
        {downloading ? 'Generating...' : 'Download PDF'}
      </Button>
      <Button onClick={handlePrint} disabled={downloading} variant="outline">
        <Printer className="mr-2 h-4 w-4" />
        Print
      </Button>
    </div>
  );
};

export default JobCardPDFDocument;
