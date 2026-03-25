'use client';

import { forwardRef } from 'react';
import { format } from 'date-fns';

export type CountSheetComponent = {
  componentId: number;
  code: string;
  description: string;
  category: string;
  currentStock: number;
  onOrder: number;
};

type Props = {
  components: CountSheetComponent[];
  onOrderComponents?: CountSheetComponent[];
  filterDescription: string;
};

export const CountSheetPrintView = forwardRef<HTMLDivElement, Props>(
  ({ components, onOrderComponents, filterDescription }, ref) => {
    return (
      <div
        ref={ref}
        className="hidden print:block"
        style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px', color: '#000', background: '#fff', padding: '20px' }}
      >
        {/* Header */}
        <div style={{ marginBottom: '16px', borderBottom: '2px solid #333', paddingBottom: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Stock Count Sheet</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: '10px' }}>
            {filterDescription}
            {' | '}
            Printed: {format(new Date(), 'MMM dd, yyyy HH:mm')}
          </p>
        </div>

        {/* Main count table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 'bold' }}>Code</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 'bold' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 'bold' }}>Category</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 'bold', width: '80px' }}>System Stock</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 'bold', width: '100px', borderBottom: '2px solid #333' }}>Counted</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 'bold', width: '80px' }}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.componentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '5px 8px', fontWeight: 600 }}>{c.code}</td>
                <td style={{ padding: '5px 8px' }}>{c.description}</td>
                <td style={{ padding: '5px 8px', color: '#666' }}>{c.category}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600 }}>{c.currentStock}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', borderLeft: '1px solid #d1d5db', borderRight: '1px solid #d1d5db' }}></td>
                <td style={{ padding: '5px 8px', textAlign: 'center' }}></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* On-Order Section */}
        {onOrderComponents && onOrderComponents.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #999', paddingBottom: '4px' }}>
              On Order — Not Yet Received
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Description</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Category</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', width: '80px' }}>On Order</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', width: '100px' }}>Counted</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', width: '80px' }}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {onOrderComponents.map((c) => (
                  <tr key={c.componentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{c.code}</td>
                    <td style={{ padding: '5px 8px' }}>{c.description}</td>
                    <td style={{ padding: '5px 8px', color: '#666' }}>{c.category}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#3b82f6', fontWeight: 600 }}>{c.onOrder}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', borderLeft: '1px solid #d1d5db', borderRight: '1px solid #d1d5db' }}></td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '40px', borderTop: '1px solid #999', paddingTop: '12px', display: 'flex', gap: '40px', fontSize: '11px' }}>
          <span>Counted by: _______________________________</span>
          <span>Date: _______________</span>
          <span>Signature: _______________________________</span>
        </div>
      </div>
    );
  }
);

CountSheetPrintView.displayName = 'CountSheetPrintView';
