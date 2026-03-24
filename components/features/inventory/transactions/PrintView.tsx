'use client';

import { forwardRef, useMemo } from 'react';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import type { EnrichedTransaction, ViewConfig, ComponentStockSummary } from '@/types/transaction-views';

type GroupSummary = {
  key: string;
  label: string;
  sublabel?: string;
  sumIn: number;
  sumOut: number;
  count: number;
  stockSummary?: ComponentStockSummary;
  transactions: EnrichedTransaction[];
};

type Props = {
  transactions: EnrichedTransaction[];
  groupBy: string;
  config: ViewConfig;
  dateRange: { from: Date; to: Date };
  summary: { total: number; totalIn: number; totalOut: number };
  stockSummaryMap?: Map<number, ComponentStockSummary>;
};

function buildGroups(
  transactions: EnrichedTransaction[],
  groupBy: string,
  stockSummaryMap?: Map<number, ComponentStockSummary>
): GroupSummary[] {
  if (groupBy === 'none') return [];

  const groupMap = new Map<string, GroupSummary>();

  transactions.forEach((t) => {
    let key: string;
    let label: string;
    let sublabel: string | undefined;

    switch (groupBy) {
      case 'component':
        key = String(t.component_id);
        label = t.component?.internal_code || 'Unknown';
        sublabel = t.component?.description || undefined;
        break;
      case 'supplier': {
        const supplier = t.purchase_order?.supplier;
        key = supplier ? String(supplier.supplier_id) : 'none';
        label = supplier?.name || 'No Supplier';
        break;
      }
      case 'period_week': {
        const weekStart = startOfWeek(new Date(t.transaction_date), { weekStartsOn: 1 });
        key = format(weekStart, 'yyyy-MM-dd');
        label = `Week of ${format(weekStart, 'MMM dd, yyyy')}`;
        break;
      }
      case 'period_month': {
        const monthStart = startOfMonth(new Date(t.transaction_date));
        key = format(monthStart, 'yyyy-MM');
        label = format(monthStart, 'MMMM yyyy');
        break;
      }
      default:
        key = 'all';
        label = 'All';
    }

    const existing = groupMap.get(key);
    const qty = t.quantity || 0;

    if (existing) {
      existing.count++;
      if (qty > 0) existing.sumIn += qty;
      else existing.sumOut += Math.abs(qty);
      existing.transactions.push(t);
    } else {
      groupMap.set(key, {
        key,
        label,
        sublabel,
        sumIn: qty > 0 ? qty : 0,
        sumOut: qty < 0 ? Math.abs(qty) : 0,
        count: 1,
        stockSummary:
          groupBy === 'component' && stockSummaryMap
            ? stockSummaryMap.get(t.component_id)
            : undefined,
        transactions: [t],
      });
    }
  });

  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function getActiveFiltersDescription(config: ViewConfig): string {
  const parts: string[] = [];
  if (config.dateRange.preset) {
    const presetLabels: Record<string, string> = {
      thisWeek: 'This Week',
      thisMonth: 'This Month',
      last30: 'Last 30 Days',
      thisQuarter: 'This Quarter',
      ytd: 'Year to Date',
    };
    parts.push(presetLabels[config.dateRange.preset] || config.dateRange.preset);
  }
  if (config.filters.productId !== 'all') parts.push(`Product filter active`);
  if (config.filters.transactionTypeId !== 'all') parts.push(`Type filter active`);
  if (config.filters.supplierId !== 'all') parts.push(`Supplier filter active`);
  if (config.filters.categoryId !== 'all') parts.push(`Category filter active`);
  if (config.groupBy !== 'none') {
    const groupLabels: Record<string, string> = {
      component: 'Grouped by Component',
      supplier: 'Grouped by Supplier',
      period_week: 'Grouped by Week',
      period_month: 'Grouped by Month',
    };
    parts.push(groupLabels[config.groupBy] || config.groupBy);
  }
  return parts.join(' | ') || 'All transactions';
}

export const PrintView = forwardRef<HTMLDivElement, Props>(
  ({ transactions, groupBy, config, dateRange, summary, stockSummaryMap }, ref) => {
    const groups = useMemo(
      () => buildGroups(transactions, groupBy, stockSummaryMap),
      [transactions, groupBy, stockSummaryMap]
    );

    return (
      <div
        ref={ref}
        className="hidden print:block"
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '11px',
          color: '#000',
          background: '#fff',
          padding: '20px',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '16px', borderBottom: '2px solid #333', paddingBottom: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>
            Inventory Transactions Report
          </h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: '10px' }}>
            {format(dateRange.from, 'MMM dd, yyyy')} — {format(dateRange.to, 'MMM dd, yyyy')}
            {' | '}
            {getActiveFiltersDescription(config)}
            {' | '}
            Printed: {format(new Date(), 'MMM dd, yyyy HH:mm')}
          </p>
        </div>

        {/* Summary */}
        <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', fontSize: '12px' }}>
          <span>
            <strong>Total:</strong> {summary.total} transactions
          </span>
          <span style={{ color: '#16a34a' }}>
            <strong>In:</strong> +{summary.totalIn.toLocaleString()}
          </span>
          <span style={{ color: '#dc2626' }}>
            <strong>Out:</strong> -{summary.totalOut.toLocaleString()}
          </span>
        </div>

        {/* Grouped content */}
        {groupBy !== 'none' && groups.length > 0 ? (
          groups.map((group) => (
            <div key={group.key} style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <div
                style={{
                  background: '#f3f4f6',
                  padding: '6px 10px',
                  fontWeight: 'bold',
                  fontSize: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid #d1d5db',
                }}
              >
                <span>
                  {group.label}
                  {group.sublabel && (
                    <span style={{ fontWeight: 'normal', color: '#666' }}>
                      {' '}— {group.sublabel}
                    </span>
                  )}
                  <span style={{ fontWeight: 'normal', color: '#888', marginLeft: '8px' }}>
                    ({group.count})
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '16px' }}>
                  <span style={{ color: '#16a34a' }}>In: +{group.sumIn.toLocaleString()}</span>
                  <span style={{ color: '#dc2626' }}>Out: -{group.sumOut.toLocaleString()}</span>
                  {group.stockSummary && (
                    <>
                      <span>Stock: {group.stockSummary.quantityOnHand.toLocaleString()}</span>
                      <span style={{ color: '#3b82f6' }}>On Order: {group.stockSummary.onOrder.toLocaleString()}</span>
                      <span style={{ color: '#d97706' }}>Reserved: {group.stockSummary.reserved.toLocaleString()}</span>
                    </>
                  )}
                </span>
              </div>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '10px',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Date</th>
                    {groupBy !== 'component' && (
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Component</th>
                    )}
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Type</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px' }}>Qty</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Order Ref</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {group.transactions.map((t) => {
                    const qty = t.quantity || 0;
                    return (
                      <tr
                        key={t.transaction_id}
                        style={{ borderBottom: '1px solid #f3f4f6' }}
                      >
                        <td style={{ padding: '3px 6px' }}>
                          {format(new Date(t.transaction_date), 'MMM dd HH:mm')}
                        </td>
                        {groupBy !== 'component' && (
                          <td style={{ padding: '3px 6px' }}>
                            {t.component?.internal_code || '-'}
                          </td>
                        )}
                        <td style={{ padding: '3px 6px' }}>
                          {t.transaction_type?.type_name || '-'}
                        </td>
                        <td
                          style={{
                            padding: '3px 6px',
                            textAlign: 'right',
                            color: qty > 0 ? '#16a34a' : '#dc2626',
                            fontWeight: 600,
                          }}
                        >
                          {qty > 0 ? '+' : ''}
                          {qty}
                        </td>
                        <td style={{ padding: '3px 6px' }}>
                          {t.order?.order_number ||
                            t.purchase_order?.q_number ||
                            '-'}
                        </td>
                        <td style={{ padding: '3px 6px' }}>{t.reason || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        ) : (
          /* Flat table */
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #d1d5db' }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Component</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Qty</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Order Ref</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const qty = t.quantity || 0;
                return (
                  <tr
                    key={t.transaction_id}
                    style={{ borderBottom: '1px solid #f3f4f6' }}
                  >
                    <td style={{ padding: '3px 6px' }}>
                      {format(new Date(t.transaction_date), 'MMM dd HH:mm')}
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      {t.component?.internal_code || '-'}
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      {t.component?.description || '-'}
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      {t.transaction_type?.type_name || '-'}
                    </td>
                    <td
                      style={{
                        padding: '3px 6px',
                        textAlign: 'right',
                        color: qty > 0 ? '#16a34a' : '#dc2626',
                        fontWeight: 600,
                      }}
                    >
                      {qty > 0 ? '+' : ''}
                      {qty}
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      {t.order?.order_number ||
                        t.purchase_order?.q_number ||
                        '-'}
                    </td>
                    <td style={{ padding: '3px 6px' }}>{t.reason || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  }
);

PrintView.displayName = 'PrintView';
