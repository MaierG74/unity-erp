import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Customers',
};

export default function CustomersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
