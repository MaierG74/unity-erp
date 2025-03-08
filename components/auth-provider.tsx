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
const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/bypass'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirected = useRef(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch(err => {
      console.error('Auth session error:', err);
      setLoading(false);
    });

    // Set a timeout to prevent endless loading
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000);

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    
    // Prevent redirect loops by only redirecting once per component mount
    if (hasRedirected.current) return;

    // Route groups are stripped from the URL, so we use the actual paths
    if (!user && !publicRoutes.includes(pathname)) {
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