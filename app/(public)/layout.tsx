import { Metadata } from 'next';
import '../globals.css';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Unity ERP',
  description: 'Order status update',
};

// This is a PUBLIC layout - no auth, no sidebar, minimal wrapper
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={cn('antialiased min-h-screen bg-gray-100', inter.className)}>
        {children}
      </body>
    </html>
  );
}
