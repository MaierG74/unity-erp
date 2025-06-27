'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';

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
    <div className="space-y-8 card bg-card shadow-lg dark:shadow-none">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Customers</h1>
        <Button asChild className="button-primary flex gap-2 items-center">
          <Link href="/customers/new">
            <PlusIcon className="h-5 w-5" />
            Add Customer
          </Link>
        </Button>
      </div>

      <div className="relative mt-2">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
        <Input
          placeholder="Search customers..."
          className="pl-12 input-field bg-background text-foreground"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <span className="text-muted-foreground animate-pulse text-lg">Loading...</span>
        </div>
      ) : error ? (
        <div className="flex justify-center items-center py-12">
          <span className="text-destructive text-lg">Error loading customers.</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl shadow-lg border border-border bg-card mt-8 dark:shadow-none">
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