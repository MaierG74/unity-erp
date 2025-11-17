'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Loader2,
  Package,
  PackageMinus,
  RotateCcw,
  Settings,
  ShoppingCart,
  FileText,
  ArrowRightLeft
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import Link from 'next/link';

type TransactionType = {
  transaction_type_id: number;
  type_name: string;
};

type PurchaseOrder = {
  purchase_order_id: number;
  q_number: string;
};

type Order = {
  order_id: number;
  order_number: string;
};

type User = {
  id: string;
  username: string;
};

type InventoryTransaction = {
  transaction_id: number;
  quantity: number;
  transaction_date: string;
  order_id: number | null;
  purchase_order_id: number | null;
  user_id: string | null;
  reason: string | null;
  transaction_type: TransactionType | null;
  purchase_order: PurchaseOrder | null;
  order: Order | null;
  user: User | null;
  balance?: number; // Running balance after this transaction
};

type TransactionsTabProps = {
  componentId: number;
};

// Helper function to get the actual transaction label based on context
function getTransactionLabel(transaction: InventoryTransaction): string {
  const typeName = transaction.transaction_type?.type_name || 'Unknown';
  const quantity = transaction.quantity || 0;

  // For negative quantities (stock leaving)
  if (quantity < 0) {
    // Return to supplier: has purchase_order_id and usually has a reason
    if (transaction.purchase_order_id) {
      return 'RETURN';
    }
    // Issued to production order: has order_id
    if (transaction.order_id) {
      return 'ISSUE';
    }
    // Fallback to original type
    return typeName;
  }

  // For positive quantities, use the original type
  return typeName;
}

// Helper function to get transaction type styling
function getTransactionTypeStyle(typeName: string) {
  switch (typeName.toUpperCase()) {
    case 'PURCHASE':
    case 'IN':
      return {
        icon: Package,
        badgeClass: 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200',
        iconClass: 'text-green-600'
      };
    case 'ISSUE':
      return {
        icon: PackageMinus,
        badgeClass: 'bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200',
        iconClass: 'text-purple-600'
      };
    case 'RETURN':
      return {
        icon: RotateCcw,
        badgeClass: 'bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-200',
        iconClass: 'text-orange-600'
      };
    case 'SALE':
    case 'OUT':
      return {
        icon: PackageMinus,
        badgeClass: 'bg-red-100 text-red-800 hover:bg-red-200 border-red-200',
        iconClass: 'text-red-600'
      };
    case 'ADJUSTMENT':
      return {
        icon: Settings,
        badgeClass: 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200',
        iconClass: 'text-blue-600'
      };
    default:
      return {
        icon: FileText,
        badgeClass: 'bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200',
        iconClass: 'text-gray-600'
      };
  }
}

export function TransactionsTab({ componentId }: TransactionsTabProps) {
  // Fetch current inventory quantity
  const { data: inventoryData } = useQuery({
    queryKey: ['component', componentId, 'inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('quantity_on_hand')
        .eq('component_id', componentId)
        .single();

      if (error) throw error;
      return data;
    },
  });

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['component', componentId, 'transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select(`
          transaction_id,
          quantity,
          transaction_date,
          order_id,
          purchase_order_id,
          user_id,
          reason,
          transaction_type:transaction_types (
            transaction_type_id,
            type_name
          ),
          purchase_order:purchase_orders (
            purchase_order_id,
            q_number
          ),
          order:orders (
            order_id,
            order_number
          )
        `)
        .eq('component_id', componentId)
        .order('transaction_date', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
  });

  // Calculate running balance for each transaction
  const transactionsWithBalance: InventoryTransaction[] = transactions.reduce((acc, transaction, index) => {
    let balance: number;
    if (index === 0) {
      // Most recent transaction - start with current quantity
      balance = inventoryData?.quantity_on_hand ?? 0;
    } else {
      // Work backwards: previous balance - previous quantity change
      const previousTransaction = acc[index - 1];
      balance = (previousTransaction.balance ?? 0) - (transactions[index - 1].quantity || 0);
    }
    acc.push({ ...transaction, balance });
    return acc;
  }, [] as InventoryTransaction[]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (transactionsWithBalance.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground py-8">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No transactions recorded for this component.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate statistics
  const additions = transactionsWithBalance.filter((t) => (t.quantity || 0) > 0);
  const deductions = transactionsWithBalance.filter((t) => (t.quantity || 0) < 0);
  const issues = transactionsWithBalance.filter((t) => (t.quantity || 0) < 0 && t.order_id);
  const returns = transactionsWithBalance.filter((t) => (t.quantity || 0) < 0 && t.purchase_order_id);

  const totalAdded = additions.reduce((sum, t) => sum + (t.quantity || 0), 0);
  const totalDeducted = Math.abs(
    deductions.reduce((sum, t) => sum + (t.quantity || 0), 0)
  );
  const totalIssued = Math.abs(issues.reduce((sum, t) => sum + (t.quantity || 0), 0));
  const totalReturned = Math.abs(returns.reduce((sum, t) => sum + (t.quantity || 0), 0));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{transactionsWithBalance.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Transactions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Purchased</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalAdded}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {additions.length} transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Issued</CardTitle>
            <PackageMinus className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{totalIssued}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {issues.length} to production
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Returned</CardTitle>
            <RotateCcw className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{totalReturned}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {returns.length} to supplier
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Change</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalAdded - totalDeducted >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalAdded - totalDeducted >= 0 ? '+' : ''}{totalAdded - totalDeducted}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Overall change
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Order Reference</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactionsWithBalance.map((transaction: InventoryTransaction) => {
                const quantity = transaction.quantity || 0;
                const isAddition = quantity > 0;
                const displayLabel = getTransactionLabel(transaction);
                const typeStyle = getTransactionTypeStyle(displayLabel);
                const TypeIcon = typeStyle.icon;

                return (
                  <TableRow key={transaction.transaction_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {format(
                            new Date(transaction.transaction_date),
                            'MMM dd, yyyy HH:mm'
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={typeStyle.badgeClass}>
                        <TypeIcon className={`h-3 w-3 mr-1 ${typeStyle.iconClass}`} />
                        {displayLabel}
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
                    <TableCell className="text-right">
                      <span className="font-medium">
                        {transaction.balance ?? 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      {transaction.order_id ? (
                        <Link href={`/orders/${transaction.order_id}`} target="_blank" rel="noopener noreferrer">
                          <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                            <FileText className="h-3 w-3 mr-1" />
                            Order {transaction.order?.order_number || `#${transaction.order_id}`}
                          </Badge>
                        </Link>
                      ) : transaction.purchase_order_id ? (
                        <Link href={`/purchasing/purchase-orders/${transaction.purchase_order_id}`} target="_blank" rel="noopener noreferrer">
                          <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                            <ShoppingCart className="h-3 w-3 mr-1" />
                            PO {transaction.purchase_order?.q_number || `#${transaction.purchase_order_id}`}
                          </Badge>
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {transaction.user_id ? transaction.user_id.substring(0, 8) + '...' : '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {transaction.reason ? (
                        <span className="text-sm text-muted-foreground italic">
                          {transaction.reason}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {transactionsWithBalance.length >= 100 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing most recent 100 transactions
        </p>
      )}
    </div>
  );
}






