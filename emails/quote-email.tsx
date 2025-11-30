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

export interface QuoteEmailProps {
  quoteNumber: string;
  customerName: string;
  quoteDate: string;
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  itemCount: number;
  validityDays?: number;
  customMessage?: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
}

export default function QuoteEmail({
  quoteNumber,
  customerName,
  quoteDate,
  subtotal,
  vatAmount,
  grandTotal,
  itemCount,
  validityDays = 30,
  customMessage,
  companyName = 'Unity',
  companyLogo,
  companyAddress = 'Your Business Address, City, Postal Code',
  companyPhone = '+27 XX XXX XXXX',
  companyEmail = 'quotes@unity-erp.com',
}: QuoteEmailProps) {
  const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

  return (
    <Html>
      <Head />
      <Preview>Quotation {quoteNumber} from {companyName}</Preview>
      <Tailwind>
        <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, sans-serif', padding: '20px 0' }}>
          <Container style={{
            backgroundColor: '#ffffff',
            padding: '40px',
            borderRadius: '8px',
            maxWidth: '600px',
            margin: '0 auto',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            {/* Header */}
            <Section style={{ paddingBottom: '20px', borderBottom: '3px solid #3b82f6' }}>
              <Heading style={{ fontSize: '28px', fontWeight: 'bold', color: '#1f2937', margin: '0' }}>
                {companyName}
              </Heading>
            </Section>

            {/* Greeting */}
            <Section style={{ paddingTop: '30px', paddingBottom: '20px' }}>
              <Text style={{ fontSize: '16px', color: '#1f2937', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                Dear {customerName},
              </Text>
              <Text style={{ fontSize: '15px', color: '#4b5563', margin: '0', lineHeight: '1.6' }}>
                Thank you for your interest in our products and services. Please find attached our quotation for your review.
              </Text>
            </Section>

            {/* Custom Message (if provided) */}
            {customMessage && (
              <Section style={{
                backgroundColor: '#eff6ff',
                padding: '20px',
                borderRadius: '6px',
                borderLeft: '4px solid #3b82f6',
                marginBottom: '24px'
              }}>
                <Text style={{ fontSize: '15px', color: '#1e40af', margin: '0', whiteSpace: 'pre-line', lineHeight: '1.6' }}>
                  {customMessage}
                </Text>
              </Section>
            )}

            {/* Quote Summary */}
            <Section style={{
              backgroundColor: '#f9fafb',
              padding: '24px',
              borderRadius: '6px',
              marginBottom: '20px'
            }}>
              <Heading as="h2" style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937', margin: '0 0 16px 0' }}>
                Quote Summary
              </Heading>

              <Row style={{ marginBottom: '8px' }}>
                <Column style={{ width: '50%' }}>
                  <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>Quote Number:</Text>
                </Column>
                <Column style={{ width: '50%', textAlign: 'right' }}>
                  <Text style={{ fontSize: '14px', fontWeight: '600', color: '#1f2937', margin: '0' }}>{quoteNumber}</Text>
                </Column>
              </Row>

              <Row style={{ marginBottom: '8px' }}>
                <Column style={{ width: '50%' }}>
                  <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>Date:</Text>
                </Column>
                <Column style={{ width: '50%', textAlign: 'right' }}>
                  <Text style={{ fontSize: '14px', color: '#1f2937', margin: '0' }}>{quoteDate}</Text>
                </Column>
              </Row>

              <Row style={{ marginBottom: '8px' }}>
                <Column style={{ width: '50%' }}>
                  <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>Number of Items:</Text>
                </Column>
                <Column style={{ width: '50%', textAlign: 'right' }}>
                  <Text style={{ fontSize: '14px', color: '#1f2937', margin: '0' }}>{itemCount}</Text>
                </Column>
              </Row>

              <Hr style={{ borderColor: '#d1d5db', margin: '12px 0' }} />

              <Row style={{ marginBottom: '8px' }}>
                <Column style={{ width: '50%' }}>
                  <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>Subtotal (excl. VAT):</Text>
                </Column>
                <Column style={{ width: '50%', textAlign: 'right' }}>
                  <Text style={{ fontSize: '14px', color: '#1f2937', margin: '0' }}>{formatCurrency(subtotal)}</Text>
                </Column>
              </Row>

              <Row style={{ marginBottom: '8px' }}>
                <Column style={{ width: '50%' }}>
                  <Text style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>VAT (15%):</Text>
                </Column>
                <Column style={{ width: '50%', textAlign: 'right' }}>
                  <Text style={{ fontSize: '14px', color: '#1f2937', margin: '0' }}>{formatCurrency(vatAmount)}</Text>
                </Column>
              </Row>

              <Row style={{ marginBottom: '0' }}>
                <Column style={{ width: '50%' }}>
                  <Text style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937', margin: '0' }}>Total (incl. VAT):</Text>
                </Column>
                <Column style={{ width: '50%', textAlign: 'right' }}>
                  <Text style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937', margin: '0' }}>{formatCurrency(grandTotal)}</Text>
                </Column>
              </Row>
            </Section>

            {/* Validity Notice */}
            <Section style={{
              backgroundColor: '#dbeafe',
              padding: '16px 20px',
              borderRadius: '6px',
              borderLeft: '4px solid #3b82f6',
              marginBottom: '24px'
            }}>
              <Text style={{ fontSize: '14px', color: '#1e40af', margin: '0', fontWeight: '600' }}>
                ⏰ This quotation is valid for {validityDays} days from the date above.
              </Text>
            </Section>

            {/* Call to Action */}
            <Section style={{ paddingBottom: '24px' }}>
              <Text style={{ fontSize: '15px', color: '#4b5563', margin: '0', lineHeight: '1.6' }}>
                Should you have any questions or require any clarifications, please don't hesitate to contact us. We look forward to working with you.
              </Text>
            </Section>

            <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

            {/* Footer - Company Info */}
            <Section style={{ paddingTop: '16px' }}>
              <Text style={{ fontSize: '14px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 8px 0' }}>
                {companyName}
              </Text>
              <Text style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 4px 0', lineHeight: '1.5' }}>
                {companyAddress}
              </Text>
              <Text style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 4px 0' }}>
                Tel: {companyPhone}
              </Text>
              <Text style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
                Email: <Link href={`mailto:${companyEmail}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>{companyEmail}</Link>
              </Text>
              <Text style={{ fontSize: '11px', color: '#9ca3af', margin: '0' }}>
                &copy; {new Date().getFullYear()} {companyName}. All rights reserved.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
