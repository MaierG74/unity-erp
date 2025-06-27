"use client";
import React from 'react';
import { ThemeProvider } from '@/components/theme-provider';

export function ThemeClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="unity-theme"
    >
      {children}
    </ThemeProvider>
  );
}
