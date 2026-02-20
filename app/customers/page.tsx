'use client';

/**
 * Customers Page
 *
 * Features:
 * - PageToolbar with search, "Show inactive" filter, and actions
 * - Open Orders indicator column with clickable badge → modal
 * - URL-based filter persistence (q, showInactive)
 */

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, ShoppingCart } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { CustomerOpenOrdersModal } from '@/components/features/customers/customer-open-orders-modal';

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching customers:', error);
    throw new Error('Failed to fetch customers');
  }

  return data || [];
}

async function fetchOpenOrderCounts(): Promise<Record<number, number>> {
  // Count orders per customer where status is not Completed (30) or Cancelled (31).
  // Use .or() to also include orders with NULL status_id (NULL NOT IN fails in SQL).
  const { data, error } = await supabase
    .from('orders')
    .select('customer_id, status_id')
    .or('status_id.is.null,status_id.not.in.(30,31)');

  if (error) {
    console.error('Error fetching open order counts:', error);
    return {};
  }

  const counts: Record<number, number> = {};
  (data || []).forEach((order: any) => {
    if (order.customer_id) {
      counts[order.customer_id] = (counts[order.customer_id] || 0) + 1;
    }
  });
  return counts;
}

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize state from URL params
  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('q') || '');
  const [showInactive, setShowInactive] = useState(() => {
    const param = searchParams?.get('showInactive');
    return param === '1' || param === 'true';
  });
  const [openOrdersCustomer, setOpenOrdersCustomer] = useState<Customer | null>(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Re-read URL params on back navigation
  const searchParamsString = searchParams?.toString() || '';
  useEffect(() => {
    const urlQuery = searchParams?.get('q') || '';
    const urlShowInactive = searchParams?.get('showInactive');
    const urlShowInactiveBool = urlShowInactive === '1' || urlShowInactive === 'true';

    if (urlQuery !== searchQuery) setSearchQuery(urlQuery);
    if (urlShowInactiveBool !== showInactive) setShowInactive(urlShowInactiveBool);
  }, [searchParamsString]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter state to URL
  useEffect(() => {
    const currentUrlQuery = searchParams?.get('q') || '';
    const currentUrlShowInactive = searchParams?.get('showInactive');
    const currentUrlShowInactiveBool = currentUrlShowInactive === '1' || currentUrlShowInactive === 'true';

    if (
      debouncedSearchQuery === currentUrlQuery &&
      showInactive === currentUrlShowInactiveBool
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() || '');

    if (debouncedSearchQuery) {
      params.set('q', debouncedSearchQuery);
    } else {
      params.delete('q');
    }

    if (showInactive) {
      params.set('showInactive', '1');
    } else {
      params.delete('showInactive');
    }

    const query = params.toString();
    const url = query ? `/customers?${query}` : '/customers';
    router.replace(url, { scroll: false });
  }, [debouncedSearchQuery, showInactive, router, searchParams]);

  const { data: customers = [], isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
  });

  const { data: openOrderCounts = {} } = useQuery({
    queryKey: ['customer-open-order-counts'],
    queryFn: fetchOpenOrderCounts,
  });

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const matchesSearch =
        !searchQuery ||
        customer.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.contact?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.telephone?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesActive = showInactive ? true : (customer as any).is_active !== false;

      return matchesSearch && matchesActive;
    });
  }, [customers, searchQuery, showInactive]);

  return (
    <div className="space-y-2">
      <PageToolbar
        title="Customers"
        searchPlaceholder="Search customers..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        actions={[
          {
            label: 'Add Customer',
            onClick: () => router.push('/customers/new'),
            icon: <Plus className="h-4 w-4" />,
          },
        ]}
      >
        <label htmlFor="filter-inactive" className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
          <Checkbox
            id="filter-inactive"
            checked={showInactive}
            onCheckedChange={(v) => setShowInactive(Boolean(v))}
          />
          <span>Show inactive</span>
        </label>
      </PageToolbar>

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <span className="text-muted-foreground animate-pulse text-lg">Loading...</span>
        </div>
      ) : error ? (
        <div className="flex justify-center items-center py-12">
          <span className="text-destructive text-lg">Error loading customers.</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="min-w-full divide-y divide-border bg-background dark:bg-card">
            <thead className="bg-muted dark:bg-muted/20">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Name
                </th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider w-32">
                  Open Orders
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Contact
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Email
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Telephone
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-base text-muted-foreground">
                    {searchQuery ? 'No customers found matching your search.' : 'No customers found. Add your first customer!'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const orderCount = openOrderCounts[customer.id] || 0;
                  return (
                    <tr
                      key={customer.id}
                      className="hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors cursor-pointer group"
                      onClick={() => router.push(`/customers/${customer.id}`)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                        {customer.name || 'N/A'}
                        {(customer as any).is_active === false && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {orderCount > 0 ? (
                          <button
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold hover:bg-primary/20 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenOrdersCustomer(customer);
                            }}
                            title={`${orderCount} open order${orderCount > 1 ? 's' : ''}`}
                          >
                            <ShoppingCart className="h-3 w-3" />
                            {orderCount}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">&mdash;</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                        {customer.contact || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                        {customer.email || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                        {customer.telephone || 'N/A'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {openOrdersCustomer && (
        <CustomerOpenOrdersModal
          customerId={openOrdersCustomer.id}
          customerName={openOrdersCustomer.name || 'Unknown'}
          open={!!openOrdersCustomer}
          onClose={() => setOpenOrdersCustomer(null)}
        />
      )}
    </div>
  );
}
