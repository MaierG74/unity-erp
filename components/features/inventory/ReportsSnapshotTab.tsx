'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/common/auth-provider';
import { RefreshCw, Loader2, FileDown, Search, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildInventorySnapshotCsv, type InventorySnapshotResponse } from '@/lib/inventory/snapshot';
import { fetchInventorySnapshot } from '@/lib/client/inventory';

function downloadSnapshotCsv(snapshot: InventorySnapshotResponse, includeEstimatedValues: boolean) {
  const csv = buildInventorySnapshotCsv(snapshot, { includeEstimatedValues });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = includeEstimatedValues
    ? `inventory-snapshot-${snapshot.as_of_date}-with-estimate.csv`
    : `inventory-snapshot-${snapshot.as_of_date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ReportsSnapshotTab() {
  const { user } = useAuth();
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showEstimatedValue, setShowEstimatedValue] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const {
    data: snapshot,
    isLoading: isLoadingSnapshot,
    error: snapshotError,
    refetch: refetchSnapshot,
    isFetching: isFetchingSnapshot,
  } = useQuery({
    queryKey: ['inventory', 'snapshot', snapshotDate, showEstimatedValue],
    queryFn: () =>
      fetchInventorySnapshot(snapshotDate, {
        includeEstimatedValues: showEstimatedValue,
      }),
    enabled: !!user && !!snapshotDate,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const snapshotRows = useMemo(
    () => (snapshot?.rows ?? []).filter((row) => row.snapshot_quantity !== 0),
    [snapshot]
  );

  // Extract unique categories for the filter dropdown
  const categories = useMemo(() => {
    const cats = new Set<string>();
    snapshotRows.forEach((row) => cats.add(row.category_name || 'Uncategorized'));
    return Array.from(cats).sort();
  }, [snapshotRows]);

  // Apply search + category filter
  const filteredRows = useMemo(() => {
    let rows = snapshotRows;
    if (categoryFilter !== 'all') {
      rows = rows.filter((row) => (row.category_name || 'Uncategorized') === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.internal_code.toLowerCase().includes(q) ||
          (row.description || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [snapshotRows, searchQuery, categoryFilter]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Stock Snapshot As Of Date</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls row */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="w-full max-w-xs space-y-1">
            <label htmlFor="snapshot-date" className="text-sm font-medium">
              Snapshot date
            </label>
            <Input
              id="snapshot-date"
              type="date"
              value={snapshotDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setSnapshotDate(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <div className="space-y-0.5">
              <label htmlFor="snapshot-estimate-toggle" className="text-sm font-medium">
                Show estimated value
              </label>
              <p className="text-xs text-muted-foreground">
                Current lowest supplier price.
              </p>
            </div>
            <Switch
              id="snapshot-estimate-toggle"
              checked={showEstimatedValue}
              onCheckedChange={setShowEstimatedValue}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => refetchSnapshot()}
              disabled={!snapshotDate || isFetchingSnapshot}
            >
              {isFetchingSnapshot ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh Snapshot
            </Button>
            <Button
              variant="outline"
              onClick={() => snapshot && downloadSnapshotCsv(snapshot, showEstimatedValue)}
              disabled={!snapshot || snapshotRows.length === 0}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {snapshotError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Failed to load the dated stock snapshot: {(snapshotError as Error).message}
          </div>
        ) : null}

        {isLoadingSnapshot ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : snapshot ? (
          <>
            {/* Consolidated notice — best-effort warning merged with value disclaimer */}
            {snapshot.best_effort ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <span className="font-medium">Approximate quantities before {snapshot.hardening_reference_date}.</span>
                  {' '}Some historical edits were not ledger-tracked.
                  {showEstimatedValue && ' Values use current supplier prices, not historical cost.'}
                </div>
              </div>
            ) : showEstimatedValue ? (
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-blue-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span>Estimated values use current supplier prices, not historical cost at the selected date.</span>
              </div>
            ) : null}

            {/* Summary metrics */}
            <div className={`grid grid-cols-1 gap-4 ${showEstimatedValue ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <p className="text-sm font-medium text-muted-foreground">Stocked Components</p>
                <p className="mt-2 text-2xl font-bold">{snapshot.summary.stocked_components}</p>
              </div>
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <p className="text-sm font-medium text-muted-foreground">Total Quantity</p>
                <p className="mt-2 text-2xl font-bold">{snapshot.summary.total_quantity.toLocaleString()}</p>
              </div>
              {showEstimatedValue ? (
                <div className="rounded-xl border bg-card p-4 shadow-xs">
                  <p className="text-sm font-medium text-muted-foreground">Estimated Value</p>
                  <p className="mt-2 text-2xl font-bold">
                    {formatCurrency(snapshot.summary.estimated_total_value_current_cost ?? 0)}
                  </p>
                </div>
              ) : null}
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <p className="text-sm font-medium text-muted-foreground">Report Date</p>
                <p className="mt-2 text-2xl font-bold">{snapshot.as_of_date}</p>
              </div>
            </div>

            {/* Search + Category filter */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by code or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(searchQuery || categoryFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSearchQuery(''); setCategoryFilter('all'); }}
                  className="text-muted-foreground"
                >
                  Reset
                </Button>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredRows.length} of {snapshotRows.length} components
              </span>
            </div>

            {/* Table */}
            <div className="max-h-[420px] overflow-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Reorder</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    {showEstimatedValue ? (
                      <>
                        <TableHead className="text-right">Est. Unit Cost</TableHead>
                        <TableHead className="text-right">Est. Value</TableHead>
                      </>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showEstimatedValue ? 8 : 6} className="py-8 text-center text-sm text-muted-foreground">
                        {snapshotRows.length === 0
                          ? `No non-zero stock balances were found for ${snapshot.as_of_date}.`
                          : 'No components match the current filters.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((row) => (
                      <TableRow key={row.component_id}>
                        <TableCell className="font-medium">
                          <a
                            href={`/inventory/components/${row.component_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {row.internal_code}
                          </a>
                        </TableCell>
                        <TableCell>{row.description || '-'}</TableCell>
                        <TableCell>{row.category_name || 'Uncategorized'}</TableCell>
                        <TableCell>{row.location || '-'}</TableCell>
                        <TableCell className="text-right">
                          {row.reorder_level == null ? '—' : row.reorder_level.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {row.snapshot_quantity.toLocaleString()}
                        </TableCell>
                        {showEstimatedValue ? (
                          <>
                            <TableCell className="text-right">
                              {row.estimated_unit_cost_current == null
                                ? '—'
                                : formatCurrency(row.estimated_unit_cost_current)}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.estimated_value_current_cost == null
                                ? '—'
                                : formatCurrency(row.estimated_value_current_cost)}
                            </TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
