import React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Tailwind,
  Row,
  Column,
  Hr,
  Link,
  Button,
} from '@react-email/components';

export interface ReturnItem {
  component_code: string;
  component_name: string;
  quantity_returned: number;
  reason: string;
}

export interface SupplierReturnEmailProps {
  goodsReturnNumber: string;
  purchaseOrderNumber: string;
  returnDate: string;
  items: ReturnItem[];
  returnType: 'rejection' | 'later_return' | 'mixed';
  notes?: string;
  pdfDownloadUrl?: string;
  supplierName: string;
  supplierEmail?: string;
  companyName?: string;
  companyLogoUrl?: string | null;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
}

export default function SupplierReturnEmail({
  goodsReturnNumber,
  purchaseOrderNumber,
  returnDate,
  items,
  returnType,
  notes,
  pdfDownloadUrl,
  supplierName,
  supplierEmail,
  companyName = 'Unity',
  companyLogoUrl,
  companyAddress = '123 Unity Street, London, UK',
  companyPhone = '+44 123 456 7890',
  companyEmail = 'purchasing@example.com',
}: SupplierReturnEmailProps) {
  const formattedDate = new Date(returnDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity_returned, 0);

  const getReturnTypeLabel = () => {
    if (returnType === 'rejection') return 'Rejection at Gate';
    if (returnType === 'later_return') return 'Return from Stock';
    return 'Mixed Return';
  };

  const getReturnTypeDescription = () => {
    if (returnType === 'rejection') {
      return 'These goods were rejected during delivery inspection and have NOT been entered into our inventory.';
    }
    if (returnType === 'later_return') {
      return 'These goods were previously received into our inventory and are now being returned.';
    }
    return 'This return includes both rejected items and items being returned from stock.';
  };

  return (
    <Html>
      <Head />
      <Preview>Goods Returned - {goodsReturnNumber} ({purchaseOrderNumber})</Preview>
      <Tailwind>
        <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#1f2937' }}>
          <Container style={{ maxWidth: '768px', margin: '0 auto', padding: '24px' }}>
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
                    <Text style={{ fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Goods Returned</Text>
                    <Text style={{ fontSize: '20px', fontWeight: 600, color: '#dc2626', margin: '0 0 4px 0' }}>{goodsReturnNumber}</Text>
                    <Text style={{ fontSize: '14px', color: '#4b5563', margin: '0 0 2px 0' }}>PO: {purchaseOrderNumber}</Text>
                    <Text style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>Date: {formattedDate}</Text>
                  </Column>
                </Row>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Return Type Badge */}
              <Section>
                <div style={{ backgroundColor: returnType === 'rejection' ? '#fef2f2' : '#fef3c7', border: `1px solid ${returnType === 'rejection' ? '#fca5a5' : '#fbbf24'}`, borderRadius: '8px', padding: '12px 16px' }}>
                  <Text style={{ fontSize: '11px', fontWeight: 600, color: returnType === 'rejection' ? '#991b1b' : '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>{getReturnTypeLabel()}</Text>
                  <Text style={{ fontSize: '12px', color: returnType === 'rejection' ? '#7f1d1d' : '#78350f', lineHeight: '1.5', margin: 0 }}>
                    {getReturnTypeDescription()}
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Supplier Info */}
              <Section>
                <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px' }}>
                  <Text style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>Supplier</Text>
                  <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.4', margin: 0 }}>
                    {supplierName}<br />
                    {supplierEmail && <>Email: {supplierEmail}</>}
                  </Text>
                </div>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Returned Items Table */}
              <Section>
                <Text style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>Returned Items</Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ width: '15%', padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Component</th>
                      <th style={{ width: '40%', padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Description</th>
                      <th style={{ width: '10%', padding: '8px', textAlign: 'right', fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Qty</th>
                      <th style={{ width: '35%', padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={index} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '10px 8px', fontSize: '12px', fontWeight: 500, borderBottom: '1px solid #f3f4f6' }}>{item.component_code}</td>
                        <td style={{ padding: '10px 8px', fontSize: '12px', lineHeight: '1.5', borderBottom: '1px solid #f3f4f6' }}>{item.component_name}</td>
                        <td style={{ padding: '10px 8px', fontSize: '12px', textAlign: 'right', fontWeight: 600, color: '#dc2626', borderBottom: '1px solid #f3f4f6' }}>{item.quantity_returned}</td>
                        <td style={{ padding: '10px 8px', fontSize: '12px', borderBottom: '1px solid #f3f4f6' }}>{item.reason}</td>
                      </tr>
                    ))}
                    <tr style={{ backgroundColor: '#fef2f2' }}>
                      <td colSpan={2} style={{ padding: '12px 8px', fontSize: '13px', textAlign: 'right', fontWeight: 600, color: '#991b1b', borderTop: '2px solid #dc2626' }}>Total Quantity Returned</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', textAlign: 'right', fontWeight: 700, color: '#dc2626', borderTop: '2px solid #dc2626' }}>{totalQuantity}</td>
                      <td style={{ borderTop: '2px solid #dc2626' }}></td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              {notes && (
                <>
                  <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
                  <Section>
                    <Text style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>Additional Notes</Text>
                    <Text style={{ fontSize: '12px', color: '#374151', lineHeight: '1.6', margin: 0 }}>
                      {notes}
                    </Text>
                  </Section>
                </>
              )}

              {pdfDownloadUrl && (
                <>
                  <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />
                  <Section style={{ textAlign: 'center' }}>
                    <Text style={{ fontSize: '13px', color: '#374151', margin: '0 0 16px 0' }}>
                      A detailed Goods Returned document is attached and available for download:
                    </Text>
                    <Button
                      href={pdfDownloadUrl}
                      style={{
                        backgroundColor: '#dc2626',
                        color: '#ffffff',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        fontWeight: 600,
                        fontSize: '14px',
                        display: 'inline-block',
                      }}
                    >
                      Download Return Document (PDF)
                    </Button>
                  </Section>
                </>
              )}

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Important Notice */}
              <Section>
                <div style={{ backgroundColor: returnType === 'rejection' ? '#fef2f2' : '#fef3c7', border: `1px solid ${returnType === 'rejection' ? '#dc2626' : '#fbbf24'}`, borderRadius: '8px', padding: '12px 16px' }}>
                  <Text style={{ fontSize: '11px', fontWeight: 600, color: returnType === 'rejection' ? '#991b1b' : '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Action Required</Text>
                  <Text style={{ fontSize: '12px', color: returnType === 'rejection' ? '#7f1d1d' : '#78350f', lineHeight: '1.5', margin: 0 }}>
                    {returnType === 'rejection'
                      ? 'These items were rejected at our gate and require immediate attention. Please arrange for collection and issue a credit note.'
                      : 'These items have been removed from our inventory and are being returned. Please arrange for collection and issue a credit note or replacement.'
                    }
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
                  This is an automated notification from Unity ERP.<br />
                  Please contact us if you have any questions regarding this return.<br />
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
