import React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Tailwind,
  Row,
  Column,
  Hr,
  Link,
} from '@react-email/components';

export interface CancellationEmailProps {
  purchaseOrderId: number;
  qNumber: string;
  supplierName: string;
  createdAt: string;
  supplierOrders: {
    order_id: number;
    order_quantity: number;
    notes?: string | null;
    supplier_component: {
      supplier_code: string;
      price: number;
      component: {
        internal_code: string;
        description: string;
      };
    };
  }[];
  cancellationReason?: string;
  companyName?: string;
  companyLogoUrl?: string | null;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  supplierEmail?: string;
  contactName?: string;
  contactEmail?: string;
}

const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

export default function PurchaseOrderCancellationEmail({
  qNumber,
  supplierName,
  createdAt,
  supplierOrders,
  cancellationReason,
  companyName = 'Unity',
  companyLogoUrl,
  companyAddress = '',
  companyPhone = '',
  companyEmail = '',
  supplierEmail,
  contactName = 'Mignon',
  contactEmail = 'orders@qbutton.co.za',
}: CancellationEmailProps) {
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

  const subtotal = totals.value;
  const vatAmount = subtotal * 0.15;
  const totalInclVAT = subtotal + vatAmount;

  return (
    <Html>
      <Head />
      <Preview>CANCELLED - Purchase Order {qNumber} from {companyName}</Preview>
      <Tailwind>
        <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#1f2937' }}>
          <Container style={{ maxWidth: '768px', margin: '0 auto', padding: '24px' }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb', padding: '32px' }}>

              {/* Cancellation Banner */}
              <Section>
                <div style={{ backgroundColor: '#fef2f2', border: '2px solid #ef4444', borderRadius: '12px', padding: '16px', textAlign: 'center', marginBottom: '24px' }}>
                  <Text style={{ fontSize: '20px', fontWeight: 700, color: '#dc2626', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Order Cancelled
                  </Text>
                  <Text style={{ fontSize: '14px', color: '#991b1b', margin: 0 }}>
                    Purchase Order {qNumber} has been cancelled. Please do not process this order.
                  </Text>
                </div>
              </Section>

              {/* Header */}
              <Section>
                <Row>
                  <Column style={{ width: '50%', verticalAlign: 'top' }}>
                    {companyLogoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={companyLogoUrl} alt={companyName} style={{ height: '40px', width: 'auto', marginBottom: '8px' }} />
                    ) : null}
                    <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '1.4', margin: 0 }}>
                      {companyName}<br />
                      {companyAddress}<br />
                      Phone: {companyPhone}<br />
                      Email: {companyEmail}
                    </Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right', verticalAlign: 'top' }}>
                    <Text style={{ fontSize: '12px', fontWeight: 500, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Cancelled Purchase Order</Text>
                    <Text style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: '0 0 4px 0', textDecoration: 'line-through' }}>PO {qNumber}</Text>
                    <Text style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>Original Date: {formattedDate}</Text>
                  </Column>
                </Row>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* From / To */}
              <Section>
                <Row>
                  <Column style={{ width: '50%', verticalAlign: 'top', paddingRight: '8px' }}>
                    <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px' }}>
                      <Text style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>From</Text>
                      <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.4', margin: 0 }}>
                        {companyName}<br />
                        {companyAddress}<br />
                        Phone: {companyPhone}<br />
                        Email: {companyEmail}
                      </Text>
                    </div>
                  </Column>
                  <Column style={{ width: '50%', verticalAlign: 'top', paddingLeft: '8px' }}>
                    <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px' }}>
                      <Text style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>To</Text>
                      <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.4', margin: 0 }}>
                        {supplierName}<br />
                        {supplierEmail && <>Email: {supplierEmail}</>}
                      </Text>
                    </div>
                  </Column>
                </Row>
              </Section>

              {/* Cancellation Reason */}
              {cancellationReason && (
                <>
                  <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
                  <Section>
                    <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px' }}>
                      <Text style={{ fontSize: '11px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Cancellation Reason</Text>
                      <Text style={{ fontSize: '12px', color: '#7f1d1d', lineHeight: '1.5', margin: 0, whiteSpace: 'pre-wrap' }}>{cancellationReason}</Text>
                    </div>
                  </Section>
                </>
              )}

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Cancelled Items Table */}
              <Section>
                <Text style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>Cancelled Items</Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#fef2f2' }}>
                      <th style={{ width: '11%', padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Supplier Code</th>
                      <th style={{ width: '11%', padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Internal Code</th>
                      <th style={{ width: '42%', padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Description</th>
                      <th style={{ width: '9%', padding: '6px 8px', textAlign: 'right', fontSize: '10px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Quantity</th>
                      <th style={{ width: '13%', padding: '6px 8px', textAlign: 'right', fontSize: '10px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Unit Price</th>
                      <th style={{ width: '14%', padding: '6px 8px', textAlign: 'right', fontSize: '10px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierOrders.map((item, index) => {
                      const lineTotal = item.order_quantity * item.supplier_component.price;
                      const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
                      return (
                        <React.Fragment key={item.order_id}>
                          <tr style={{ backgroundColor: bgColor }}>
                            <td style={{ padding: '10px 8px', fontSize: '12px', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', textDecoration: 'line-through', color: '#9ca3af' }}>{item.supplier_component.supplier_code}</td>
                            <td style={{ padding: '10px 8px', fontSize: '12px', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', textDecoration: 'line-through', color: '#9ca3af' }}>{item.supplier_component.component.internal_code}</td>
                            <td style={{ padding: '10px 8px', fontSize: '12px', lineHeight: '1.5', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', textDecoration: 'line-through', color: '#9ca3af' }}>{item.supplier_component.component.description}</td>
                            <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', textDecoration: 'line-through', color: '#9ca3af' }}>{item.order_quantity}</td>
                            <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', whiteSpace: 'nowrap', textDecoration: 'line-through', color: '#9ca3af' }}>{formatCurrency(item.supplier_component.price)}</td>
                            <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', fontWeight: 500, borderBottom: item.notes ? 'none' : '1px solid #f3f4f6', whiteSpace: 'nowrap', textDecoration: 'line-through', color: '#9ca3af' }}>{formatCurrency(lineTotal)}</td>
                          </tr>
                          {item.notes && (
                            <tr style={{ backgroundColor: bgColor }}>
                              <td colSpan={6} style={{ padding: '0 8px 10px 8px', fontSize: '11px', fontStyle: 'italic', color: '#9ca3af', borderBottom: '1px solid #f3f4f6' }}>
                                Note: {item.notes}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    <tr style={{ backgroundColor: '#fef2f2' }}>
                      <td colSpan={5} style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', fontWeight: 500, color: '#991b1b', borderTop: '2px solid #fecaca' }}>Cancelled Total (excl. VAT)</td>
                      <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', fontWeight: 500, color: '#991b1b', borderTop: '2px solid #fecaca', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{formatCurrency(subtotal)}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#fef2f2' }}>
                      <td colSpan={5} style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', fontWeight: 500, color: '#991b1b' }}>VAT @ 15%</td>
                      <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', fontWeight: 500, color: '#991b1b', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{formatCurrency(vatAmount)}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#fef2f2' }}>
                      <td colSpan={5} style={{ padding: '12px 8px', fontSize: '13px', textAlign: 'right', fontWeight: 700, color: '#991b1b', borderTop: '2px solid #ef4444' }}>Cancelled Total (incl. VAT)</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', textAlign: 'right', fontWeight: 700, color: '#991b1b', borderTop: '2px solid #ef4444', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{formatCurrency(totalInclVAT)}</td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Acknowledgement Request */}
              <Section>
                <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
                  <Text style={{ fontSize: '12px', color: '#374151', lineHeight: '1.5', margin: 0 }}>
                    Please acknowledge receipt of this cancellation notice. If you have any questions or concerns regarding this cancellation, please contact {contactName} at{' '}
                    <Link href={`mailto:${contactEmail}`} style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>{contactEmail}</Link>.
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Footer */}
              <Section style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
                  <strong>{companyName}</strong><br />
                  {companyAddress}<br />
                  Phone: {companyPhone} | Email: {companyEmail}<br />
                  <br />
                  This is an automated cancellation notice from Unity ERP.<br />
                  &copy; {new Date().getFullYear()} {companyName}. All rights reserved.
                </Text>
              </Section>

            </div>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
