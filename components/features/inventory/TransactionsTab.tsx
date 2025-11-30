'use client';

import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Search, X, Calendar } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Transaction = {
  transaction_id: number;
  component_id: number;
  quantity: number;
  transaction_date: string;
  order_id: number | null;
  component: {
    internal_code: string;
    description: string | null;
  };
  transaction_type: {
    transaction_type_id: number;
    type_name: string;
  } | null;
};

export function TransactionsTab() {
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch all transactions
  const { data: transactions = [], isLoading, error } = useQuery({
    queryKey: ['inventory', 'transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select(`
          transaction_id,
          component_id,
          quantity,
          transaction_date,
          order_id,
          component:components (
            internal_code,
            description
          ),
          transaction_type:transaction_types (
            transaction_type_id,
            type_name
          )
        `)
        .order('transaction_date', { ascending: false })
        .limit(500); // Limit to recent 500 transactions

      if (error) {
        console.error('Error fetching transactions:', error);
        throw error;
      }

      return data as Transaction[];
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Get unique transaction types for filter
  const transactionTypes = useMemo(() => {
    const types = new Set<string>();
    transactions.forEach((t) => {
      if (t.transaction_type?.type_name) {
        types.add(t.transaction_type.type_name);
      }
    });
    return Array.from(types).sort();
  }, [transactions]);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const matchesSearch =
        !searchText ||
        transaction.component.internal_code
          .toLowerCase()
          .includes(searchText.toLowerCase()) ||
        transaction.component.description
          ?.toLowerCase()
          .includes(searchText.toLowerCase());

      const matchesType =
        typeFilter === 'all' ||
        transaction.transaction_type?.type_name === typeFilter;

      return matchesSearch && matchesType;
    });
  }, [transactions, searchText, typeFilter]);

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions'] });
    toast({
      title: 'Data refreshed',
      description: 'Transaction history has been refreshed.',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg">Loading transactions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-destructive">Error loading transactions: {(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Transaction History</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Recent inventory transactions across all components
          </p>
        </div>
        <Button onClick={refreshData} className="h-9" variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by component code or description..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 pr-10"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Type Filter */}
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Transaction type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {transactionTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Total Transactions</p>
          <p className="text-2xl font-bold mt-2">{filteredTransactions.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Stock Additions</p>
          <p className="text-2xl font-bold mt-2 text-green-600">
            {filteredTransactions.filter((t) => (t.quantity || 0) > 0).length}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Stock Deductions</p>
          <p className="text-2xl font-bold mt-2 text-red-600">
            {filteredTransactions.filter((t) => (t.quantity || 0) < 0).length}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Component Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>Order Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {searchText || typeFilter !== 'all'
                    ? 'No transactions found matching your filters.'
                    : 'No transactions recorded yet.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map((transaction) => {
                const quantity = transaction.quantity || 0;
                const isAddition = quantity > 0;

                return (
                  <TableRow key={transaction.transaction_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {format(new Date(transaction.transaction_date), 'MMM dd, yyyy HH:mm')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {transaction.component.internal_code}
                    </TableCell>
                    <TableCell>{transaction.component.description || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {transaction.transaction_type?.type_name || 'Unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          isAddition
                            ? 'text-green-600 font-semibold'
                            : 'text-red-600 font-semibold'
                        }
                      >
                        {isAddition ? '+' : ''}
                        {quantity}
                      </span>
                    </TableCell>
                    <TableCell>
                      {transaction.order_id ? (
                        <Badge variant="secondary">Order #{transaction.order_id}</Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {filteredTransactions.length === 500 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing most recent 500 transactions
        </p>
      )}
    </div>
  );
}

