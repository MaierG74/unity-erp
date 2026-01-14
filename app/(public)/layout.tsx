import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Unity ERP',
  description: 'Order status update',
};

// This is a PUBLIC layout - no auth, no sidebar, minimal wrapper
// Note: The root layout already provides <html> and <body> tags
// The RootLayout component checks for standalone routes and bypasses app chrome
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
