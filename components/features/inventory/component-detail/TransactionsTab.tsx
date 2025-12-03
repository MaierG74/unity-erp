'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
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
  ArrowRightLeft,
  ClipboardCheck,
  Boxes,
  Filter,
  X,
  Search,
  Download,
  CalendarIcon,
  Plus
} from 'lucide-react';
import { StockAdjustmentDialog } from './StockAdjustmentDialog';
import { StockMovementChart } from './StockMovementChart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import Link from 'next/link';
import { cn } from '@/lib/utils';

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
  componentName?: string;
  supplierId?: number; // Optional: preferred supplier for quick PO
  reorderLevel?: number; // Minimum stock level for chart reference line
};

type FilterState = {
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  transactionType: string;
  sourceType: string;
  searchQuery: string;
};

const DATE_PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This year', days: 365 },
];

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

export function TransactionsTab({ componentId, componentName = 'Component', supplierId, reorderLevel = 0 }: TransactionsTabProps) {
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    dateFrom: undefined,
    dateTo: undefined,
    transactionType: 'all',
    sourceType: 'all',
    searchQuery: '',
  });
  
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

  // Fetch user profiles for transactions
  const userIds = useMemo(() => {
    const ids = transactions
      .map(t => t.user_id)
      .filter((id): id is string => id !== null);
    return [...new Set(ids)];
  }, [transactions]);

  const { data: userProfiles = [] } = useQuery({
    queryKey: ['profiles', userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds);
      if (error) throw error;
      return data;
    },
    enabled: userIds.length > 0,
  });

  // Create a map of user_id to username
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    userProfiles.forEach(p => {
      if (p.id && p.username) map.set(p.id, p.username);
    });
    return map;
  }, [userProfiles]);

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

  // Apply filters
  const filteredTransactions = useMemo(() => {
    return transactionsWithBalance.filter((transaction) => {
      // Date range filter
      if (filters.dateFrom || filters.dateTo) {
        const txDate = new Date(transaction.transaction_date);
        if (filters.dateFrom && txDate < startOfDay(filters.dateFrom)) return false;
        if (filters.dateTo && txDate > endOfDay(filters.dateTo)) return false;
      }

      // Transaction type filter
      if (filters.transactionType !== 'all') {
        const label = getTransactionLabel(transaction).toUpperCase();
        if (filters.transactionType === 'in' && !['PURCHASE', 'IN'].includes(label)) return false;
        if (filters.transactionType === 'out' && !['SALE', 'OUT', 'ISSUE'].includes(label)) return false;
        if (filters.transactionType === 'adjust' && label !== 'ADJUSTMENT') return false;
        if (filters.transactionType === 'return' && label !== 'RETURN') return false;
      }

      // Source type filter
      if (filters.sourceType !== 'all') {
        if (filters.sourceType === 'po' && !transaction.purchase_order_id) return false;
        if (filters.sourceType === 'order' && !transaction.order_id) return false;
        if (filters.sourceType === 'adjustment' && (transaction.order_id || transaction.purchase_order_id)) return false;
      }

      // Search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const orderNum = transaction.order?.order_number?.toLowerCase() || '';
        const poNum = transaction.purchase_order?.q_number?.toLowerCase() || '';
        const reason = transaction.reason?.toLowerCase() || '';
        if (!orderNum.includes(query) && !poNum.includes(query) && !reason.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [transactionsWithBalance, filters]);

  // Check if any filters are active
  const hasActiveFilters = filters.dateFrom || filters.dateTo || 
    filters.transactionType !== 'all' || filters.sourceType !== 'all' || 
    filters.searchQuery;

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      dateFrom: undefined,
      dateTo: undefined,
      transactionType: 'all',
      sourceType: 'all',
      searchQuery: '',
    });
  };

  // Apply date preset
  const applyDatePreset = (days: number) => {
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - days);
    setFilters(prev => ({ ...prev, dateFrom: from, dateTo: now }));
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Date', 'Type', 'Quantity', 'Balance', 'Order Reference', 'Reason'];
    const rows = filteredTransactions.map(t => [
      format(new Date(t.transaction_date), 'yyyy-MM-dd HH:mm'),
      getTransactionLabel(t),
      t.quantity,
      t.balance,
      t.order?.order_number || t.purchase_order?.q_number || '',
      t.reason || ''
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${componentName}_transactions_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentStock = inventoryData?.quantity_on_hand ?? 0;

  if (transactionsWithBalance.length === 0) {
    return (
      <div className="space-y-6">
        {/* Current Stock Banner with Action Buttons - shown even with no transactions */}
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                  <Boxes className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Current Stock Balance</p>
                  <p className="text-4xl font-bold text-blue-700 dark:text-blue-300">{currentStock}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  asChild
                  className="gap-2"
                >
                  <Link href={`/purchasing/purchase-orders/new?component=${componentId}`}>
                    <Plus className="h-4 w-4" />
                    Create PO
                  </Link>
                </Button>
                <Button
                  onClick={() => setAdjustmentDialogOpen(true)}
                  className="gap-2"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Stock Adjustment
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground py-8">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No transactions recorded for this component.</p>
              <p className="text-sm mt-2">Use Stock Adjustment to record initial inventory from a stocktake.</p>
            </div>
          </CardContent>
        </Card>

        {/* Stock Adjustment Dialog */}
        <StockAdjustmentDialog
          open={adjustmentDialogOpen}
          onOpenChange={setAdjustmentDialogOpen}
          componentId={componentId}
          componentName={componentName}
          currentStock={currentStock}
        />
      </div>
    );
  }

  // Calculate statistics (from filtered transactions)
  const additions = filteredTransactions.filter((t) => (t.quantity || 0) > 0);
  const deductions = filteredTransactions.filter((t) => (t.quantity || 0) < 0);
  const issues = filteredTransactions.filter((t) => (t.quantity || 0) < 0 && t.order_id);
  const returns = filteredTransactions.filter((t) => (t.quantity || 0) < 0 && t.purchase_order_id);

  const totalAdded = additions.reduce((sum, t) => sum + (t.quantity || 0), 0);
  const totalDeducted = Math.abs(
    deductions.reduce((sum, t) => sum + (t.quantity || 0), 0)
  );
  const totalIssued = Math.abs(issues.reduce((sum, t) => sum + (t.quantity || 0), 0));
  const totalReturned = Math.abs(returns.reduce((sum, t) => sum + (t.quantity || 0), 0));

  return (
    <div className="space-y-6">
      {/* Current Stock Banner with Action Buttons */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                <Boxes className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Current Stock Balance</p>
                <p className="text-4xl font-bold text-blue-700 dark:text-blue-300">{currentStock}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                asChild
                className="gap-2"
              >
                <Link href={`/purchasing/purchase-orders/new?component=${componentId}`}>
                  <Plus className="h-4 w-4" />
                  Create PO
                </Link>
              </Button>
              <Button
                onClick={() => setAdjustmentDialogOpen(true)}
                className="gap-2"
              >
                <ClipboardCheck className="h-4 w-4" />
                Stock Adjustment
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* Stock Movement Chart */}
      <StockMovementChart 
        transactions={transactionsWithBalance} 
        currentStock={currentStock}
        reorderLevel={reorderLevel}
      />

      {/* Transactions Table */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              Transaction History
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-2">
                  {filteredTransactions.length} of {transactionsWithBalance.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                Filters
                {hasActiveFilters && (
                  <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                    !
                  </Badge>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportToCSV}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Filter Transactions</span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1">
                    <X className="h-3 w-3" />
                    Clear all
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Date Range */}
                <div className="space-y-2">
                  <Label className="text-xs">Date Range</Label>
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !filters.dateFrom && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {filters.dateFrom ? format(filters.dateFrom, "MMM dd") : "From"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={filters.dateFrom}
                          onSelect={(date) => setFilters(prev => ({ ...prev, dateFrom: date }))}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !filters.dateTo && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {filters.dateTo ? format(filters.dateTo, "MMM dd") : "To"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={filters.dateTo}
                          onSelect={(date) => setFilters(prev => ({ ...prev, dateTo: date }))}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {DATE_PRESETS.map((preset) => (
                      <Button
                        key={preset.days}
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => applyDatePreset(preset.days)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Transaction Type */}
                <div className="space-y-2">
                  <Label className="text-xs">Transaction Type</Label>
                  <Select
                    value={filters.transactionType}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, transactionType: value }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="in">Purchases (IN)</SelectItem>
                      <SelectItem value="out">Issues (OUT)</SelectItem>
                      <SelectItem value="adjust">Adjustments</SelectItem>
                      <SelectItem value="return">Returns</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Source Type */}
                <div className="space-y-2">
                  <Label className="text-xs">Source</Label>
                  <Select
                    value={filters.sourceType}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, sourceType: value }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="po">Purchase Orders</SelectItem>
                      <SelectItem value="order">Customer Orders</SelectItem>
                      <SelectItem value="adjustment">Manual Adjustments</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Search */}
                <div className="space-y-2">
                  <Label className="text-xs">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Order #, PO #, reason..."
                      value={filters.searchQuery}
                      onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                      className="pl-8 h-9"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
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
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No transactions match your filters.
                    {hasActiveFilters && (
                      <Button variant="link" onClick={clearFilters} className="ml-2">
                        Clear filters
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : filteredTransactions.map((transaction: InventoryTransaction) => {
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
                        {(transaction.user_id && userMap.get(transaction.user_id)) || (transaction.user_id ? transaction.user_id.substring(0, 8) + '...' : '-')}
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
          {hasActiveFilters && ` (${filteredTransactions.length} matching filters)`}
        </p>
      )}

      {/* Stock Adjustment Dialog */}
      <StockAdjustmentDialog
        open={adjustmentDialogOpen}
        onOpenChange={setAdjustmentDialogOpen}
        componentId={componentId}
        componentName={componentName}
        currentStock={currentStock}
      />
    </div>
  );
}






