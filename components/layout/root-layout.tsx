'use client';

import { useAuth } from '@/components/common/auth-provider';
import { Navbar } from './navbar';
import { Sidebar, useSidebar } from './sidebar';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePathname } from 'next/navigation';

// Standalone public routes - no navbar, no sidebar, no app chrome at all
const standaloneRoutes = ['/supplier-response'];

export function RootLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [forceShowSidebar, setForceShowSidebar] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const hasSupabaseEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Check if this is a standalone public route (render without any app chrome)
  const isStandaloneRoute = standaloneRoutes.some(route => pathname.startsWith(route));

  // Check for authentication and set force sidebar if needed
  useEffect(() => {
    // Skip for standalone routes
    if (isStandaloneRoute) return;

    // Log authentication state for debugging
    console.log('Authentication state:', { user, loading });

    // If there's no user after loading is complete, check auth directly
    if (!loading && !user) {
      checkDirectAuth();
    }

    // Check if the screen is mobile size
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Initial check
    checkIfMobile();

    // Add event listener for window resize
    window.addEventListener('resize', checkIfMobile);

    // Cleanup
    return () => window.removeEventListener('resize', checkIfMobile);
  }, [user, loading, isStandaloneRoute]);

  // Direct auth check as a backup
  const checkDirectAuth = async () => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    try {
      if (hasSupabaseEnv) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          console.log('Direct auth check found session:', data.session);
          setForceShowSidebar(true);
          return;
        }
      }
      // Use localStorage as a last resort (for development/debugging)
      const debugMode = localStorage.getItem('debug-show-sidebar') === 'true';
      if (debugMode) {
        console.log('Debug mode enabled - showing sidebar');
        setForceShowSidebar(true);
      }
    } catch (err) {
      console.error('Error checking direct auth:', err);
    }
  };

  // For standalone routes, render children directly without any layout
  if (isStandaloneRoute) {
    return <>{children}</>;
  }

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

  return shouldShowSidebar ? (
    <div className="flex h-screen w-screen bg-background overflow-hidden">
      <Sidebar />
      <Content>{children}</Content>
    </div>
  ) : (
    <div className="flex h-screen flex-col bg-background">
      <Navbar />
      <main className="flex-1 w-full pt-16 overflow-auto">
        <div className="container mx-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}

// Content component with navbar
function Content({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  
  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden transition-all duration-200 ease-in-out"
      style={{ 
        width: collapsed ? 'calc(100% - 64px)' : 'calc(100% - 256px)'
      }}
    >
      <Navbar />
      <main className="flex-1 overflow-auto pt-14">
        <div className="container mx-auto px-4 md:px-6 py-2">
          {children}
        </div>
      </main>
    </div>
  );
} 