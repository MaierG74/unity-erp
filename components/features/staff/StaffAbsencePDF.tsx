import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { format, parseISO } from 'date-fns';

import { EMPLOYMENT_TYPES } from '@/lib/constants/employment-types';

// Use built-in Helvetica to avoid external font loading issues

export type AbsenceReportRow = {
  staff_id: number;
  name: string;
  employment_type: string | null;
  working_days: number;
  days_present: number;
  days_absent: number;
  absence_rate: number;
  total_hours: number;
  public_holidays_count: number;
  closure_days_count: number;
  worked_holiday_dates: string[];
  incomplete_timecard_dates: string[];
  short_time_off_dates: string[];
  short_time_worked_dates: string[];
  absent_dates: string[];
  bradford_factor: number;
  has_missing_hire_date: boolean;
};

export type StaffAbsencePdfProps = {
  companyName: string;
  periodLabel: string;
  scopeLabel: string;
  generatedAt: string;
  rows: AbsenceReportRow[];
};

const HIGH_BRADFORD_THRESHOLD = 100;

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingRight: 24,
    paddingBottom: 34,
    paddingLeft: 24,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#202020',
    backgroundColor: '#fbfbf8',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  company: {
    fontSize: 8,
    color: '#666666',
    marginBottom: 3,
  },
  h1: {
    fontSize: 18,
    fontWeight: 700,
    color: '#171717',
  },
  metaBlock: {
    width: '34%',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  metaLabel: {
    fontSize: 7,
    color: '#777777',
    width: '36%',
  },
  metaValue: {
    fontSize: 8,
    color: '#2c2c2c',
    textAlign: 'right',
    width: '64%',
  },
  accentRule: {
    height: 1,
    backgroundColor: '#353535',
    marginBottom: 8,
  },
  context: {
    fontSize: 8,
    lineHeight: 1.35,
    color: '#5f5f5f',
    marginBottom: 10,
  },
  table: {
    borderStyle: 'solid',
    borderColor: '#d9d9d2',
    borderTopWidth: 0.5,
    borderLeftWidth: 0.5,
  },
  row: {
    flexDirection: 'row',
  },
  th: {
    backgroundColor: '#eeeeea',
    fontWeight: 700,
  },
  cell: {
    paddingTop: 4,
    paddingRight: 4,
    paddingBottom: 4,
    paddingLeft: 4,
    borderStyle: 'solid',
    borderColor: '#d9d9d2',
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
  },
  employeeCell: {
    paddingTop: 4,
    paddingRight: 5,
    paddingBottom: 4,
    paddingLeft: 5,
  },
  nameText: {
    fontSize: 9,
    color: '#1f1f1f',
    fontWeight: 700,
  },
  subText: {
    fontSize: 7,
    color: '#707070',
    marginTop: 1,
  },
  markerWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  marker: {
    fontSize: 6,
    color: '#464646',
    backgroundColor: '#ecece5',
    paddingTop: 1,
    paddingRight: 3,
    paddingBottom: 1,
    paddingLeft: 3,
    marginRight: 3,
    marginTop: 2,
  },
  right: {
    textAlign: 'right',
  },
  numberCell: {
    fontSize: 8,
  },
  detailRow: {
    borderStyle: 'solid',
    borderColor: '#d9d9d2',
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    paddingTop: 4,
    paddingRight: 5,
    paddingBottom: 4,
    paddingLeft: 5,
    backgroundColor: '#f7f7f2',
  },
  detailLine: {
    fontSize: 7,
    color: '#555555',
    lineHeight: 1.35,
    marginBottom: 1,
  },
  detailGroup: {
    marginBottom: 5,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  detailDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  detailGroupLabel: {
    fontSize: 7,
    fontWeight: 700,
  },
  detailCount: {
    fontSize: 7,
    color: '#999999',
    marginLeft: 4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    fontSize: 7,
    color: '#3f3f3f',
    borderStyle: 'solid',
    borderWidth: 0.5,
    borderColor: '#d2d2cb',
    backgroundColor: '#ffffff',
    borderRadius: 3,
    paddingTop: 1.5,
    paddingBottom: 1.5,
    paddingLeft: 4,
    paddingRight: 4,
    marginRight: 3,
    marginBottom: 3,
  },
  emptyState: {
    paddingTop: 18,
    paddingRight: 8,
    paddingBottom: 18,
    paddingLeft: 8,
    borderStyle: 'solid',
    borderColor: '#d9d9d2',
    borderWidth: 0.5,
    color: '#666666',
    fontSize: 9,
    textAlign: 'center',
  },
  keyBlock: {
    marginTop: 10,
    paddingTop: 6,
    paddingRight: 7,
    paddingBottom: 4,
    paddingLeft: 7,
    borderStyle: 'solid',
    borderColor: '#d9d9d2',
    borderWidth: 0.5,
    backgroundColor: '#ffffff',
  },
  keyTitle: {
    fontSize: 8,
    fontWeight: 700,
    color: '#171717',
    marginBottom: 4,
  },
  keyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  keyItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 8,
    marginBottom: 4,
  },
  keyText: {
    fontSize: 7,
    lineHeight: 1.25,
    color: '#666666',
  },
  keyLabel: {
    fontWeight: 700,
    color: '#2f2f2f',
  },
  footer: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#777777',
    fontSize: 7,
  },
});

const employmentTypeLabel = (value: string | null) => {
  if (!value) return 'Unspecified';
  return EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? value;
};

const whole = (value: number, blank: boolean) => (blank ? '' : String(Math.round(value || 0)));
const rate = (value: number, blank: boolean) => (blank ? '' : `${(value || 0).toFixed(1)}%`);

const rowMarkers = (row: AbsenceReportRow) => {
  const markers: string[] = [];
  if (row.has_missing_hire_date) markers.push('needs hire date');
  if (!row.has_missing_hire_date && row.bradford_factor >= HIGH_BRADFORD_THRESHOLD) markers.push('pattern');
  if (row.worked_holiday_dates.length > 0) markers.push('worked holiday');
  return markers;
};

const hasDetail = (row: AbsenceReportRow) =>
  row.absent_dates.length > 0 ||
  row.worked_holiday_dates.length > 0 ||
  row.incomplete_timecard_dates.length > 0 ||
  row.short_time_off_dates.length > 0 ||
  row.short_time_worked_dates.length > 0;

const PDF_DETAIL_TONES: Record<string, { dot: string; label: string }> = {
  absent: { dot: '#e11d48', label: '#9f1239' },
  holiday: { dot: '#0284c7', label: '#075985' },
  exception: { dot: '#d97706', label: '#92400e' },
  short_time: { dot: '#7c3aed', label: '#5b21b6' },
};

const PDF_KEY_ITEMS: Array<{ tone: keyof typeof PDF_DETAIL_TONES; label: string; description: string }> = [
  {
    tone: 'absent',
    label: 'Unclassified non-attendance',
    description:
      'a working day with no completed timecard. Not yet split into approved leave vs an unexplained no-show; reconcile before any payroll or disciplinary action.',
  },
  {
    tone: 'exception',
    label: 'Timecard exception',
    description:
      "an incomplete clock record (e.g. clocked in, never clocked out). A data issue, not an absence — excluded from the count until it's fixed.",
  },
  {
    tone: 'holiday',
    label: 'Worked a public holiday',
    description: 'clocked in on a public holiday. Not an absence — flagged so payroll can apply double-time.',
  },
  {
    tone: 'short_time',
    label: 'Short time',
    description:
      'an employer-sanctioned reduced-work day. Not an unexplained absence; an off day is classified short time, a worked day still counts present.',
  },
];

const formatPdfDay = (iso: string) => {
  try {
    return format(parseISO(iso), 'EEE d MMM');
  } catch {
    return iso;
  }
};

const PdfDateGroup: React.FC<{ tone: keyof typeof PDF_DETAIL_TONES; label: string; dates: string[] }> = ({
  tone,
  label,
  dates,
}) => {
  if (dates.length === 0) return null;
  const t = PDF_DETAIL_TONES[tone];
  return (
    <View style={styles.detailGroup}>
      <View style={styles.detailHeader}>
        <View style={[styles.detailDot, { backgroundColor: t.dot }]} />
        <Text style={[styles.detailGroupLabel, { color: t.label }]}>{label}</Text>
        <Text style={styles.detailCount}>· {dates.length}</Text>
      </View>
      <View style={styles.chipWrap}>
        {dates.map((d) => (
          <Text key={d} style={styles.chip}>
            {formatPdfDay(d)}
          </Text>
        ))}
      </View>
    </View>
  );
};

export const StaffAbsencePDF: React.FC<StaffAbsencePdfProps> = ({
  companyName,
  periodLabel,
  scopeLabel,
  generatedAt,
  rows,
}) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.company}>{companyName}</Text>
          <Text style={styles.h1}>Absence report</Text>
        </View>
        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Period</Text>
            <Text style={styles.metaValue}>{periodLabel}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Scope</Text>
            <Text style={styles.metaValue}>{scopeLabel}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Generated</Text>
            <Text style={styles.metaValue}>{generatedAt}</Text>
          </View>
        </View>
      </View>

      <View style={styles.accentRule} />

      <Text style={styles.context}>
        Counts working days only - excludes weekends, South African public holidays, and company closures.
        'Unclassified non-attendance' is a working day with no completed timecard; it does not yet distinguish
        approved leave from an unplanned absence - reconcile before any payroll or disciplinary action.
        Company policy: 15 leave days/year.
      </Text>

      {rows.length === 0 ? (
        <Text style={styles.emptyState}>No staff absence rows for this period.</Text>
      ) : (
        <View style={styles.table}>
          <View style={[styles.row, styles.th]} wrap={false}>
            <Text style={[styles.cell, styles.employeeCell, { width: '31%' }]}>Employee</Text>
            <Text style={[styles.cell, styles.right, { width: '10%' }]}>Working</Text>
            <Text style={[styles.cell, styles.right, { width: '10%' }]}>Present</Text>
            <Text style={[styles.cell, styles.right, { width: '15%' }]}>Unclassified absence</Text>
            <Text style={[styles.cell, styles.right, { width: '9%' }]}>Rate</Text>
            <Text style={[styles.cell, styles.right, { width: '11%' }]}>Pub. hol.</Text>
            <Text style={[styles.cell, styles.right, { width: '14%' }]}>Bradford</Text>
          </View>

          {rows.map((row) => {
            const blankCounts = row.has_missing_hire_date;
            const markers = rowMarkers(row);

            return (
              <React.Fragment key={row.staff_id}>
                <View style={styles.row} wrap={false}>
                  <View style={[styles.cell, styles.employeeCell, { width: '31%' }]}>
                    <Text style={styles.nameText}>{row.name}</Text>
                    <Text style={styles.subText}>{employmentTypeLabel(row.employment_type)}</Text>
                    {markers.length > 0 ? (
                      <View style={styles.markerWrap}>
                        {markers.map((marker) => (
                          <Text key={marker} style={styles.marker}>
                            {marker}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.cell, styles.numberCell, styles.right, { width: '10%' }]}>
                    {whole(row.working_days, blankCounts)}
                  </Text>
                  <Text style={[styles.cell, styles.numberCell, styles.right, { width: '10%' }]}>
                    {whole(row.days_present, blankCounts)}
                  </Text>
                  <Text style={[styles.cell, styles.numberCell, styles.right, { width: '15%' }]}>
                    {whole(row.days_absent, blankCounts)}
                  </Text>
                  <Text style={[styles.cell, styles.numberCell, styles.right, { width: '9%' }]}>
                    {rate(row.absence_rate, blankCounts)}
                  </Text>
                  <Text style={[styles.cell, styles.numberCell, styles.right, { width: '11%' }]}>
                    {whole(row.public_holidays_count, blankCounts)}
                  </Text>
                  <Text style={[styles.cell, styles.numberCell, styles.right, { width: '14%' }]}>
                    {whole(row.bradford_factor, blankCounts)}
                  </Text>
                </View>

                {hasDetail(row) ? (
                  <View style={styles.row}>
                    <View style={[styles.detailRow, { width: '100%' }]}>
                      <PdfDateGroup tone="absent" label="Unclassified non-attendance" dates={row.absent_dates} />
                      <PdfDateGroup tone="holiday" label="Worked a public holiday — review for double-time" dates={row.worked_holiday_dates} />
                      <PdfDateGroup tone="exception" label="Timecard exception — excluded" dates={row.incomplete_timecard_dates} />
                      <PdfDateGroup tone="short_time" label="Short time" dates={row.short_time_off_dates} />
                      {row.short_time_worked_dates.length > 0 ? (
                        <Text style={styles.detailLine}>
                          Worked reduced hours (short time): {row.short_time_worked_dates.map(formatPdfDay).join(', ')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </React.Fragment>
            );
          })}
        </View>
      )}

      <View style={styles.keyBlock} wrap={false}>
        <Text style={styles.keyTitle}>Key</Text>
        <View style={styles.keyGrid}>
          {PDF_KEY_ITEMS.map((item) => (
            <View key={item.label} style={styles.keyItem}>
              <View style={[styles.detailDot, { backgroundColor: PDF_DETAIL_TONES[item.tone].dot, marginTop: 3 }]} />
              <Text style={styles.keyText}>
                <Text style={styles.keyLabel}>{item.label}</Text> — {item.description}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footer} fixed>
        <Text>{companyName} - Absence report</Text>
        <Text>Working days = Mon-Fri - public holidays - closures</Text>
      </View>
    </Page>
  </Document>
);

export default StaffAbsencePDF;
