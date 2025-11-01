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
} from '@react-email/components';

export interface SupplierOrderItem {
  order_id: number;
  order_quantity: number;
  supplier_component: {
    supplier_code: string;
    price: number;
    component: {
      internal_code: string;
      description: string;
    };
  };
}

export interface PurchaseOrderEmailProps {
  purchaseOrderId: number;
  qNumber: string;
  supplierName: string;
  createdAt: string;
  supplierOrders: SupplierOrderItem[];
  notes?: string;
  companyName?: string;
  companyLogoUrl?: string | null;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  supplierEmail?: string;
}

const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

export default function PurchaseOrderEmail({
  qNumber,
  supplierName,
  createdAt,
  supplierOrders,
  companyName = 'Unity',
  companyLogoUrl,
  companyAddress = '123 Unity Street, London, UK',
  companyPhone = '+44 123 456 7890',
  companyEmail = 'purchasing@example.com',
  supplierEmail,
}: PurchaseOrderEmailProps) {
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
  return (
    <Html>
      <Head />
      <Preview>Purchase Order {qNumber} from {companyName}</Preview>
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
                    <Text style={{ fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>Purchase Order</Text>
                    <Text style={{ fontSize: '20px', fontWeight: 600, color: '#111827', margin: '0 0 4px 0' }}>PO {qNumber}</Text>
                    <Text style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>Date: {formattedDate}</Text>
                  </Column>
                </Row>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* From / To Section */}
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

              {/* Order Items Table */}
              <Section>
                <Text style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>Order Items</Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ width: '12%', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Supplier Code</th>
                      <th style={{ width: '12%', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Internal Code</th>
                      <th style={{ width: '40%', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Description</th>
                      <th style={{ width: '10%', padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Quantity</th>
                      <th style={{ width: '13%', padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Unit Price</th>
                      <th style={{ width: '13%', padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierOrders.map((item, index) => {
                      const lineTotal = item.order_quantity * item.supplier_component.price;
                      return (
                        <tr key={item.order_id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                          <td style={{ padding: '12px', fontSize: '13px', borderBottom: '1px solid #f3f4f6' }}>{item.supplier_component.supplier_code}</td>
                          <td style={{ padding: '12px', fontSize: '13px', borderBottom: '1px solid #f3f4f6' }}>{item.supplier_component.component.internal_code}</td>
                          <td style={{ padding: '12px', fontSize: '13px', lineHeight: '1.6', borderBottom: '1px solid #f3f4f6' }}>{item.supplier_component.component.description}</td>
                          <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{item.order_quantity}</td>
                          <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{formatCurrency(item.supplier_component.price)}</td>
                          <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', fontWeight: 500, borderBottom: '1px solid #f3f4f6' }}>{formatCurrency(lineTotal)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <td colSpan={5} style={{ padding: '12px', fontSize: '13px', textAlign: 'right', fontWeight: 600, color: '#111827', borderTop: '2px solid #e5e7eb' }}>Total</td>
                      <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', fontWeight: 600, color: '#111827', borderTop: '2px solid #e5e7eb' }}>{formatCurrency(totals.value)}</td>
                    </tr>
                  </tbody>
                </table>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              {/* Footer */}
              <Section style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
                  {companyName}<br />
                  {companyAddress}<br />
                  Phone: {companyPhone} | Email: {companyEmail}<br />
                  This is an automated email from Unity ERP.<br />
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
