'use client';

import { useAuth } from '../auth-provider';
import { Navbar } from './navbar';
import { Sidebar } from './sidebar';

export function RootLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      {user && <Sidebar />}
      <main className={`pt-16 ${user ? 'pl-64' : ''}`}>
        <div className="container py-8">
          {children}
        </div>
      </main>
    </div>
  );
} 