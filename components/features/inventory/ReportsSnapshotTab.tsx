'use client';

import { useEffect, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { buildInventorySnapshotCsv, type InventorySnapshotResponse } from '@/lib/inventory/snapshot';
import { fetchInventorySnapshot } from '@/lib/client/inventory';
import { supabase } from '@/lib/supabase';

function downloadSnapshotCsv(snapshot: InventorySnapshotResponse) {
  const csv = buildInventorySnapshotCsv(snapshot, { includeEstimatedValues: true });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inventory-snapshot-${snapshot.as_of_date}-with-value.csv`;
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
  const { toast } = useToast();
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const userRole = (user as any)?.app_metadata?.role || (user as any)?.user_metadata?.role;

  const {
    data: snapshot,
    isLoading: isLoadingSnapshot,
    error: snapshotError,
    refetch: refetchSnapshot,
    isFetching: isFetchingSnapshot,
  } = useQuery({
    queryKey: ['inventory', 'snapshot', snapshotDate, 'with-value'],
    queryFn: () =>
      fetchInventorySnapshot(snapshotDate, {
        includeEstimatedValues: true,
      }),
    enabled: !!user && !!snapshotDate,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function resolveAdmin() {
      if (!user) {
        if (!cancelled) setIsAdmin(false);
        return;
      }

      if (userRole === 'owner' || userRole === 'admin') {
        if (!cancelled) setIsAdmin(true);
        return;
      }

      try {
        const [
          { data: membershipData, error: membershipError },
          { data: platformData, error: platformError },
        ] = await Promise.all([
          supabase
            .from('organization_members')
            .select('role')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle(),
          supabase
            .from('platform_admins')
            .select('user_id')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle(),
        ]);

        if (cancelled) return;
        if (membershipError && platformError) {
          setIsAdmin(false);
          return;
        }
        setIsAdmin(
          membershipData?.role === 'owner' ||
            membershipData?.role === 'admin' ||
            Boolean(platformData?.user_id)
        );
      } catch (_error) {
        if (!cancelled) setIsAdmin(false);
      }
    }

    resolveAdmin();
    return () => {
      cancelled = true;
    };
  }, [user?.id, userRole]);

  async function handleRecomputeAverageCost() {
    const confirmed = window.confirm(
      'Recompute weighted average cost from inventory transaction history for this organization?'
    );
    if (!confirmed) return;

    setIsRecomputing(true);
    try {
      const res = await authorizedFetch('/api/admin/inventory/recompute-wac', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ?? `Request failed (${res.status})`);
      }

      toast({
        title: 'Average cost recomputed',
        description: `${Number(payload?.updated ?? 0).toLocaleString()} components updated.`,
      });
      refetchSnapshot();
    } catch (error) {
      toast({
        title: 'Failed to recompute average cost',
        description: error instanceof Error ? error.message : 'Unexpected error',
        variant: 'destructive',
      });
    } finally {
      setIsRecomputing(false);
    }
  }

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

  const filteredInventoryValue = useMemo(
    () =>
      filteredRows.reduce(
        (total, row) => total + (row.estimated_value_current_cost ?? 0),
        0
      ),
    [filteredRows]
  );

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
          <div className="flex gap-2">
            {isAdmin ? (
              <Button
                variant="outline"
                onClick={handleRecomputeAverageCost}
                disabled={isRecomputing}
              >
                {isRecomputing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Recompute average cost
              </Button>
            ) : null}
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
              onClick={() => snapshot && downloadSnapshotCsv(snapshot)}
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
                  {' '}Inventory value uses each item&apos;s average unit cost.
                  Rows marked est. use supplier price because no purchase cost has been saved yet.
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-blue-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span>
                  Inventory value uses each item&apos;s average unit cost.
                  Rows marked est. use supplier price because no purchase cost has been saved yet.
                </span>
              </div>
            )}

            {/* Summary metrics */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <p className="text-sm font-medium text-muted-foreground">Stocked Components</p>
                <p className="mt-2 text-2xl font-bold">{filteredRows.length}</p>
              </div>
              <div className="rounded-xl border bg-card p-4 shadow-xs">
                <p className="text-sm font-medium text-muted-foreground">Inventory Value</p>
                <p className="mt-2 text-2xl font-bold">
                  {formatCurrency(filteredInventoryValue)}
                </p>
              </div>
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
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[18%]">Code</TableHead>
                    <TableHead className="w-[28%]">Description</TableHead>
                    <TableHead className="w-[15%]">Category</TableHead>
                    <TableHead className="hidden w-[10%] xl:table-cell">Location</TableHead>
                    <TableHead className="hidden w-[9%] text-right xl:table-cell">Reorder</TableHead>
                    <TableHead className="w-[11%] text-right">Qty</TableHead>
                    <TableHead className="w-[13%] text-right">Unit Cost</TableHead>
                    <TableHead className="w-[15%] text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
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
                        <TableCell className="hidden xl:table-cell">{row.location || '-'}</TableCell>
                        <TableCell className="hidden text-right xl:table-cell">
                          {row.reorder_level == null ? '—' : row.reorder_level.toLocaleString()}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">
                          {row.snapshot_quantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {row.unit_cost == null ? (
                            '—'
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {formatCurrency(row.unit_cost)}
                              {row.cost_source === 'list_price' ? (
                                <span className="rounded border px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  est.
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {row.estimated_value_current_cost == null
                            ? '—'
                            : formatCurrency(row.estimated_value_current_cost)}
                        </TableCell>
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
