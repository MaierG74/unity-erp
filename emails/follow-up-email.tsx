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

export interface FollowUpItem {
  internal_code: string;
  description: string;
  supplier_code: string;
  quantity_ordered: number;
  po_number: string;
  order_date: string;
}

export interface FollowUpEmailProps {
  supplierName: string;
  items: FollowUpItem[];
  companyName?: string;
  companyLogoUrl?: string | null;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  supplierEmail?: string;
  responseUrl?: string;
}

export default function FollowUpEmail({
  supplierName,
  items,
  companyName = 'Unity',
  companyLogoUrl,
  companyAddress = '123 Unity Street, London, UK',
  companyPhone = '+44 123 456 7890',
  companyEmail = 'purchasing@example.com',
  responseUrl,
  supplierEmail,
}: FollowUpEmailProps) {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // Group items by PO number
  const poNumbers = [...new Set(items.map(item => item.po_number))];

  return (
    <Html>
      <Head />
      <Preview>Order Follow-Up - {poNumbers.join(', ')} from {companyName}</Preview>
      <Tailwind>
        <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#1f2937' }}>
          <Container style={{ maxWidth: '680px', margin: '0 auto', padding: '24px' }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb', padding: '32px' }}>

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
                    <Text style={{ fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Order Follow-Up</Text>
                    <Text style={{ fontSize: '20px', fontWeight: 600, color: '#2563eb', margin: '0 0 4px 0' }}>Delivery Status Request</Text>
                    <Text style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>Date: {today}</Text>
                  </Column>
                </Row>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Greeting */}
              <Section>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                  Dear {supplierName},
                </Text>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                  We are writing to follow up on the following outstanding order{poNumbers.length > 1 ? 's' : ''}. Could you please provide us with an update on the delivery status and expected arrival date?
                </Text>
              </Section>

              {/* Order Reference */}
              <Section>
                <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                  <Text style={{ fontSize: '12px', fontWeight: 600, color: '#1e40af', margin: 0 }}>
                    Purchase Order Reference{poNumbers.length > 1 ? 's' : ''}: {poNumbers.join(', ')}
                  </Text>
                </div>
              </Section>

              {/* Items Table */}
              <Section>
                <Text style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px 0' }}>Items Awaiting Delivery</Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>PO #</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>Supplier Code</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>Description</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>Qty</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb' }}>Order Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={index} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '14px 16px', fontSize: '13px', fontWeight: 600, color: '#2563eb', borderBottom: '1px solid #f3f4f6' }}>{item.po_number}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', borderBottom: '1px solid #f3f4f6' }}>{item.supplier_code}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', lineHeight: '1.5', borderBottom: '1px solid #f3f4f6' }}>{item.description}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid #f3f4f6' }}>{item.quantity_ordered}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{item.order_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Response Button */}
              {responseUrl && (
                <Section style={{ textAlign: 'center', margin: '24px 0' }}>
                  <Link
                    href={responseUrl}
                    style={{
                      display: 'inline-block',
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      fontSize: '14px',
                      fontWeight: 600,
                      padding: '14px 32px',
                      borderRadius: '8px',
                      textDecoration: 'none',
                    }}
                  >
                    Update Delivery Status
                  </Link>
                  <Text style={{ fontSize: '12px', color: '#6b7280', margin: '12px 0 0 0' }}>
                    Click the button above to provide your delivery update
                  </Text>
                </Section>
              )}

              <Hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

              {/* Request */}
              <Section>
                <div style={{ backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px' }}>
                  <Text style={{ fontSize: '11px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Information Needed</Text>
                  <Text style={{ fontSize: '12px', color: '#4b5563', lineHeight: '1.5', margin: 0 }}>
                    • Current status of the order
                    <br />• Expected delivery/shipping date
                    <br />• Any issues or delays we should be aware of
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Closing */}
              <Section>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 8px 0' }}>
                  Thank you for your prompt attention to this matter.
                </Text>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: 0 }}>
                  Kind regards,<br />
                  <strong>{companyName} Purchasing Team</strong>
                </Text>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Footer */}
              <Section style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
                  <strong>{companyName}</strong><br />
                  {companyAddress}<br />
                  Phone: {companyPhone} | Email: {companyEmail}<br />
                  <br />
                  This is an automated follow-up from Unity ERP.<br />
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
