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
  Img,
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
  companyLogo?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
}

export default function QuoteEmail({
  quoteNumber,
  customerName,
  quoteDate,
  subtotal,
  vatAmount,
  grandTotal,
  validityDays = 30,
  customMessage,
  companyName = 'Qbutton Manufacturing',
  companyLogo,
  companyAddress = 'Your Business Address, City, Postal Code',
  companyPhone = '+27 XX XXX XXXX',
  companyEmail = 'sales@qbutton.co.za',
  companyWebsite,
}: QuoteEmailProps) {
  const formatCurrency = (amount: number) => `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Html>
      <Head />
      <Preview>Quotation {quoteNumber} - {formatCurrency(grandTotal)}</Preview>
      <Tailwind>
        <Body style={{
          backgroundColor: '#f4f4f5',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          padding: '40px 20px',
          margin: 0,
        }}>
          <Container style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            maxWidth: '600px',
            margin: '0 auto',
            overflow: 'hidden',
          }}>
            {/* Header - Clean white with logo */}
            <Section style={{ padding: '32px 40px 24px 40px' }}>
              {companyLogo ? (
                <Img
                  src={companyLogo}
                  alt={companyName}
                  height="50"
                  style={{ height: '50px', width: 'auto' }}
                />
              ) : (
                <Text style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#18181b',
                  margin: '0',
                }}>
                  {companyName}
                </Text>
              )}
            </Section>

            <Hr style={{ borderColor: '#e4e4e7', margin: '0 40px' }} />

            {/* Main Content */}
            <Section style={{ padding: '32px 40px 40px 40px' }}>
              {/* Greeting */}
              <Text style={{
                fontSize: '15px',
                color: '#18181b',
                margin: '0 0 20px 0',
                lineHeight: '1.6'
              }}>
                Dear {customerName},
              </Text>

              <Text style={{
                fontSize: '15px',
                color: '#52525b',
                margin: '0 0 28px 0',
                lineHeight: '1.7'
              }}>
                Thank you for allowing us to quote. Please find attached our quotation for your review.
              </Text>

              {/* Custom Message (if provided) */}
              {customMessage && (
                <Section style={{
                  backgroundColor: '#fafafa',
                  padding: '16px 20px',
                  borderRadius: '6px',
                  marginBottom: '28px',
                  borderLeft: '3px solid #d4d4d8',
                }}>
                  <Text style={{
                    fontSize: '14px',
                    color: '#52525b',
                    margin: '0',
                    lineHeight: '1.6',
                    fontStyle: 'italic',
                  }}>
                    {customMessage}
                  </Text>
                </Section>
              )}

              {/* Quote Summary */}
              <Section style={{
                backgroundColor: '#fafafa',
                borderRadius: '6px',
                padding: '20px 24px',
                marginBottom: '28px',
              }}>
                <Row style={{ marginBottom: '10px' }}>
                  <Column style={{ width: '50%' }}>
                    <Text style={{ fontSize: '14px', color: '#71717a', margin: '0' }}>Quote Number</Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right' as const }}>
                    <Text style={{ fontSize: '14px', fontWeight: '600', color: '#18181b', margin: '0' }}>{quoteNumber}</Text>
                  </Column>
                </Row>

                <Row style={{ marginBottom: '10px' }}>
                  <Column style={{ width: '50%' }}>
                    <Text style={{ fontSize: '14px', color: '#71717a', margin: '0' }}>Date</Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right' as const }}>
                    <Text style={{ fontSize: '14px', color: '#18181b', margin: '0' }}>{quoteDate}</Text>
                  </Column>
                </Row>

                <Row>
                  <Column style={{ width: '50%' }}>
                    <Text style={{ fontSize: '14px', color: '#71717a', margin: '0' }}>Valid For</Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right' as const }}>
                    <Text style={{ fontSize: '14px', color: '#18181b', margin: '0' }}>{validityDays} days</Text>
                  </Column>
                </Row>
              </Section>

              {/* Pricing Summary */}
              <Section style={{ marginBottom: '28px' }}>
                <Row style={{ marginBottom: '6px' }}>
                  <Column style={{ width: '50%' }}>
                    <Text style={{ fontSize: '14px', color: '#71717a', margin: '0' }}>Subtotal (excl. VAT)</Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right' as const }}>
                    <Text style={{ fontSize: '14px', color: '#18181b', margin: '0' }}>{formatCurrency(subtotal)}</Text>
                  </Column>
                </Row>

                <Row style={{ marginBottom: '12px' }}>
                  <Column style={{ width: '50%' }}>
                    <Text style={{ fontSize: '14px', color: '#71717a', margin: '0' }}>VAT (15%)</Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right' as const }}>
                    <Text style={{ fontSize: '14px', color: '#18181b', margin: '0' }}>{formatCurrency(vatAmount)}</Text>
                  </Column>
                </Row>

                <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 12px 0' }} />

                <Row>
                  <Column style={{ width: '50%' }}>
                    <Text style={{ fontSize: '15px', fontWeight: '600', color: '#18181b', margin: '0' }}>
                      Total (incl. VAT)
                    </Text>
                  </Column>
                  <Column style={{ width: '50%', textAlign: 'right' as const }}>
                    <Text style={{ fontSize: '17px', fontWeight: 'bold', color: '#18181b', margin: '0' }}>
                      {formatCurrency(grandTotal)}
                    </Text>
                  </Column>
                </Row>
              </Section>

              {/* Closing */}
              <Text style={{
                fontSize: '15px',
                color: '#52525b',
                margin: '0',
                lineHeight: '1.7'
              }}>
                Please review the attached PDF and contact us if you need any adjustments.
              </Text>
            </Section>

            {/* Footer */}
            <Section style={{
              backgroundColor: '#18181b',
              padding: '28px 40px',
            }}>
              <Text style={{
                fontSize: '15px',
                fontWeight: '600',
                color: '#ffffff',
                margin: '0 0 8px 0'
              }}>
                {companyName}
              </Text>
              <Text style={{
                fontSize: '13px',
                color: '#a1a1aa',
                margin: '0 0 4px 0',
                lineHeight: '1.5'
              }}>
                {companyAddress}
              </Text>
              <Text style={{
                fontSize: '13px',
                color: '#a1a1aa',
                margin: '0 0 4px 0'
              }}>
                Tel: {companyPhone}
              </Text>
              <Text style={{
                fontSize: '13px',
                color: '#a1a1aa',
                margin: '0'
              }}>
                Email: <Link href={`mailto:${companyEmail}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>{companyEmail}</Link>
              </Text>
              {companyWebsite && (
                <Text style={{
                  fontSize: '13px',
                  color: '#a1a1aa',
                  margin: '4px 0 0 0'
                }}>
                  Web: <Link href={companyWebsite} style={{ color: '#60a5fa', textDecoration: 'none' }}>{companyWebsite.replace(/^https?:\/\//, '')}</Link>
                </Text>
              )}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
