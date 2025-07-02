'use client';

import { createContext, useContext, useEffect, useState, useRef } from 'react';
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
const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/bypass', '/bypass/orders', '/', '/staff'];

// Development bypass routes - these routes will be accessible without authentication in development mode
const devBypassRoutes = ['/orders', '/orders/new', '/orders/[orderId]'];

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirected = useRef(false);

  useEffect(() => {
    console.log('AuthProvider mounting, current pathname:', pathname);
    
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Auth session loaded:', session ? 'User authenticated' : 'No user session');
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch(err => {
      console.error('Auth session error:', err);
      setLoading(false);
    });

    // Set a timeout to prevent endless loading
    const timeoutId = setTimeout(() => {
      console.log('Auth loading timeout reached');
      setLoading(false);
    }, 5000);

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('Auth state changed:', _event, session ? 'User authenticated' : 'No user session');
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    console.log('Auth state effect triggered:', {
      loading,
      user: user ? 'User authenticated' : 'No user',
      pathname,
      hasRedirected: hasRedirected.current
    });

    if (loading) return;
    if (hasRedirected.current) return;

    const isDevBypassRoute = isDevelopment && devBypassRoutes.some(route => {
      const routePattern = route.replace(/\[.*?\]/g, '[^/]+');
      return new RegExp(`^${routePattern}$`).test(pathname);
    });
    const isPublicRoute = publicRoutes.includes(pathname) || pathname.startsWith('/staff');

    if (!user && !isPublicRoute && !isDevBypassRoute) {
      hasRedirected.current = true;
      console.log('Redirecting to login from', pathname);
      router.push('/login');
    } else if (user && isPublicRoute) {
      hasRedirected.current = true;
      console.log('Redirecting to dashboard from', pathname);
      router.push('/dashboard');
    }
  }, [user, loading, pathname, router]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
} 