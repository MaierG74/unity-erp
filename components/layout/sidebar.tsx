'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Truck,
  Package,
  ShoppingCart,
  Users,
  BarChart,
  Settings,
  ShoppingBag,
  UserCog,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Box,
  Hammer,
  CalendarClock,
  FileText,
  CheckSquare,
  Ruler,
  Layers,
  LayoutGrid,
  Clock,
} from 'lucide-react';
import { useState, useEffect, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const navigation = [
  { 
    name: 'Dashboard', 
    href: '/dashboard',
    icon: LayoutDashboard 
  },
  { 
    name: 'Suppliers', 
    href: '/suppliers',
    icon: Truck 
  },
  { 
    name: 'Products', 
    href: '/products',
    icon: Box 
  },
  { 
    name: 'Collections', 
    href: '/collections',
    icon: LayoutGrid 
  },
  { 
    name: 'Inventory', 
    href: '/inventory',
    icon: Package 
  },
  {
    name: 'Labor',
    href: '/labor',
    icon: Hammer
  },
  {
    name: 'Scheduling',
    href: '/labor-planning',
    icon: CalendarClock
  },
  {
    name: 'Purchasing', 
    href: '/purchasing',
    icon: ShoppingBag 
  },
  { 
    name: 'Orders', 
    href: '/orders',
    icon: ShoppingCart 
  },
  { 
    name: 'Quotes', 
    href: '/quotes',
    icon: FileText 
  },
  { 
    name: 'Cutlist',
    href: '/cutlist',
    icon: Ruler,
  },
  { 
    name: 'To-Dos',
    href: '/todos',
    icon: CheckSquare
  },
  { 
    name: 'Customers', 
    href: '/customers',
    icon: Users 
  },
  { 
    name: 'Staff', 
    href: '/staff',
    icon: UserCog 
  },
  { 
    name: 'Reports', 
    href: '/reports',
    icon: BarChart 
  },
  {
    name: 'Option Sets',
    href: '/settings/option-sets',
    icon: Layers
  },
  {
    name: 'Work Schedules',
    href: '/settings/work-schedules',
    icon: Clock
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings
  },
];

// Create a context to share the collapsed state with the layout
export const SidebarContext = createContext({
  collapsed: false,
  setCollapsed: (collapsed: boolean) => {},
});

export const useSidebar = () => useContext(SidebarContext);

// Global state for sidebar collapsed state
let globalCollapsed = false;
const globalSetCollapsed = (value: boolean) => {
  globalCollapsed = value;
  // Store in localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('sidebar-collapsed', value.toString());
  }
};

// Initialize from localStorage if available
if (typeof window !== 'undefined') {
  const storedValue = localStorage.getItem('sidebar-collapsed');
  if (storedValue !== null) {
    globalCollapsed = storedValue === 'true';
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(globalCollapsed);
  const [isMobile, setIsMobile] = useState(false);
  
  // Store collapsed state in localStorage to persist between page refreshes
  useEffect(() => {
    const storedCollapsed = localStorage.getItem('sidebar-collapsed');
    if (storedCollapsed !== null) {
      setCollapsed(storedCollapsed === 'true');
    } else if (pathname?.startsWith('/labor-planning')) {
      // Start the planning view with more canvas space by default.
      setCollapsed(true);
      globalSetCollapsed(true);
    }
    
    // Check if the screen is mobile size
    const checkIfMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      
      // Auto-collapse on mobile
      if (mobile && !collapsed) {
        setCollapsed(true);
      }
    };
    
    // Initial check
    checkIfMobile();
    
    // Add event listener for window resize
    window.addEventListener('resize', checkIfMobile);
    
    // Cleanup
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);
  
  // Update localStorage and global state when collapsed state changes
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed.toString());
    globalCollapsed = collapsed;

    // Dispatch an event to notify other components about sidebar state change
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sidebar-state-change', { 
        detail: { collapsed } 
      }));
    }
  }, [collapsed]);

  // Create a wrapper for setCollapsed that also updates the global state
  const handleSetCollapsed = (value: boolean) => {
    setCollapsed(value);
    globalSetCollapsed(value);
  };

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed: handleSetCollapsed }}>
      <aside
        className="h-screen border-r bg-gradient-to-b from-background via-background to-muted/30 z-30 flex flex-shrink-0 flex-col transition-all duration-200 ease-in-out"
        style={{
          width: collapsed ? '64px' : '256px'
        }}
      >
        <div className="flex h-16 items-center px-4 border-b">
          {!collapsed && (
            <Link href="/" className="flex items-center">
              <span className="text-xl font-bold">Unity ERP</span>
            </Link>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => handleSetCollapsed(!collapsed)}
            className={cn("h-8 w-8", collapsed ? "mx-auto" : "ml-auto")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        
        <nav className="flex-1 overflow-y-auto overflow-x-visible py-4">
          <TooltipProvider delayDuration={100} skipDelayDuration={0}>
            <ul className="flex flex-col gap-1 px-2">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                const linkContent = (
                  <Link
                    href={item.href}
                    className={cn(
                      'group relative flex h-10 items-center rounded-xl px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      isActive
                        ? 'bg-gradient-to-r from-primary/90 to-primary text-primary-foreground shadow-lg shadow-primary/30'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:shadow-sm',
                      collapsed ? 'justify-center' : 'justify-start gap-3'
                    )}
                    aria-label={item.name}
                    onClick={() => isMobile && handleSetCollapsed(true)}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
                    {!collapsed && (
                      <span className="truncate font-medium tracking-wide">
                        {item.name}
                      </span>
                    )}
                  </Link>
                );

                return (
                  <li key={item.name}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {linkContent}
                        </TooltipTrigger>
                        <TooltipContent 
                          side="right" 
                          className="px-4 py-2.5 text-sm font-medium"
                          sideOffset={12}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 opacity-70" />
                            <span>{item.name}</span>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      linkContent
                    )}
                  </li>
                );
              })}
            </ul>
          </TooltipProvider>
        </nav>
      </aside>
    </SidebarContext.Provider>
  );
} 
