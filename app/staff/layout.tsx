import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Staff',
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
