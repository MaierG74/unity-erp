import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Inventory',
};

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
