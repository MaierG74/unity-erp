import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// Use built-in Helvetica to avoid external font loading issues

export type PayrollRow = {
  staff_id: number;
  name: string;
  hourly_rate: number;
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  total_hours: number;
  regular_earnings: number;
  overtime_earnings: number;
  doubletime_earnings: number;
  total_earnings: number;
};

export type PayrollPdfProps = {
  title?: string;
  company?: string;
  periodText: string;
  data: PayrollRow[];
  generatedAt?: string; // formatted date-time
};

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, fontFamily: 'Helvetica' },
  header: { marginBottom: 12 },
  h1: { fontSize: 16, fontWeight: 700 },
  meta: { fontSize: 10, color: '#444' },
  table: { marginTop: 8, borderStyle: 'solid', borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0 },
  row: { flexDirection: 'row' },
  cell: { padding: 4, borderStyle: 'solid', borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0 },
  th: { backgroundColor: '#f0f0f0', fontWeight: 700 },
  right: { textAlign: 'right' },
  footer: { marginTop: 12, fontSize: 9, color: '#666' },
});

const currency = (n: number) => `R${n.toFixed(2)}`;
const hours = (n: number) => n.toFixed(1);

export const StaffPayrollPDF: React.FC<PayrollPdfProps> = ({
  title = 'Payroll Hours Report',
  company = 'Unity ERP',
  periodText,
  data,
  generatedAt,
}) => {
  const totals = data.reduce(
    (acc, r) => {
      acc.regular += r.regular_hours;
      acc.ot += r.overtime_hours;
      acc.dt += r.doubletime_hours;
      acc.total += r.total_hours;
      acc.pay += r.total_earnings;
      return acc;
    },
    { regular: 0, ot: 0, dt: 0, total: 0, pay: 0 }
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.h1}>{company}</Text>
          <Text style={styles.meta}>{title}</Text>
          <Text style={styles.meta}>Period: {periodText}</Text>
          {generatedAt ? <Text style={styles.meta}>Generated: {generatedAt}</Text> : null}
        </View>

        {/* Table Header */}
        <View style={[styles.table, styles.row, styles.th]}>
          <Text style={[styles.cell, { width: '28%' }]}>Name</Text>
          <Text style={[styles.cell, { width: '9%', textAlign: 'right' }]}>Rate</Text>
          <Text style={[styles.cell, { width: '12%', textAlign: 'right' }]}>Regular</Text>
          <Text style={[styles.cell, { width: '12%', textAlign: 'right' }]}>Overtime</Text>
          <Text style={[styles.cell, { width: '12%', textAlign: 'right' }]}>Double time</Text>
          <Text style={[styles.cell, { width: '12%', textAlign: 'right' }]}>Total Hrs</Text>
          <Text style={[styles.cell, { width: '15%', textAlign: 'right' }]}>Total Pay</Text>
        </View>

        {/* Rows */}
        {data.map((r) => (
          <View key={r.staff_id} style={[styles.table, styles.row]}>
            <Text style={[styles.cell, { width: '28%' }]}>{r.name}</Text>
            <Text style={[styles.cell, { width: '9%' }, styles.right]}>{currency(r.hourly_rate)}</Text>
            <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(r.regular_hours)}</Text>
            <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(r.overtime_hours)}</Text>
            <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(r.doubletime_hours)}</Text>
            <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(r.total_hours)}</Text>
            <Text style={[styles.cell, { width: '15%' }, styles.right]}>{currency(r.total_earnings)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={[styles.table, styles.row, styles.th]}> 
          <Text style={[styles.cell, { width: '28%' }]}>Totals</Text>
          <Text style={[styles.cell, { width: '9%' }]}></Text>
          <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(totals.regular)}</Text>
          <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(totals.ot)}</Text>
          <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(totals.dt)}</Text>
          <Text style={[styles.cell, { width: '12%' }, styles.right]}>{hours(totals.total)}</Text>
          <Text style={[styles.cell, { width: '15%' }, styles.right]}>{currency(totals.pay)}</Text>
        </View>

        <View style={styles.footer}>
          <Text>Signature: _____________________________   Date: ____________</Text>
        </View>
      </Page>
    </Document>
  );
};

export default StaffPayrollPDF;
