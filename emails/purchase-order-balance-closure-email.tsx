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

export interface BalanceClosureItem {
  orderId: number;
  supplierCode: string;
  internalCode: string;
  description: string;
  unitPrice: number;
  orderedQuantity: number;
  receivedQuantity: number;
  previouslyClosedQuantity: number;
  closedNowQuantity: number;
  remainingOutstandingQuantity: number;
}

export interface PurchaseOrderBalanceClosureEmailProps {
  qNumber: string;
  supplierName: string;
  createdAt: string;
  item: BalanceClosureItem;
  reasonLabel?: string;
  notes?: string | null;
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

export default function PurchaseOrderBalanceClosureEmail({
  qNumber,
  supplierName,
  createdAt,
  item,
  reasonLabel,
  notes,
  companyName = 'Unity',
  companyLogoUrl,
  companyAddress = '',
  companyPhone = '',
  companyEmail = '',
  supplierEmail,
  contactName = 'Mignon',
  contactEmail = 'orders@qbutton.co.za',
}: PurchaseOrderBalanceClosureEmailProps) {
  const formattedDate = new Date(createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const isFullBalanceClosed = item.remainingOutstandingQuantity <= 0;
  const lineTotal = item.closedNowQuantity * item.unitPrice;

  return (
    <Html>
      <Head />
      <Preview>Balance update for Purchase Order {qNumber} from {companyName}</Preview>
      <Tailwind>
        <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#1f2937' }}>
          <Container style={{ maxWidth: '768px', margin: '0 auto', padding: '24px' }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb', padding: '32px' }}>
              <Section>
                <div style={{ backgroundColor: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '12px', padding: '16px', textAlign: 'center', marginBottom: '24px' }}>
                  <Text style={{ fontSize: '20px', fontWeight: 700, color: '#b45309', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Outstanding Balance Update
                  </Text>
                  <Text style={{ fontSize: '14px', color: '#92400e', margin: 0 }}>
                    {isFullBalanceClosed
                      ? `Please cancel/short-close the remaining outstanding balance for this line on Purchase Order ${qNumber}.`
                      : `Please cancel/short-close only the quantity listed below. The remaining outstanding quantity stays open for delivery.`}
                  </Text>
                </div>
              </Section>

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
                    <Text style={{ fontSize: '12px', fontWeight: 500, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Balance Update</Text>
                    <Text style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: '0 0 4px 0' }}>PO {qNumber}</Text>
                    <Text style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>Original Date: {formattedDate}</Text>
                  </Column>
                </Row>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

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

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              <Section>
                <Text style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
                  Balance Adjustment
                </Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#fffbeb' }}>
                      <th style={{ width: '15%', padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#92400e', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Supplier Code</th>
                      <th style={{ width: '15%', padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#92400e', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Internal Code</th>
                      <th style={{ width: '45%', padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#92400e', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Description</th>
                      <th style={{ width: '10%', padding: '6px 8px', textAlign: 'right', fontSize: '10px', fontWeight: 600, color: '#92400e', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Unit</th>
                      <th style={{ width: '15%', padding: '6px 8px', textAlign: 'right', fontSize: '10px', fontWeight: 600, color: '#92400e', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '10px 8px', fontSize: '12px', borderBottom: '1px solid #f3f4f6' }}>{item.supplierCode}</td>
                      <td style={{ padding: '10px 8px', fontSize: '12px', borderBottom: '1px solid #f3f4f6' }}>{item.internalCode}</td>
                      <td style={{ padding: '10px 8px', fontSize: '12px', lineHeight: '1.5', borderBottom: '1px solid #f3f4f6' }}>{item.description}</td>
                      <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{formatCurrency(item.unitPrice)}</td>
                      <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{formatCurrency(lineTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              <Section style={{ marginTop: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', color: '#374151', border: '1px solid #e5e7eb' }}>
                  <tbody>
                    <tr style={{ backgroundColor: '#ffffff' }}>
                      <td style={{ padding: '8px', fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}>Ordered</td>
                      <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{item.orderedQuantity}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <td style={{ padding: '8px', fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}>Received</td>
                      <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{item.receivedQuantity}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#ffffff' }}>
                      <td style={{ padding: '8px', fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}>Previously Closed</td>
                      <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{item.previouslyClosedQuantity}</td>
                    </tr>
                    <tr style={{ backgroundColor: '#fffbeb' }}>
                      <td style={{ padding: '8px', fontWeight: 700, color: '#92400e', borderBottom: '1px solid #f3f4f6' }}>Cancelled Now</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: '#92400e', borderBottom: '1px solid #f3f4f6' }}>{item.closedNowQuantity}</td>
                    </tr>
                    <tr style={{ backgroundColor: isFullBalanceClosed ? '#f0fdf4' : '#eff6ff' }}>
                      <td style={{ padding: '8px', fontWeight: 700, color: isFullBalanceClosed ? '#047857' : '#1d4ed8' }}>Still Outstanding</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: isFullBalanceClosed ? '#047857' : '#1d4ed8' }}>{item.remainingOutstandingQuantity}</td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              {(reasonLabel || notes) && (
                <>
                  <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
                  <Section>
                    <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
                      {reasonLabel && (
                        <Text style={{ fontSize: '12px', color: '#374151', lineHeight: '1.5', margin: '0 0 6px 0' }}>
                          <strong>Reason:</strong> {reasonLabel}
                        </Text>
                      )}
                      {notes && (
                        <Text style={{ fontSize: '12px', color: '#374151', lineHeight: '1.5', margin: 0, whiteSpace: 'pre-wrap' }}>
                          <strong>Notes:</strong> {notes}
                        </Text>
                      )}
                    </div>
                  </Section>
                </>
              )}

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              <Section>
                <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
                  <Text style={{ fontSize: '12px', color: '#374151', lineHeight: '1.5', margin: 0 }}>
                    Please acknowledge this balance update. If you have any questions, contact {contactName} at{' '}
                    <Link href={`mailto:${contactEmail}`} style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>{contactEmail}</Link>.
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              <Section style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
                  <strong>{companyName}</strong><br />
                  {companyAddress}<br />
                  Phone: {companyPhone} | Email: {companyEmail}<br />
                  <br />
                  This is an automated purchase order balance update from Unity ERP.<br />
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
