import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Purchasing',
};

export default function PurchasingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
