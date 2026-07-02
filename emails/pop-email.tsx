import React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Hr,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';

export interface PopEmailProps {
  supplierName: string;
  qNumber: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
}

export default function PopEmail({
  supplierName,
  qNumber,
  companyName = 'Unity',
  companyAddress,
  companyPhone,
  companyEmail,
}: PopEmailProps) {
  const contactLines = [
    companyAddress,
    companyPhone ? `Phone: ${companyPhone}` : null,
    companyEmail ? `Email: ${companyEmail}` : null,
  ].filter(Boolean);

  return (
    <Html>
      <Head />
      <Preview>Proof of payment for PO {qNumber}</Preview>
      <Tailwind>
        <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#1f2937' }}>
          <Container style={{ maxWidth: '680px', margin: '0 auto', padding: '24px' }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb', padding: '32px' }}>
              <Section>
                <Text style={{ fontSize: '12px', fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>
                  Proof of Payment
                </Text>
                <Text style={{ fontSize: '20px', fontWeight: 600, color: '#2563eb', margin: 0 }}>
                  PO {qNumber}
                </Text>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              <Section>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                  Dear {supplierName},
                </Text>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                  Please find attached the proof of payment for purchase order {qNumber}.
                </Text>
                <Text style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6', margin: 0 }}>
                  Kind regards,<br />
                  <strong>{companyName} Purchasing Team</strong>
                </Text>
              </Section>

              <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

              <Section style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: '11px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
                  <strong>{companyName}</strong>
                  {contactLines.length > 0 && (
                    <>
                      <br />
                      {contactLines.map((line, index) => (
                        <React.Fragment key={line}>
                          {index > 0 && <br />}
                          {line}
                        </React.Fragment>
                      ))}
                    </>
                  )}
                </Text>
              </Section>
            </div>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
