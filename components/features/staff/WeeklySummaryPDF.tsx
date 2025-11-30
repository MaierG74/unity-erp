"use client";

import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type WeeklySummaryPDFRow = {
  staff_name: string;
  job_description: string | null;
  dailyHours: Record<string, number>; // key: yyyy-MM-dd -> hours
  totalRegularHours: number;
  totalDoubleTimeHours: number;
  totalOvertimeHours: number;
  totalHours: number;
};

export type WeeklySummaryDay = {
  key: string; // yyyy-MM-dd
  label: string; // EEE dd/MM
};

export function WeeklySummaryPDF(props: {
  title?: string;
  weekStart: string; // e.g. 2025-08-15
  weekEnd: string;   // e.g. 2025-08-21
  days: WeeklySummaryDay[];
  rows: WeeklySummaryPDFRow[];
  includeJob?: boolean;
  generatedAt?: string; // formatted timestamp
}) {
  const {
    title = "Weekly Hours Summary",
    weekStart,
    weekEnd,
    days,
    rows,
    includeJob = true,
    generatedAt,
  } = props;

  const styles = StyleSheet.create({
    page: { padding: 24, fontSize: 10, fontFamily: "Helvetica" },
    header: { marginBottom: 12 },
    h1: { fontSize: 16, fontWeight: 700 },
    meta: { fontSize: 10, color: "#444" },
    table: { marginTop: 8, borderStyle: "solid", borderWidth: 1, borderRightWidth: 0, borderBottomWidth: 0 },
    row: { flexDirection: "row" },
    cell: { padding: 4, borderStyle: "solid", borderWidth: 1, borderLeftWidth: 0, borderTopWidth: 0 },
    th: { backgroundColor: "#f0f0f0", fontWeight: 700 },
    right: { textAlign: "right" },
    center: { textAlign: "center" },
    footer: { marginTop: 12, fontSize: 9, color: "#666" },
    totalsCell: { fontSize: 9, paddingTop: 2, paddingBottom: 2, paddingLeft: 3, paddingRight: 3, fontWeight: 400 },
    shaded: { backgroundColor: "#f7f7f7" },
  });

  const fmt = (n: number | undefined) => {
    if (!n || n === 0) return "-";
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  };

  const totals = React.useMemo(() => {
    const init = { reg: 0, dt: 0, ot: 0, total: 0, perDay: {} as Record<string, number> };
    for (const d of days) init.perDay[d.key] = 0;
    for (const r of rows) {
      init.reg += r.totalRegularHours || 0;
      init.dt += r.totalDoubleTimeHours || 0;
      init.ot += r.totalOvertimeHours || 0;
      init.total += r.totalHours || 0;
      for (const d of days) {
        init.perDay[d.key] += r.dailyHours[d.key] || 0;
      }
    }
    // round
    init.reg = Math.round(init.reg * 100) / 100;
    init.dt = Math.round(init.dt * 100) / 100;
    init.ot = Math.round(init.ot * 100) / 100;
    init.total = Math.round(init.total * 100) / 100;
    for (const d of days) {
      init.perDay[d.key] = Math.round((init.perDay[d.key] || 0) * 100) / 100;
    }
    return init;
  }, [rows, days]);

  // Compute column widths
  // Staff (24%), Job (16% if included), Day columns share remaining, then 4 totals (~32%) split equally.
  const baseLeft = includeJob ? 24 + 16 : 24;
  const totalsWidth = 32; // Regular, D/Time, Overtime, Total (4 * 8%)
  const dayArea = 100 - baseLeft - totalsWidth;
  const dayColWidth = days.length > 0 ? dayArea / days.length : 0;

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.h1}>{title}</Text>
          <Text style={styles.meta}>Period: {weekStart} to {weekEnd}</Text>
          {generatedAt && <Text style={styles.meta}>Generated: {generatedAt}</Text>}
        </View>

        {/* Header Row */}
        <View style={[styles.table, styles.row, styles.th]} wrap={false}>
          <Text style={[styles.cell, { width: `${24}%` }]}>Staff Member</Text>
          {includeJob && <Text style={[styles.cell, { width: `${16}%` }]}>Job</Text>}
          {days.map((d) => (
            <Text key={d.key} style={[styles.cell, { width: `${dayColWidth}%` }, styles.center]}>{d.label}</Text>
          ))}
          <Text style={[styles.cell, { width: `${8}%` }, styles.center]}>Regular</Text>
          <Text style={[styles.cell, { width: `${8}%` }, styles.center]}>D/Time</Text>
          <Text style={[styles.cell, { width: `${8}%` }, styles.center]}>Overtime</Text>
          <Text style={[styles.cell, { width: `${8}%` }, styles.center]}>Total</Text>
        </View>

        {/* Data Rows */}
        {rows.map((r, idx) => (
          <View key={idx} style={[styles.table, styles.row]} wrap={false}>
            <Text style={[styles.cell, { width: `${24}%` }]}>{r.staff_name}</Text>
            {includeJob && <Text style={[styles.cell, { width: `${16}%` }]}>{r.job_description || "N/A"}</Text>}
            {days.map((d) => (
              <Text key={`${idx}-${d.key}`} style={[styles.cell, { width: `${dayColWidth}%` }, styles.right]}>
                {fmt(r.dailyHours[d.key])}
              </Text>
            ))}
            <Text style={[styles.cell, { width: `${8}%` }, styles.right, styles.shaded]}>{fmt(r.totalRegularHours)}</Text>
            <Text style={[styles.cell, { width: `${8}%` }, styles.right]}>{fmt(r.totalDoubleTimeHours)}</Text>
            <Text style={[styles.cell, { width: `${8}%` }, styles.right]}>{fmt(r.totalOvertimeHours)}</Text>
            <Text style={[styles.cell, { width: `${8}%` }, styles.right, styles.shaded]}>{fmt(r.totalHours)}</Text>
          </View>
        ))}

        {/* Totals Row */}
        <View style={[styles.table, styles.row, styles.th]} wrap={false}>
          <Text style={[styles.cell, styles.totalsCell, { width: `${includeJob ? 40 : 24}%` }]}>Daily Totals</Text>
          {days.map((d) => (
            <Text key={`t-${d.key}`} style={[styles.cell, styles.totalsCell, { width: `${dayColWidth}%` }, styles.right]}>
              {fmt(totals.perDay[d.key])}
            </Text>
          ))}
          <Text style={[styles.cell, styles.totalsCell, { width: `${8}%` }, styles.right, styles.shaded]}>{fmt(totals.reg)}</Text>
          <Text style={[styles.cell, styles.totalsCell, { width: `${8}%` }, styles.right]}>{fmt(totals.dt)}</Text>
          <Text style={[styles.cell, styles.totalsCell, { width: `${8}%` }, styles.right]}>{fmt(totals.ot)}</Text>
          <Text style={[styles.cell, styles.totalsCell, { width: `${8}%` }, styles.right, styles.shaded]}>{fmt(totals.total)}</Text>
        </View>

        <View style={styles.footer}>
          <Text>Signature: ________________________   Date: __________</Text>
        </View>
      </Page>
    </Document>
  );
}
