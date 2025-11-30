import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Products',
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
