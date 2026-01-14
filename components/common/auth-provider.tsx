'use client';

import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { usePathname, useRouter } from 'next/navigation';

type AuthContextType = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
});

export const useAuth = () => {
  return useContext(AuthContext);
};

// Route groups (in parentheses) are ignored in the URL, so we use the actual URL paths
// Public routes should be accessible without auth. Note: '/staff' is a protected area and should NOT be here.
const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/bypass', '/bypass/orders', '/'];

// Public routes with dynamic segments (patterns) - accessible without auth
const publicPatternRoutes = ['/supplier-response/[token]'];

// Development bypass routes - these routes will be accessible without authentication in development mode
const devBypassRoutes = ['/orders', '/orders/new', '/orders/[orderId]', '/quotes', '/quotes/[id]'];

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

// Check if Supabase is configured on the client (NEXT_PUBLIC_* are inlined at build)
const hasSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirected = useRef(false);
  // Gate redirects until an initial session verdict is known (or timeout)
  const initialSessionResolved = useRef(false);
  // Keep a cross-tab-synced reference to the intended return path
  const returnToRef = useRef<string | null>(typeof window !== 'undefined' ? localStorage.getItem('returnTo') : null);
  const { toast } = useToast();

  useEffect(() => {
    console.log('AuthProvider mounting, current pathname:', pathname);
    
    // If we're on a dev bypass route, skip auth initialization entirely
    const isDevBypassRoute = isDevelopment && devBypassRoutes.some(route => {
      const routePattern = route.replace(/\[.*?\]/g, '[^/]+');
      return new RegExp(`^${routePattern}$`).test(pathname);
    });
    if (isDevBypassRoute) {
      console.warn('Dev bypass route detected; skipping auth initialization for', pathname);
      setLoading(false);
      return;
    }
    
    // If Supabase is not configured, skip auth initialization gracefully
    if (!hasSupabaseEnv) {
      console.warn('Supabase env not configured; skipping auth initialization');
      setLoading(false);
      return;
    }

    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      // Get initial session
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          console.log('Auth session loaded:', session ? 'User authenticated' : 'No user session');
          setUser(session?.user ?? null);
          setLoading(false);
          initialSessionResolved.current = true;
        })
        .catch(err => {
          console.error('Auth session error:', err);
          setLoading(false);
          initialSessionResolved.current = true;
        });

      // Set a timeout to prevent endless loading
      timeoutId = setTimeout(() => {
        console.log('Auth loading timeout reached');
        setLoading(false);
        initialSessionResolved.current = true;
      }, 5000);

      // Listen for auth changes
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        console.log('Auth state changed:', _event, session ? 'User authenticated' : 'No user session');
        setUser(session?.user ?? null);
        setLoading(false);
        initialSessionResolved.current = true;
      });
      subscription = data.subscription;
    } catch (err) {
      console.error('Auth initialization error:', err);
      setLoading(false);
      initialSessionResolved.current = true;
    }

    return () => {
      try {
        subscription?.unsubscribe?.();
      } catch {}
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // Track online/offline to avoid redirecting during transient offline states
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Show small toasts when going offline/online to explain redirect behavior
  useEffect(() => {
    if (isOnline === false) {
      toast({ title: 'Offline', description: 'Redirects are paused until your connection is restored.', duration: 4000 });
    } else if (isOnline === true) {
      toast({ title: 'Back online', description: 'Resuming normal navigation and redirects.', duration: 2500 });
    }
  }, [isOnline, toast]);

  // Keep returnToRef in sync across tabs via storage events
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'returnTo') {
        returnToRef.current = e.newValue;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    console.log('Auth state effect triggered:', {
      loading,
      user: user ? 'User authenticated' : 'No user',
      pathname,
      hasRedirected: hasRedirected.current
    });

    if (loading) return;
    // Do not redirect until we have a verdict from the initial session (or timeout)
    if (!initialSessionResolved.current) return;
    // If offline, suppress redirects; let the page render with last known state
    if (!isOnline) return;
    if (hasRedirected.current) return;

    const isDevBypassRoute = isDevelopment && devBypassRoutes.some(route => {
      const routePattern = route.replace(/\[.*?\]/g, '[^/]+');
      return new RegExp(`^${routePattern}$`).test(pathname);
    });
    const isPublicRoute = publicRoutes.includes(pathname) || publicPatternRoutes.some(route => {
      const routePattern = route.replace(/\[.*?\]/g, '[^/]+');
      return new RegExp(`^${routePattern}$`).test(pathname);
    });

    // Determine if we should send an authenticated user to dashboard
    const shouldRedirectAuthedToDashboard = user && (pathname === '/' || pathname === '/login' || pathname === '/forgot-password' || pathname === '/reset-password');

    if (!user && !isPublicRoute && !isDevBypassRoute) {
      hasRedirected.current = true;
      console.log('Redirecting to login from', pathname);
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('returnTo', pathname);
          returnToRef.current = pathname;
        }
      } catch {}
      router.push('/login');
    } else if (shouldRedirectAuthedToDashboard) {
      hasRedirected.current = true;
      console.log('Redirecting to dashboard from', pathname);
      // If we have a stored returnTo path, prefer that over dashboard
      try {
        const returnTo = returnToRef.current || (typeof window !== 'undefined' ? localStorage.getItem('returnTo') : null);
        if (returnTo && !publicRoutes.includes(returnTo)) {
          localStorage.removeItem('returnTo');
          returnToRef.current = null;
          router.replace(returnTo);
          return;
        }
      } catch {}
      router.push('/dashboard');
    }
  }, [user, loading, pathname, router, isOnline]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
} 