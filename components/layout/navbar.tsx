'use client';

import { useAuth } from '../auth-provider';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '../theme-toggle';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from './sidebar';
import { useEffect, useState } from 'react';

export function Navbar() {
  const { user } = useAuth();
  const { collapsed, setCollapsed } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);

  // Check if the screen is mobile size
  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    // Initial check
    checkIfMobile();
    
    // Add event listener for window resize
    window.addEventListener('resize', checkIfMobile);
    
    // Cleanup
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  return (
    <div className="h-16 flex-shrink-0 border-b bg-background/95 supports-[backdrop-filter]:bg-background/60 backdrop-blur-md sticky top-0 z-30">
      <div className="flex h-full items-center justify-between px-4">
        <div className="flex items-center">
          {isMobile && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="mr-2 lg:hidden"
              onClick={() => setCollapsed(!collapsed)}
              aria-label="Toggle sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <span className="text-xl font-bold md:hidden">Unity ERP</span>
        </div>

        <div className="flex items-center space-x-4">
          <ThemeToggle />
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground hidden md:inline">
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
    </div>
  );
} 