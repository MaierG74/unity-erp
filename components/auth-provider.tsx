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
const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/bypass', '/bypass/orders', '/'];

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
    
    // Prevent redirect loops by only redirecting once per component mount
    if (hasRedirected.current) return;

    // Check if the current path is in the development bypass routes
    const isDevBypassRoute = isDevelopment && devBypassRoutes.some(route => {
      // Handle dynamic routes by replacing [param] with a regex pattern
      const routePattern = route.replace(/\[.*?\]/g, '[^/]+');
      const regex = new RegExp(`^${routePattern}$`);
      return regex.test(pathname);
    });
    
    console.log('Redirect check:', { 
      isPublicRoute: publicRoutes.includes(pathname),
      isDevBypassRoute,
      shouldRedirectToLogin: !user && !publicRoutes.includes(pathname) && !isDevBypassRoute,
      shouldRedirectToDashboard: user && publicRoutes.includes(pathname)
    });

    // Route groups are stripped from the URL, so we use the actual paths
    if (!user && !publicRoutes.includes(pathname) && !isDevBypassRoute) {
      hasRedirected.current = true;
      console.log('Redirecting to login from', pathname);
      router.push('/login');
    } else if (user && publicRoutes.includes(pathname)) {
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