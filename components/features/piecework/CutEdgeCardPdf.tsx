import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { format } from 'date-fns';

export type CutEdgeCardType = 'cut' | 'edge';

export interface CutEdgeCardPdfData {
  id: string;
  cardType: CutEdgeCardType;
  orgName: string;
  orgLogo?: string | null;
  orderNumber: string | null;
  customerName: string | null;
  dueDate: string | null;
  materialColorLabel: string | null;
  expectedCount: number | null;
  assignedStaffName: string | null;
  assignedStaffRole: string | null;
  cuttingPlanRef: string | null;
  issuedAt: string | null;
}

export interface CutEdgeCardPdfProps {
  card: CutEdgeCardPdfData;
}

const ACCENT = '#1a1a1a';
const BORDER = '#d9d9d9';
const LIGHT_BG = '#f7f7f7';
const MUTED = '#666666';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    padding: 28,
    fontFamily: 'Helvetica',
    fontSize: 9,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    borderBottomStyle: 'solid',
    paddingBottom: 12,
    marginBottom: 14,
  },
  orgBlock: {
    flexDirection: 'row',
    gap: 10,
    maxWidth: '58%',
  },
  logo: {
    width: 74,
    height: 38,
    objectFit: 'contain',
  },
  orgName: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  mutedLine: {
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.3,
  },
  titleBlock: {
    alignItems: 'flex-end',
  },
  typeLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cardId: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  issuedDate: {
    fontSize: 8,
    color: MUTED,
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  infoCard: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: BORDER,
    borderStyle: 'solid',
    backgroundColor: LIGHT_BG,
    borderRadius: 3,
    padding: 8,
    minHeight: 48,
  },
  label: {
    fontSize: 6,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  value: {
    fontSize: 11,
    fontWeight: 'bold',
    lineHeight: 1.25,
  },
  subValue: {
    fontSize: 8,
    color: MUTED,
    marginTop: 2,
    lineHeight: 1.3,
  },
  expectedPanel: {
    borderWidth: 2,
    borderColor: ACCENT,
    borderStyle: 'solid',
    borderRadius: 3,
    padding: 12,
    marginVertical: 12,
    alignItems: 'center',
  },
  expectedLabel: {
    fontSize: 9,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  expectedCount: {
    fontSize: 54,
    fontWeight: 'bold',
    lineHeight: 1,
  },
  notesPanel: {
    flexGrow: 1,
    minHeight: 270,
    borderWidth: 1,
    borderColor: ACCENT,
    borderStyle: 'solid',
    borderRadius: 3,
    marginTop: 10,
    padding: 10,
  },
  notesTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  writingLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    borderBottomStyle: 'solid',
    height: 29,
  },
  footer: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: MUTED,
    fontSize: 7,
  },
});

function formatMaybeDate(value: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd MMM yyyy');
}

function display(value: string | number | null | undefined, fallback = 'Not set'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

/**
 * One-page shop-floor handout for cut/edge piecework cards.
 * The layout keeps `expectedCount` deliberately oversized and reserves the
 * bottom third-plus of A4 portrait for handwritten notes and variances.
 */
export function CutEdgeCardPdf({ card }: CutEdgeCardPdfProps) {
  const typeLabel = card.cardType === 'edge' ? 'EDGE' : 'CUT';

  return (
    <Document title={`${typeLabel} card ${card.id}`}>
      <Page size="A4" orientation="portrait" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.orgBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not render browser alt text */}
            {card.orgLogo ? <Image src={card.orgLogo} style={styles.logo} /> : null}
            <View>
              <Text style={styles.orgName}>{display(card.orgName, 'Organization')}</Text>
              <Text style={styles.mutedLine}>Order: {display(card.orderNumber)}</Text>
              <Text style={styles.mutedLine}>Customer: {display(card.customerName)}</Text>
            </View>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.typeLabel}>{typeLabel}</Text>
            <Text style={styles.cardId}>Card {card.id}</Text>
            <Text style={styles.issuedDate}>Issued {formatMaybeDate(card.issuedAt)}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.infoCard}>
            <Text style={styles.label}>Due Date</Text>
            <Text style={styles.value}>{formatMaybeDate(card.dueDate)}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.label}>Material / Color</Text>
            <Text style={styles.value}>{display(card.materialColorLabel)}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.infoCard}>
            <Text style={styles.label}>Assigned Staff</Text>
            <Text style={styles.value}>{display(card.assignedStaffName, 'Unassigned')}</Text>
            <Text style={styles.subValue}>{display(card.assignedStaffRole, 'Role not set')}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.label}>Cutting Plan Reference</Text>
            <Text style={styles.value}>{display(card.cuttingPlanRef)}</Text>
            <Text style={styles.subValue}>Card type: {typeLabel}</Text>
          </View>
        </View>

        <View style={styles.expectedPanel}>
          <Text style={styles.expectedLabel}>Expected Count</Text>
          <Text style={styles.expectedCount}>{display(card.expectedCount, '-')}</Text>
        </View>

        <View style={styles.notesPanel}>
          <Text style={styles.notesTitle}>Notes / Variances</Text>
          {Array.from({ length: 8 }).map((_, index) => (
            <View key={index} style={styles.writingLine} />
          ))}
        </View>

        <View style={styles.footer}>
          <Text>Supervisor read-back required before completion.</Text>
          <Text>{typeLabel} card {card.id}</Text>
        </View>
      </Page>
    </Document>
  );
}

export default CutEdgeCardPdf;
