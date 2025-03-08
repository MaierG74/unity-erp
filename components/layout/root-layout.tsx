'use client';

import { useAuth } from '../auth-provider';
import { Navbar } from './navbar';
import { Sidebar } from './sidebar';

export function RootLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <div className="text-lg mb-4">Loading...</div>
        <div className="text-sm text-gray-500 max-w-md text-center">
          If you're stuck on this screen, try:
          <ol className="list-decimal list-inside mt-2 text-left">
            <li className="mb-1">Clearing browser cookies for this domain</li>
            <li className="mb-1">Clearing localStorage by visiting <a href="/api/debug" className="text-blue-500 underline">Debug API</a></li>
            <li className="mb-1">Using a private/incognito window</li>
          </ol>
        </div>
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