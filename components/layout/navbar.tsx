'use client';

import { useAuth } from '../auth-provider';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '../theme-toggle';

export function Navbar() {
  const { user } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-full items-center justify-between">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold">Unity ERP</span>
        </Link>

        <div className="flex items-center space-x-4">
          <ThemeToggle />
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground">
                {user.email}
              </span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/auth"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
} 