import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Suppliers',
};

export default function SuppliersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
