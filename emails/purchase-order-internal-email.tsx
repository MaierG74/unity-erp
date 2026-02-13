import React from 'react';
import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';
import type { PurchaseOrderEmailProps, SupplierOrderItem } from '@/emails/purchase-order-email';

export interface InternalSupplierOrderItem extends SupplierOrderItem {
  forOrder?: string;
}

export interface PurchaseOrderInternalEmailProps
  extends Omit<PurchaseOrderEmailProps, 'supplierOrders'> {
  supplierOrders: InternalSupplierOrderItem[];
}

const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

export default function PurchaseOrderInternalEmail({
  qNumber,
  supplierName,
  createdAt,
  supplierOrders,
  notes,
  companyName = 'Unity',
  companyLogoUrl,
  companyAddress = '123 Unity Street, London, UK',
  companyPhone = '+44 123 456 7890',
  companyEmail = 'purchasing@example.com',
  supplierEmail,
  importantNotice,
  contactName = 'Mignon',
  contactEmail = 'orders@qbutton.co.za',
}: PurchaseOrderInternalEmailProps) {
  const formattedDate = new Date(createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const totals = supplierOrders.reduce(
    (acc, item) => {
      acc.quantity += item.order_quantity;
      acc.value += item.order_quantity * item.supplier_component.price;
      return acc;
    },
    { quantity: 0, value: 0 }
  );

  const VAT_RATE = 0.15;
  const subtotal = totals.value;
  const vatAmount = subtotal * VAT_RATE;
  const totalInclVAT = subtotal + vatAmount;

  return (
    <Html>
      <Head />
      <Preview>Internal Copy: Purchase Order {qNumber} for {supplierName}</Preview>
      <Tailwind>
        <Body
          style={{
            backgroundColor: '#f3f4f6',
            fontFamily: 'Arial, sans-serif',
            fontSize: '13px',
            color: '#1f2937',
          }}
        >
          <Container style={{ maxWidth: '768px', margin: '0 auto', padding: '24px' }}>
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                border: '1px solid #e5e7eb',
                padding: '28px',
              }}
            >
              <Section>
                <Row>
                  <Column style={{ width: '50%', verticalAlign: 'top' }}>
                    {companyLogoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={companyLogoUrl}
                        alt={companyName}
                        style={{ height: '36px', width: 'auto', marginBottom: '8px' }}
                      />
                    ) : null}
                    <Text style={{ fontSize: '12px', color: '#4b5563', lineHeight: '1.4', margin: 0 }}>
                      {companyName}
                      <br />
                      {companyAddress}
                      <br />
                      Phone: {companyPhone}
                      <br />
                      Email: {companyEmail}
                    </Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right', verticalAlign: 'top' }}>
                    <Text
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        margin: '0 0 4px 0',
                      }}
                    >
                      Internal Purchase Order Copy
                    </Text>
                    <Text style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: '0 0 4px 0' }}>
                      PO {qNumber}
                    </Text>
                    <Text style={{ fontSize: '13px', color: '#4b5563', margin: 0 }}>Date: {formattedDate}</Text>
                  </Column>
                </Row>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />

              <Section>
                <div
                  style={{
                    backgroundColor: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    padding: '12px',
                  }}
                >
                  <Text style={{ fontSize: '11px', fontWeight: 700, color: '#374151', margin: '0 0 4px 0' }}>
                    Supplier
                  </Text>
                  <Text style={{ fontSize: '13px', color: '#1f2937', margin: 0 }}>
                    {supplierName}
                    {supplierEmail ? (
                      <>
                        <br />
                        Email: {supplierEmail}
                      </>
                    ) : null}
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />

              <Section>
                <Text
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#374151',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    margin: '0 0 10px 0',
                  }}
                >
                  Order Items
                </Text>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '12px',
                    color: '#374151',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ width: '10%', padding: '6px 6px', textAlign: 'left', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Supplier Code</th>
                      <th style={{ width: '10%', padding: '6px 6px', textAlign: 'left', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Internal Code</th>
                      <th style={{ width: '31%', padding: '6px 6px', textAlign: 'left', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Description</th>
                      <th style={{ width: '14%', padding: '6px 6px', textAlign: 'left', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>For Order</th>
                      <th style={{ width: '8%', padding: '6px 6px', textAlign: 'right', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Qty</th>
                      <th style={{ width: '13%', padding: '6px 6px', textAlign: 'right', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Unit Price</th>
                      <th style={{ width: '14%', padding: '6px 6px', textAlign: 'right', fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierOrders.map((item, index) => {
                      const lineTotal = item.order_quantity * item.supplier_component.price;
                      const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
                      return (
                        <React.Fragment key={item.order_id}>
                          <tr style={{ backgroundColor: bgColor }}>
                            <td style={{ padding: '8px 6px', fontSize: '11px', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6' }}>{item.supplier_component.supplier_code}</td>
                            <td style={{ padding: '8px 6px', fontSize: '11px', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6' }}>{item.supplier_component.component.internal_code}</td>
                            <td style={{ padding: '8px 6px', fontSize: '11px', lineHeight: '1.35', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6' }}>{item.supplier_component.component.description}</td>
                            <td style={{ padding: '8px 6px', fontSize: '11px', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6' }}>{item.forOrder || '—'}</td>
                            <td style={{ padding: '8px 6px', fontSize: '11px', textAlign: 'right', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6' }}>{item.order_quantity}</td>
                            <td style={{ padding: '8px 6px', fontSize: '11px', textAlign: 'right', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{formatCurrency(item.supplier_component.price)}</td>
                            <td style={{ padding: '8px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 600, borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{formatCurrency(lineTotal)}</td>
                          </tr>
                          {item.notes && (
                            <tr style={{ backgroundColor: bgColor }}>
                              <td colSpan={7} style={{ padding: '0 6px 8px 6px', fontSize: '10px', fontStyle: 'italic', color: '#6b7280', borderBottom: '1px solid #f3f4f6' }}>
                                Note: {item.notes}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    <tr style={{ backgroundColor: '#ffffff' }}>
                      <td colSpan={6} style={{ padding: '10px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 600, color: '#374151', borderTop: '2px solid #e5e7eb' }}>Subtotal (excl. VAT)</td>
                      <td style={{ padding: '10px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 600, color: '#374151', borderTop: '2px solid #e5e7eb', whiteSpace: 'nowrap' }}>{formatCurrency(subtotal)}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <td colSpan={6} style={{ padding: '10px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 600, color: '#374151' }}>VAT @ 15%</td>
                      <td style={{ padding: '10px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{formatCurrency(vatAmount)}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#f0fdf4' }}>
                      <td colSpan={6} style={{ padding: '12px 6px', fontSize: '12px', textAlign: 'right', fontWeight: 700, color: '#047857', borderTop: '2px solid #10b981' }}>Total (incl. VAT)</td>
                      <td style={{ padding: '12px 6px', fontSize: '12px', textAlign: 'right', fontWeight: 700, color: '#047857', borderTop: '2px solid #10b981', whiteSpace: 'nowrap' }}>{formatCurrency(totalInclVAT)}</td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              {notes && (
                <>
                  <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />
                  <Section>
                    <div
                      style={{
                        backgroundColor: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        padding: '12px',
                      }}
                    >
                      <Text style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', margin: '0 0 4px 0' }}>
                        Order Notes
                      </Text>
                      <Text style={{ fontSize: '11px', color: '#374151', lineHeight: '1.45', margin: 0, whiteSpace: 'pre-wrap' }}>
                        {notes}
                      </Text>
                    </div>
                  </Section>
                </>
              )}

              <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />

              <Section>
                <div
                  style={{
                    backgroundColor: '#fef3c7',
                    border: '1px solid #fbbf24',
                    borderRadius: '8px',
                    padding: '12px',
                  }}
                >
                  <Text style={{ fontSize: '11px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', margin: '0 0 4px 0' }}>
                    Important Notice
                  </Text>
                  <Text style={{ fontSize: '11px', color: '#78350f', lineHeight: '1.45', margin: 0 }}>
                    {importantNotice ? (
                      importantNotice.split(contactEmail).map((part, index, array) =>
                        index < array.length - 1 ? (
                          <span key={index}>
                            {part}
                            <Link
                              href={`mailto:${contactEmail}`}
                              style={{ color: '#92400e', fontWeight: 700, textDecoration: 'none' }}
                            >
                              {contactEmail}
                            </Link>
                          </span>
                        ) : (
                          part
                        )
                      )
                    ) : (
                      <>
                        Please verify all quantities, pricing, and specifications before processing this
                        order. If you notice any discrepancies or have questions, contact {contactName} at{' '}
                        <Link
                          href={`mailto:${contactEmail}`}
                          style={{ color: '#92400e', fontWeight: 700, textDecoration: 'none' }}
                        >
                          {contactEmail}
                        </Link>{' '}
                        before proceeding.
                      </>
                    )}
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />

              <Section style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: '10px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
                  <strong>{companyName}</strong>
                  <br />
                  {companyAddress}
                  <br />
                  Phone: {companyPhone} | Email: {companyEmail}
                  <br />
                  <br />
                  This is an internal purchase order copy from Unity ERP.
                </Text>
              </Section>
            </div>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
