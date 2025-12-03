'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Area,
} from 'recharts';
import {
  format,
  parseISO,
  startOfDay,
  subDays,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendingUp, TrendingDown, Package, RotateCcw, Settings, Calendar, ExternalLink } from 'lucide-react';
import Link from 'next/link';

type Transaction = {
  transaction_id: number;
  quantity: number;
  transaction_date: string;
  order_id: number | null;
  purchase_order_id: number | null;
  reason: string | null;
  transaction_type?: {
    type_name: string;
  } | null;
  order?: {
    order_number: string;
  } | null;
  purchase_order?: {
    q_number: string;
  } | null;
};

type StockMovementChartProps = {
  transactions: Transaction[];
  currentStock: number;
  reorderLevel?: number;
};

type DayData = {
  date: string;
  dateLabel: string;
  balance: number;
  stockIn: number;
  stockOut: number;
  adjustments: number;
  transactions: Transaction[];
};

const TIME_RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export function StockMovementChart({ transactions, currentStock, reorderLevel = 0 }: StockMovementChartProps) {
  const [timeRange, setTimeRange] = useState(30);
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);

  // Process transactions into daily data
  const chartData = useMemo(() => {
    const endDate = new Date();
    const startDate = subDays(endDate, timeRange);
    
    // Get all days in range
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    
    // Group transactions by day
    const txByDay = new Map<string, Transaction[]>();
    transactions.forEach((tx) => {
      const dayKey = format(startOfDay(parseISO(tx.transaction_date)), 'yyyy-MM-dd');
      if (!txByDay.has(dayKey)) {
        txByDay.set(dayKey, []);
      }
      txByDay.get(dayKey)!.push(tx);
    });

    // Calculate running balance working backwards from current stock
    // First, sum all transactions in the range to find starting balance
    let runningBalance = currentStock;
    
    // Build daily data from most recent to oldest
    const dailyData: DayData[] = [];
    
    for (let i = days.length - 1; i >= 0; i--) {
      const day = days[i];
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayTxs = txByDay.get(dayKey) || [];
      
      // Calculate daily totals
      let stockIn = 0;
      let stockOut = 0;
      let adjustments = 0;
      
      dayTxs.forEach((tx) => {
        const qty = tx.quantity || 0;
        const typeName = tx.transaction_type?.type_name?.toUpperCase() || '';
        
        if (typeName === 'ADJUSTMENT' || typeName === 'ADJUST') {
          adjustments += qty;
        } else if (qty > 0) {
          stockIn += qty;
        } else {
          stockOut += Math.abs(qty);
        }
      });
      
      // Calculate balance at end of this day
      const dayBalance = runningBalance;
      
      dailyData.unshift({
        date: dayKey,
        dateLabel: format(day, 'MMM dd'),
        balance: dayBalance,
        stockIn,
        stockOut: -stockOut, // Negative for chart display
        adjustments,
        transactions: dayTxs,
      });
      
      // Work backwards for previous day's balance
      const dayNetChange = stockIn - stockOut + adjustments;
      runningBalance = runningBalance - dayNetChange;
    }
    
    return dailyData;
  }, [transactions, currentStock, timeRange]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const totalIn = chartData.reduce((sum, d) => sum + d.stockIn, 0);
    const totalOut = chartData.reduce((sum, d) => sum + Math.abs(d.stockOut), 0);
    const totalAdjust = chartData.reduce((sum, d) => sum + d.adjustments, 0);
    const daysWithActivity = chartData.filter(d => d.transactions.length > 0).length;
    
    return { totalIn, totalOut, totalAdjust, daysWithActivity };
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload as DayData;
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3 min-w-[180px]">
          <p className="font-semibold mb-2">{data.dateLabel}</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Balance:</span>
              <span className="font-medium">{data.balance}</span>
            </div>
            {data.stockIn > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Stock In:</span>
                <span>+{data.stockIn}</span>
              </div>
            )}
            {data.stockOut < 0 && (
              <div className="flex justify-between text-red-600">
                <span>Stock Out:</span>
                <span>{data.stockOut}</span>
              </div>
            )}
            {data.adjustments !== 0 && (
              <div className="flex justify-between text-blue-600">
                <span>Adjustments:</span>
                <span>{data.adjustments > 0 ? '+' : ''}{data.adjustments}</span>
              </div>
            )}
            {data.transactions.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                Click to view {data.transactions.length} transaction{data.transactions.length > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // Handle chart click
  const handleChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const dayData = data.activePayload[0].payload as DayData;
      if (dayData.transactions.length > 0) {
        setSelectedDay(dayData);
      }
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Stock Movement
            </CardTitle>
            <div className="flex items-center gap-4">
              {/* Summary badges */}
              <div className="hidden md:flex items-center gap-2">
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  +{stats.totalIn} in
                </Badge>
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  <TrendingDown className="h-3 w-3 mr-1" />
                  -{stats.totalOut} out
                </Badge>
                {stats.totalAdjust !== 0 && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Settings className="h-3 w-3 mr-1" />
                    {stats.totalAdjust > 0 ? '+' : ''}{stats.totalAdjust} adj
                  </Badge>
                )}
              </div>
              
              {/* Time range selector */}
              <Select
                value={timeRange.toString()}
                onValueChange={(v) => setTimeRange(parseInt(v))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((range) => (
                    <SelectItem key={range.days} value={range.days.toString()}>
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                onClick={handleChartClick}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                
                {/* Reference line at zero */}
                <ReferenceLine y={0} stroke="#888" strokeDasharray="3 3" />
                
                {/* Reorder level reference line */}
                {reorderLevel > 0 && (
                  <ReferenceLine 
                    y={reorderLevel} 
                    stroke="#f59e0b" 
                    strokeWidth={2}
                    strokeDasharray="8 4"
                    label={{ 
                      value: `Reorder Level (${reorderLevel})`, 
                      position: 'right',
                      fill: '#f59e0b',
                      fontSize: 11,
                      fontWeight: 500
                    }}
                  />
                )}
                
                {/* Stock In bars (positive) */}
                <Bar
                  dataKey="stockIn"
                  name="Stock In"
                  fill="#22c55e"
                  opacity={0.8}
                  radius={[4, 4, 0, 0]}
                />
                
                {/* Stock Out bars (negative) */}
                <Bar
                  dataKey="stockOut"
                  name="Stock Out"
                  fill="#ef4444"
                  opacity={0.8}
                  radius={[0, 0, 4, 4]}
                />
                
                {/* Balance line */}
                <Line
                  type="monotone"
                  dataKey="balance"
                  name="Balance"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, cursor: 'pointer' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          
          {/* Activity summary */}
          <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
            <span>{stats.daysWithActivity} days with activity in this period</span>
            <span className="text-xs">Click on a day to see transactions</span>
          </div>
        </CardContent>
      </Card>

      {/* Day Detail Dialog */}
      <Dialog open={!!selectedDay} onOpenChange={() => setSelectedDay(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Transactions for {selectedDay?.dateLabel}
            </DialogTitle>
          </DialogHeader>
          
          {selectedDay && (
            <div className="space-y-4">
              {/* Day summary */}
              <div className="flex gap-4">
                {selectedDay.stockIn > 0 && (
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    +{selectedDay.stockIn} in
                  </Badge>
                )}
                {selectedDay.stockOut < 0 && (
                  <Badge variant="outline" className="bg-red-50 text-red-700">
                    {selectedDay.stockOut} out
                  </Badge>
                )}
                {selectedDay.adjustments !== 0 && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700">
                    {selectedDay.adjustments > 0 ? '+' : ''}{selectedDay.adjustments} adjustment
                  </Badge>
                )}
                <Badge variant="secondary">
                  Balance: {selectedDay.balance}
                </Badge>
              </div>
              
              {/* Transactions table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedDay.transactions
                    .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
                    .map((tx) => (
                      <TableRow key={tx.transaction_id}>
                        <TableCell className="text-sm">
                          {format(parseISO(tx.transaction_date), 'HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {tx.transaction_type?.type_name || 'Unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={tx.quantity > 0 ? 'text-green-600' : 'text-red-600'}>
                            {tx.quantity > 0 ? '+' : ''}{tx.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {tx.order_id ? (
                            <Link
                              href={`/orders/${tx.order_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                            >
                              {tx.order?.order_number || `Order #${tx.order_id}`}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : tx.purchase_order_id ? (
                            <Link
                              href={`/purchasing/purchase-orders/${tx.purchase_order_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                            >
                              {tx.purchase_order?.q_number || `PO #${tx.purchase_order_id}`}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {tx.reason || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
