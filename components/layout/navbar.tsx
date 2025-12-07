'use client';

import { useAuth } from '@/components/common/auth-provider';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSidebar } from './sidebar';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';

export function Navbar() {
  const { user } = useAuth();
  const { collapsed, setCollapsed } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const compactOn = searchParams?.get('compact') !== '0';
  const isLaborPlanning = pathname?.startsWith('/labor-planning');

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
      <div className="flex h-full items-center gap-4 px-4">
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

        <div className="flex flex-1 items-center justify-center">
          {isLaborPlanning && (
            <div className="flex flex-col items-start gap-1 text-left">
              <span className="text-base font-semibold leading-none sm:text-lg">Labor Planning Board</span>
              <span className="text-[12px] text-muted-foreground">
                Drag jobs into swimlanes; compact view trims labels and grid clutter.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {isLaborPlanning && (
            <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
              <span className="hidden text-muted-foreground sm:inline">Compact lanes</span>
              <button
                aria-label="Toggle compact lanes"
                className="relative inline-flex h-6 w-11 items-center rounded-full bg-muted transition data-[state=on]:bg-primary"
                data-state={compactOn ? 'on' : 'off'}
                onClick={() => {
                  const params = new URLSearchParams(searchParams?.toString() ?? '');
                  if (compactOn) params.set('compact', '0');
                  else params.set('compact', '1');
                  router.replace(`${pathname}?${params.toString()}`);
                }}
              >
                <span className="absolute left-1 h-4 w-4 rounded-full bg-background shadow transition-transform data-[state=on]:translate-x-5" />
              </button>
            </div>
          )}
          {isLaborPlanning && (
            <>
              <Badge variant="outline" className="bg-primary/10 text-primary hidden sm:inline">
                Prototype surface
              </Badge>
              <Badge variant="secondary" className="hidden sm:inline">
                7:00 AM – 7:00 PM
              </Badge>
            </>
          )}
          <ThemeToggle />
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground hidden md:inline">
                {user.email}
              </span>
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  router.push('/login');
                }}
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
