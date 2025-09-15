import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Collections',
};

export default function CollectionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
