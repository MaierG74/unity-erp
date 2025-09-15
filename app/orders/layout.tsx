import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Orders',
};

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
