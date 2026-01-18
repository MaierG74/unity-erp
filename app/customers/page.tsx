'use client';

/**
 * Customers Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed separate h1, search input, and button rows
 * - All header elements consolidated into single PageToolbar
 * - Reduced vertical spacing for more data visibility
 * - URL-based filter persistence for navigating back from detail pages
 */

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Plus } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

// Function to fetch customers from Supabase
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

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize search from URL params
  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('q') || '');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Sync search to URL (re-read when URL changes, e.g., on back navigation)
  const searchParamsString = searchParams?.toString() || '';
  useEffect(() => {
    const urlQuery = searchParams?.get('q') || '';
    if (urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
    }
  }, [searchParamsString]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when debounced search changes
  useEffect(() => {
    const currentUrlQuery = searchParams?.get('q') || '';

    // Only update URL if debounced value differs from current URL
    if (debouncedSearchQuery === currentUrlQuery) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() || '');

    if (debouncedSearchQuery) {
      params.set('q', debouncedSearchQuery);
    } else {
      params.delete('q');
    }

    const query = params.toString();
    const url = query ? `/customers?${query}` : '/customers';
    router.replace(url, { scroll: false });
  }, [debouncedSearchQuery, router, searchParams]);

  // Use React Query to fetch customers
  const { data: customers = [], isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
  });

  // Filter customers based on search query
  const filteredCustomers = customers.filter(customer =>
    customer.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.contact?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.telephone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    // CHANGED: Reduced space-y from 8 to 2, removed card wrapper classes
    <div className="space-y-2">
      {/* NEW: PageToolbar replaces separate h1, search, and button rows */}
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
      />

      {/* CHANGED: Removed mt-8, table now sits directly below toolbar */}
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
                  <td colSpan={4} className="px-6 py-8 text-center text-base text-muted-foreground">
                    {searchQuery ? 'No customers found matching your search.' : 'No customers found. Add your first customer!'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors cursor-pointer group"
                    onClick={() => router.push(`/customers/${customer.id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      {customer.name || 'N/A'}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
