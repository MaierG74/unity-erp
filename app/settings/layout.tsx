import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
