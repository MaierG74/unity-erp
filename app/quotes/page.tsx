'use client';

import { useState, useEffect } from 'react';

import Link from 'next/link';
import { Quote, fetchQuotes } from '@/lib/db/quotes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';

// Debounce hook to delay value updates
function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const debouncedStatus = useDebounce(statusFilter, 300);
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    fetchQuotes({ status: debouncedStatus, search: debouncedSearch })
      .then(setQuotes)
      .catch(console.error);
  }, [debouncedStatus, debouncedSearch]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Quotes</h1>
        <Link href="/quotes/new">
          <Button>Create Quote</Button>
        </Link>
      </div>

      <div className="flex space-x-2 mb-4">
        <Select onValueChange={setStatusFilter} defaultValue="all">
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search quote #"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quote #</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotes.map(q => (
            <TableRow key={q.id}>
              <TableCell>
                <Link href={`/quotes/${q.id}`} className="text-blue-600 hover:underline">
                  {q.quote_number}
                </Link>
              </TableCell>
              <TableCell>{q.status}</TableCell>
              <TableCell>{new Date(q.created_at).toLocaleDateString()}</TableCell>
              <TableCell>{q.grand_total.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
