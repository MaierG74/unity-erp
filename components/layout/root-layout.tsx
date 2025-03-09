'use client';

import { useAuth } from '../auth-provider';
import { Navbar } from './navbar';
import { Sidebar } from './sidebar';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function RootLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [forceShowSidebar, setForceShowSidebar] = useState(false);
  
  // Check for authentication and set force sidebar if needed
  useEffect(() => {
    // Log authentication state for debugging
    console.log('Authentication state:', { user, loading });
    
    // If there's no user after loading is complete, check auth directly
    if (!loading && !user) {
      checkDirectAuth();
    }
  }, [user, loading]);
  
  // Direct auth check as a backup
  const checkDirectAuth = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        console.log('Direct auth check found session:', data.session);
        setForceShowSidebar(true);
      } else {
        // Use localStorage as a last resort (for development/debugging)
        const debugMode = localStorage.getItem('debug-show-sidebar') === 'true';
        if (debugMode) {
          console.log('Debug mode enabled - showing sidebar');
          setForceShowSidebar(true);
        }
      }
    } catch (err) {
      console.error('Error checking direct auth:', err);
    }
  };

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

  // Show sidebar if user is authenticated OR if force sidebar is set
  const shouldShowSidebar = !!user || forceShowSidebar;

  return (
    <div className="min-h-screen">
      <Navbar />
      {shouldShowSidebar && <Sidebar />}
      <main className={`pt-16 ${shouldShowSidebar ? 'pl-64' : ''}`}>
        <div className="container py-8">
          {children}
        </div>
      </main>
    </div>
  );
} 