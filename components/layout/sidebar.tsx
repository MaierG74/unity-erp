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
} from 'lucide-react';

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
    name: 'Inventory', 
    href: '/inventory',
    icon: Package 
  },
  { 
    name: 'Orders', 
    href: '/orders',
    icon: ShoppingCart 
  },
  { 
    name: 'Customers', 
    href: '/customers',
    icon: Users 
  },
  { 
    name: 'Reports', 
    href: '/reports',
    icon: BarChart 
  },
  { 
    name: 'Settings', 
    href: '/settings',
    icon: Settings 
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r bg-background">
      <div className="space-y-4 py-4">
        <div className="px-3 py-2">
          <div className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'flex items-center rounded-lg px-3 py-2 text-sm font-medium gap-3 transition-colors',
                    pathname === item.href
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
} 