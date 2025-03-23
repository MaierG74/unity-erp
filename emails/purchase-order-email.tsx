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
  companyLogo?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
}

export default function PurchaseOrderEmail({
  purchaseOrderId,
  qNumber,
  supplierName,
  createdAt,
  supplierOrders,
  notes,
  companyName = 'Unity',
  companyLogo = 'https://your-company-logo-url.com',
  companyAddress = '123 Unity Street, London, UK',
  companyPhone = '+44 123 456 7890',
  companyEmail = 'purchasing@example.com',
}: PurchaseOrderEmailProps) {
  // Calculate total amount
  const totalAmount = supplierOrders.reduce(
    (sum, item) => sum + item.order_quantity * item.supplier_component.price,
    0
  );

  const formattedDate = new Date(createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Html>
      <Head />
      <Preview>Purchase Order {qNumber} from {companyName}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="bg-white p-8 rounded shadow-sm my-10 max-w-4xl">
            {/* Header */}
            <Section className="pb-6">
              <Row>
                <Column className="text-left">
                  <Heading className="text-2xl font-bold text-gray-800">PURCHASE ORDER</Heading>
                  <Text className="text-gray-500">PO Number: {qNumber}</Text>
                  <Text className="text-gray-500">Date: {formattedDate}</Text>
                </Column>
                <Column className="text-right">
                  {/* Company Logo Placeholder */}
                  <img src={companyLogo} alt={companyName} width="150" />
                </Column>
              </Row>
            </Section>

            <Hr className="border-gray-300 my-4" />

            {/* From/To Section */}
            <Section className="py-4">
              <Row>
                <Column className="w-1/2">
                  <Text className="font-bold text-gray-800">From:</Text>
                  <Text className="text-gray-600">{companyName}</Text>
                  <Text className="text-gray-600">{companyAddress}</Text>
                  <Text className="text-gray-600">{companyPhone}</Text>
                  <Text className="text-gray-600">{companyEmail}</Text>
                </Column>
                <Column className="w-1/2">
                  <Text className="font-bold text-gray-800">To:</Text>
                  <Text className="text-gray-600">{supplierName}</Text>
                </Column>
              </Row>
            </Section>

            <Hr className="border-gray-300 my-4" />

            {/* Order Items */}
            <Section className="py-4">
              <Heading as="h3" className="text-lg font-semibold mb-4">Order Items:</Heading>
              
              {/* Table Header */}
              <Row className="bg-gray-100 p-2">
                <Column className="w-1/6 p-2"><Text className="font-bold">Supplier Code</Text></Column>
                <Column className="w-1/6 p-2"><Text className="font-bold">Internal Code</Text></Column>
                <Column className="w-2/6 p-2"><Text className="font-bold">Description</Text></Column>
                <Column className="w-1/6 p-2"><Text className="font-bold text-right">Quantity</Text></Column>
                <Column className="w-1/6 p-2"><Text className="font-bold text-right">Unit Price</Text></Column>
              </Row>
              
              {/* Table Rows */}
              {supplierOrders.map((item) => (
                <Row key={item.order_id} className="border-b border-gray-200">
                  <Column className="w-1/6 p-2">
                    <Text>{item.supplier_component.supplier_code}</Text>
                  </Column>
                  <Column className="w-1/6 p-2">
                    <Text>{item.supplier_component.component.internal_code}</Text>
                  </Column>
                  <Column className="w-2/6 p-2">
                    <Text>{item.supplier_component.component.description}</Text>
                  </Column>
                  <Column className="w-1/6 p-2">
                    <Text className="text-right">{item.order_quantity}</Text>
                  </Column>
                  <Column className="w-1/6 p-2">
                    <Text className="text-right">R{item.supplier_component.price.toFixed(2)}</Text>
                  </Column>
                </Row>
              ))}

              {/* Total */}
              <Row className="mt-4">
                <Column className="w-5/6 text-right p-2">
                  <Text className="font-bold">Total:</Text>
                </Column>
                <Column className="w-1/6 text-right p-2">
                  <Text className="font-bold">R{totalAmount.toFixed(2)}</Text>
                </Column>
              </Row>
            </Section>

            {notes && (
              <>
                <Hr className="border-gray-300 my-4" />
                <Section className="py-4">
                  <Heading as="h3" className="text-lg font-semibold mb-2">Notes:</Heading>
                  <Text className="text-gray-600">{notes}</Text>
                </Section>
              </>
            )}

            <Hr className="border-gray-300 my-4" />

            {/* Footer */}
            <Section className="pt-4">
              <Text className="text-sm text-gray-500 text-center">
                This is an automatically generated email. Please contact {companyEmail} if you have any questions.
              </Text>
              <Text className="text-sm text-gray-500 text-center">
                &copy; {new Date().getFullYear()} {companyName}. All rights reserved.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
} 