'use client';

/**
 * Customers Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed separate h1, search input, and button rows
 * - All header elements consolidated into single PageToolbar
 * - Reduced vertical spacing for more data visibility
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Plus } from 'lucide-react';

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
  const [searchQuery, setSearchQuery] = useState('');

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
                <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Actions
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
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground">
                      <Link href={`/customers/${customer.id}`} className="hover:underline">
                        {customer.name || 'N/A'}
                      </Link>
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
                    <td className="px-6 py-4 whitespace-nowrap text-right text-base font-medium flex gap-2 justify-end">
                      <Link href={`/customers/${customer.id}`} className="button-primary px-3 py-1 text-xs font-semibold">
                        View
                      </Link>
                      <Link href={`/customers/${customer.id}/edit`} className="button-primary bg-secondary text-secondary-foreground px-3 py-1 text-xs font-semibold">
                        Edit
                      </Link>
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
