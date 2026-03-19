import type { Metadata } from 'next';
import React from 'react';
import SettingsShell from './settings-shell';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
