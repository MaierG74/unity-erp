import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { format } from 'date-fns';

// ── Types ──────────────────────────────────────────────────────────
export interface JobCardPDFItem {
  item_id: number;
  product_name: string;
  product_code: string;
  job_name: string;
  quantity: number;
  completed_quantity?: number;
  piece_rate: number;
}

export interface JobCardPDFData {
  job_card_id: number;
  staff_name: string;
  order_number: string | null;
  customer_name: string | null;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  status?: string;
  priority?: 'high' | 'medium' | 'low' | null;
  scheduled_time?: string | null;
}

export interface CompanyInfo {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string | null;
}

export interface JobCardPDFDocumentProps {
  jobCard: JobCardPDFData;
  items: JobCardPDFItem[];
  companyInfo?: Partial<CompanyInfo>;
  /** QR code as a data URL (PNG). Generated before rendering. */
  qrCodeDataUrl?: string | null;
  /** Product drawing as a URL or data URL. Optional. */
  drawingUrl?: string | null;
}

// ── Styles ─────────────────────────────────────────────────────────
const ACCENT = '#1a1a1a';
const LIGHT_BG = '#f8f8f8';
const BORDER = '#e0e0e0';
const MUTED = '#666666';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 28,
    fontFamily: 'Helvetica',
    fontSize: 8,
  },

  // Header row
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    borderBottomStyle: 'solid',
  },
  companySection: { maxWidth: '55%' },
  companyName: { fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  companyDetail: { fontSize: 8, lineHeight: 1.4, color: '#333' },
  titleSection: { alignItems: 'flex-end' },
  docTitle: { fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  docNumber: { fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  docDate: { fontSize: 8, color: MUTED, marginTop: 1 },
  qrBox: { marginTop: 6, alignItems: 'center' },
  qrImage: { width: 64, height: 64 },
  qrLabel: { fontSize: 6, color: MUTED, marginTop: 2 },

  // Priority strip
  priorityStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 4,
  },

  // Info grid
  infoSection: {
    flexDirection: 'row',
    marginBottom: 10,
    gap: 8,
  },
  infoCard: {
    flex: 1,
    backgroundColor: LIGHT_BG,
    borderWidth: 0.5,
    borderColor: BORDER,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 8,
  },
  infoLabel: {
    fontSize: 6,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: { fontSize: 10, fontWeight: 'bold' },
  infoSubValue: { fontSize: 7, color: MUTED, marginTop: 1 },

  // Section headers
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#333',
    marginBottom: 5,
    marginTop: 10,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderBottomStyle: 'solid',
  },

  // Items table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: ACCENT,
    color: '#FFFFFF',
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: 7,
    fontWeight: 'bold',
    borderRadius: 2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    borderBottomStyle: 'solid',
    fontSize: 8,
  },
  tableRowAlt: { backgroundColor: '#fafafa' },
  colProduct: { width: '30%' },
  colJob: { width: '22%' },
  colQty: { width: '12%', textAlign: 'right' },
  colRate: { width: '18%', textAlign: 'right' },
  colTotal: { width: '18%', textAlign: 'right' },

  totalRow: {
    flexDirection: 'row',
    backgroundColor: LIGHT_BG,
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginTop: 1,
    borderRadius: 2,
  },
  totalLabel: {
    flex: 1,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'right',
    paddingRight: 8,
  },
  totalValue: {
    width: 80,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'right',
  },

  // Notes box
  notesBox: {
    borderWidth: 0.5,
    borderColor: BORDER,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 6,
    minHeight: 30,
    fontSize: 8,
    marginTop: 2,
    backgroundColor: '#fffff0',
  },

  // Drawing area
  drawingSection: { marginTop: 10 },
  drawingImage: {
    maxWidth: '100%',
    maxHeight: 220,
    objectFit: 'contain',
  },

  // Work log
  workLog: { marginTop: 12 },
  workLogRow: { flexDirection: 'row', marginBottom: 12, gap: 10 },
  workLogField: { flex: 1 },
  workLogLabel: { fontSize: 7, color: MUTED, marginBottom: 3 },
  workLogLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 18,
  },

  // Signature
  signatureSection: {
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    borderTopStyle: 'solid',
  },
  signatureRow: { flexDirection: 'row', justifyContent: 'space-between' },
  signatureBlock: { width: '45%' },
  signatureLabel: { fontSize: 7, color: MUTED, marginBottom: 2 },
  signatureLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 22,
    marginBottom: 3,
  },
  dateLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    borderBottomStyle: 'solid',
    height: 14,
    width: 90,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    borderTopStyle: 'solid',
    paddingTop: 6,
    fontSize: 6,
    color: '#999',
  },
});

const priorityColors: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

// ── Document Component ─────────────────────────────────────────────
export default function JobCardPDFDocument({
  jobCard,
  items,
  companyInfo,
  qrCodeDataUrl,
  drawingUrl,
}: JobCardPDFDocumentProps) {
  const totalValue = items.reduce((sum, item) => sum + item.quantity * item.piece_rate, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const priorityColor = jobCard.priority ? priorityColors[jobCard.priority] : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Priority colour strip on left edge */}
        {priorityColor && (
          <View style={[styles.priorityStrip, { backgroundColor: priorityColor }]} fixed />
        )}

        {/* ── Header ─────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.companySection}>
            {companyInfo?.logoUrl ? (
              <Image src={companyInfo.logoUrl} style={{ width: 110, height: 36, objectFit: 'contain', marginBottom: 4 }} />
            ) : (
              <Text style={styles.companyName}>{companyInfo?.name || 'Unity Manufacturing'}</Text>
            )}
            {companyInfo?.address && <Text style={styles.companyDetail}>{companyInfo.address}</Text>}
            {companyInfo?.phone && <Text style={styles.companyDetail}>Tel: {companyInfo.phone}</Text>}
            {companyInfo?.email && <Text style={styles.companyDetail}>{companyInfo.email}</Text>}
          </View>

          <View style={styles.titleSection}>
            <Text style={styles.docTitle}>JOB CARD</Text>
            <Text style={styles.docNumber}>#{jobCard.job_card_id}</Text>
            <Text style={styles.docDate}>
              Issued: {format(new Date(jobCard.issue_date + 'T00:00:00'), 'dd MMM yyyy')}
            </Text>
            {qrCodeDataUrl && (
              <View style={styles.qrBox}>
                <Image src={qrCodeDataUrl} style={styles.qrImage} />
                <Text style={styles.qrLabel}>Scan to view / update</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Info Grid ──────────────────────────────── */}
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Assigned To</Text>
            <Text style={styles.infoValue}>{jobCard.staff_name || 'UNASSIGNED'}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Order</Text>
            <Text style={styles.infoValue}>{jobCard.order_number || '—'}</Text>
            {jobCard.customer_name && (
              <Text style={styles.infoSubValue}>{jobCard.customer_name}</Text>
            )}
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Due Date</Text>
            <Text style={styles.infoValue}>
              {jobCard.due_date
                ? format(new Date(jobCard.due_date + 'T00:00:00'), 'dd MMM yyyy')
                : 'No due date'}
            </Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={styles.infoValue}>
              {jobCard.status ? jobCard.status.charAt(0).toUpperCase() + jobCard.status.slice(1).replace('_', ' ') : 'Pending'}
            </Text>
            {jobCard.priority && (
              <Text style={[styles.infoSubValue, { color: priorityColor || MUTED }]}>
                Priority: {jobCard.priority.toUpperCase()}
              </Text>
            )}
          </View>
        </View>

        {/* ── Instructions / Notes ───────────────────── */}
        {jobCard.notes && (
          <View>
            <Text style={styles.sectionTitle}>Instructions / Notes</Text>
            <View style={styles.notesBox}>
              <Text>{jobCard.notes}</Text>
            </View>
          </View>
        )}

        {/* ── Work Items Table ────────────────────────── */}
        <Text style={styles.sectionTitle}>Work Items</Text>
        <View>
          <View style={styles.tableHeader}>
            <Text style={styles.colProduct}>PRODUCT</Text>
            <Text style={styles.colJob}>JOB / OPERATION</Text>
            <Text style={styles.colQty}>QTY</Text>
            <Text style={styles.colRate}>RATE</Text>
            <Text style={styles.colTotal}>TOTAL</Text>
          </View>
          {items.map((item, index) => (
            <View
              key={item.item_id}
              style={[styles.tableRow, index % 2 !== 0 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              <View style={styles.colProduct}>
                <Text style={{ fontWeight: 'bold' }}>{item.product_name}</Text>
                {item.product_code ? (
                  <Text style={{ fontSize: 6, color: MUTED }}>{item.product_code}</Text>
                ) : null}
              </View>
              <View style={styles.colJob}>
                <Text>{item.job_name}</Text>
              </View>
              <View style={styles.colQty}>
                <Text>{item.quantity}</Text>
              </View>
              <View style={styles.colRate}>
                <Text>{formatCurrency(item.piece_rate)}</Text>
              </View>
              <View style={styles.colTotal}>
                <Text>{formatCurrency(item.quantity * item.piece_rate)}</Text>
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {items.length} item{items.length !== 1 ? 's' : ''} · {totalQuantity} units
            </Text>
            <Text style={styles.totalValue}>{formatCurrency(totalValue)}</Text>
          </View>
        </View>

        {/* ── Drawing ────────────────────────────────── */}
        {drawingUrl && (
          <View style={styles.drawingSection} wrap={false}>
            <Text style={styles.sectionTitle}>Product Drawing</Text>
            <Image src={drawingUrl} style={styles.drawingImage} />
          </View>
        )}

        {/* ── Work Log ───────────────────────────────── */}
        <View style={styles.workLog} wrap={false}>
          <Text style={styles.sectionTitle}>Work Log</Text>
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
          <View style={styles.workLogRow}>
            <View style={styles.workLogField}>
              <Text style={styles.workLogLabel}>Qty Completed</Text>
              <View style={styles.workLogLine} />
            </View>
            <View style={styles.workLogField}>
              <Text style={styles.workLogLabel}>Qty Rejected</Text>
              <View style={styles.workLogLine} />
            </View>
            <View style={styles.workLogField}>
              <Text style={styles.workLogLabel}>Reason (if rejected)</Text>
              <View style={styles.workLogLine} />
            </View>
          </View>
          <Text style={styles.workLogLabel}>Work Notes / Issues</Text>
          <View style={[styles.notesBox, { minHeight: 36, backgroundColor: '#fff' }]} />
        </View>

        {/* ── Signatures ─────────────────────────────── */}
        <View style={styles.signatureSection} wrap={false}>
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

        {/* ── Footer ─────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text>Job Card #{jobCard.job_card_id} — Return this card upon completion</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
