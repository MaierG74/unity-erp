'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, eachDayOfInterval } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Calculator, Check, CreditCard, Loader2, Search, Download, EyeOff, Eye } from 'lucide-react';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useOrgSettings } from '@/hooks/use-org-settings';
import {
  fetchWeeklyHours,
  fetchWeeklyPiecework,
  fetchActiveSupportLinks,
  fetchStaffForPayroll,
  fetchPayrollRecords,
  upsertPayrollRecords,
  updatePayrollStatus,
} from '@/lib/queries/payrollReview';
import { calculatePayrollRows, recalcRowWithOverride, type PayrollRow } from '@/lib/payroll-calc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { formatTimeToSAST } from '@/lib/utils/timezone';
import { getRemainderLabel, isLossAction } from '@/components/features/completion/completion-items';

function formatRand(amount: number): string {
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatHours(hours: number): string {
  return hours.toFixed(2);
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    new: { className: 'bg-gray-500/20 text-gray-400 border-gray-500/30', label: 'New' },
    pending: { className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'Pending' },
    approved: { className: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Approved' },
    paid: { className: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Paid' },
  };
  const v = variants[status] ?? variants.new;
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}

export default function PayrollReviewPage() {
  const { user } = useAuth();
  const orgId = getOrgId(user);
  const { weekStartDay, otThresholdMinutes } = useOrgSettings();

  // Week navigation
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 5 as Day })
  );

  // Recalculate when settings load
  type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const weekStart = useMemo(
    () => startOfWeek(selectedWeekStart, { weekStartsOn: weekStartDay as Day }),
    [selectedWeekStart, weekStartDay]
  );
  const weekEnd = useMemo(
    () => endOfWeek(weekStart, { weekStartsOn: weekStartDay as Day }),
    [weekStart, weekStartDay]
  );

  const startStr = format(weekStart, 'yyyy-MM-dd');
  const endStr = format(weekEnd, 'yyyy-MM-dd');

  // State
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [calculated, setCalculated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [hideZero, setHideZero] = useState(false);

  // Week cache — remembers calculated results when navigating between weeks
  const [weekCache, setWeekCache] = useState<Map<string, PayrollRow[]>>(new Map());

  const saveToCache = (key: string, rows: PayrollRow[]) => {
    setWeekCache((prev) => new Map(prev).set(key, rows));
  };

  // Navigation — restore from cache if available
  const prevStartStr = useRef(startStr);
  const navigateToWeek = (newWeekStart: Date | ((prev: Date) => Date)) => {
    // Save current week to cache before navigating
    if (calculated && payrollRows.length > 0) {
      saveToCache(startStr, payrollRows);
    }
    setPayrollRows([]);
    setCalculated(false);
    setSelectedIds(new Set());
    setSelectedWeekStart(newWeekStart);
  };

  // Restore from cache when week changes
  useEffect(() => {
    if (prevStartStr.current === startStr) return;
    prevStartStr.current = startStr;
    const cached = weekCache.get(startStr);
    if (cached && cached.length > 0) {
      setPayrollRows(cached);
      setCalculated(true);
    }
  }, [startStr, weekCache]);

  const goToPrev = () => navigateToWeek((prev) => subWeeks(prev, 1));
  const goToNext = () => navigateToWeek((prev) => addWeeks(prev, 1));
  const goToCurrent = () => navigateToWeek(new Date());

  // Calculate Week
  const handleCalculate = async () => {
    if (!orgId) return;
    setCalculating(true);
    try {
      const [staff, hours, piecework, supportLinks, existing] = await Promise.all([
        fetchStaffForPayroll(),
        fetchWeeklyHours(startStr, endStr),
        fetchWeeklyPiecework(startStr, endStr),
        fetchActiveSupportLinks(),
        fetchPayrollRecords(startStr),
      ]);

      const rows = calculatePayrollRows(
        staff,
        hours,
        piecework,
        supportLinks,
        existing,
        { otThresholdMinutes },
      );

      setPayrollRows(rows);
      setCalculated(true);
      setSelectedIds(new Set());

      // Auto-save to database
      const records = rows.map((row) => ({
        staff_id: row.staff_id,
        week_start_date: startStr,
        week_end_date: endStr,
        regular_hours: row.regularHours,
        overtime_hours: row.otHours,
        doubletime_hours: row.dtHours,
        hourly_wage_total: row.hourlyTotal,
        piece_work_total: row.pieceworkNet,
        final_payment: row.finalPay,
        status: row.status === 'new' ? 'pending' : row.status,
        org_id: orgId,
      }));

      await upsertPayrollRecords(records);

      // Update row statuses from 'new' to 'pending'
      setPayrollRows((prev) =>
        prev.map((r) => (r.status === 'new' ? { ...r, status: 'pending' } : r))
      );

      // Re-fetch to get payroll IDs
      const saved = await fetchPayrollRecords(startStr);
      const idMap = new Map<number, number>(saved.map((s) => [s.staff_id, s.payroll_id]));
      setPayrollRows((prev) =>
        prev.map((r) => ({ ...r, payrollId: idMap.get(r.staff_id) ?? r.payrollId }))
      );

      toast.success(`Calculated payroll for ${rows.length} staff`);
    } catch (err: any) {
      toast.error(`Calculation failed: ${err.message}`);
    } finally {
      setCalculating(false);
    }
  };

  // OT Override toggle
  const handleOtToggle = (staffId: number, override: boolean) => {
    setPayrollRows((prev) =>
      prev.map((r) => (r.staff_id === staffId ? recalcRowWithOverride(r, override) : r))
    );
  };

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = payrollRows;
    if (hideZero) {
      rows = rows.filter((r) => r.regularHours > 0 || r.otHours > 0 || r.dtHours > 0 || r.pieceworkGross > 0);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.job_description ?? '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [payrollRows, hideZero, searchQuery]);

  // Bulk selection (operates on filtered view)
  const pendingRows = filteredRows.filter((r) => r.status === 'pending');
  const allPendingSelected = pendingRows.length > 0 && pendingRows.every((r) => selectedIds.has(r.staff_id));

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingRows.map((r) => r.staff_id)));
    }
  };

  const toggleSelect = (staffId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  };

  // Approve Selected
  const handleApprove = async () => {
    const ids = payrollRows
      .filter((r) => selectedIds.has(r.staff_id) && r.payrollId && r.status === 'pending')
      .map((r) => r.payrollId!);
    if (ids.length === 0) return;
    setSaving(true);
    try {
      await updatePayrollStatus(ids, 'approved');
      setPayrollRows((prev) =>
        prev.map((r) =>
          selectedIds.has(r.staff_id) && r.status === 'pending'
            ? { ...r, status: 'approved' }
            : r
        )
      );
      setSelectedIds(new Set());
      toast.success(`Approved ${ids.length} payroll records`);
    } catch (err: any) {
      toast.error(`Approve failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Mark Paid
  const handleMarkPaid = async () => {
    const ids = payrollRows
      .filter((r) => selectedIds.has(r.staff_id) && r.payrollId && r.status === 'approved')
      .map((r) => r.payrollId!);
    if (ids.length === 0) return;
    setSaving(true);
    try {
      await updatePayrollStatus(ids, 'paid', format(new Date(), 'yyyy-MM-dd'));
      setPayrollRows((prev) =>
        prev.map((r) =>
          selectedIds.has(r.staff_id) && r.status === 'approved'
            ? { ...r, status: 'paid' }
            : r
        )
      );
      setSelectedIds(new Set());
      toast.success(`Marked ${ids.length} records as paid`);
    } catch (err: any) {
      toast.error(`Mark paid failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Summary stats (always from full set)
  const totalStaff = payrollRows.length;
  const totalPayroll = payrollRows.reduce((sum, r) => sum + r.finalPay, 0);
  const flaggedCount = payrollRows.filter((r) => r.flaggedForReview).length;
  const activeStaff = payrollRows.filter((r) => r.regularHours > 0 || r.otHours > 0 || r.dtHours > 0 || r.pieceworkGross > 0).length;

  // Section breakdown
  const sectionBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const r of payrollRows) {
      if (r.finalPay === 0) continue;
      const section = r.job_description ?? 'Unassigned';
      const entry = map.get(section) ?? { count: 0, total: 0 };
      entry.count++;
      entry.total += r.finalPay;
      map.set(section, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total);
  }, [payrollRows]);

  // CSV Export
  const handleExportCsv = useCallback(() => {
    const header = ['Staff', 'Job', 'Reg Hrs', 'OT Hrs', 'DT Hrs', 'Hourly Total', 'PW Gross', 'Support Ded', 'PW Net', 'Final Pay', 'Status'];
    const csvRows = [header.join(',')];
    for (const r of filteredRows) {
      csvRows.push([
        `"${r.name}"`,
        `"${r.job_description ?? ''}"`,
        r.regularHours.toFixed(2),
        r.otHours.toFixed(2),
        r.dtHours.toFixed(2),
        r.hourlyTotal.toFixed(2),
        r.pieceworkGross.toFixed(2),
        r.supportDeduction.toFixed(2),
        r.pieceworkNet.toFixed(2),
        r.finalPay.toFixed(2),
        r.status,
      ].join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${startStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, startStr]);

  // Selected staff for drill-down
  const selectedRow = payrollRows.find((r) => r.staff_id === selectedStaffId);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Payroll Review</h1>
          <p className="text-sm text-muted-foreground">Weekly payroll calculation, review, and approval</p>
        </div>

        {/* Week Selector */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={goToPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium min-w-[220px] text-center">
              {format(weekStart, 'EEE d MMM')} – {format(weekEnd, 'EEE d MMM yyyy')}
            </div>
            <Button variant="outline" size="icon" onClick={goToNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToCurrent}>
              Current Week
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={handleApprove} disabled={saving}>
                  <Check className="mr-1 h-4 w-4" />
                  Approve Selected ({selectedIds.size})
                </Button>
                <Button size="sm" variant="outline" onClick={handleMarkPaid} disabled={saving}>
                  <CreditCard className="mr-1 h-4 w-4" />
                  Mark Paid
                </Button>
              </>
            )}
            <Button onClick={handleCalculate} disabled={calculating || !orgId}>
              {calculating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="mr-2 h-4 w-4" />
              )}
              Calculate Week
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        {calculated && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm text-muted-foreground">Total Staff</div>
                <div className="text-2xl font-bold">{totalStaff}</div>
                <div className="text-xs text-muted-foreground">{activeStaff} with hours/piecework</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm text-muted-foreground">Total Payroll</div>
                <div className="text-2xl font-bold">{formatRand(totalPayroll)}</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm text-muted-foreground">Flagged for OT Review</div>
                <div className="text-2xl font-bold">
                  {flaggedCount > 0 ? (
                    <span className="text-amber-400">{flaggedCount}</span>
                  ) : (
                    <span className="text-green-400">0</span>
                  )}
                </div>
              </div>
              {/* Section breakdown */}
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm text-muted-foreground mb-2">By Section</div>
                {sectionBreakdown.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No payroll data</div>
                ) : (
                  <div className="space-y-1 max-h-[120px] overflow-y-auto">
                    {sectionBreakdown.map(([section, { count, total }]) => (
                      <div key={section} className="flex items-center justify-between text-xs">
                        <span className="truncate mr-2">{section} <span className="text-muted-foreground">({count})</span></span>
                        <span className="tabular-nums font-medium flex-shrink-0">{formatRand(total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar: Search + Filters + Export */}
        {calculated && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search staff or job..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHideZero((v) => !v)}
              className={hideZero ? 'border-primary text-primary' : ''}
            >
              {hideZero ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
              {hideZero ? `Show All (${totalStaff})` : `Hide Zero (${totalStaff - activeStaff})`}
            </Button>
            <div className="flex-1" />
            {filteredRows.length !== payrollRows.length && (
              <span className="text-xs text-muted-foreground">
                Showing {filteredRows.length} of {payrollRows.length}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        )}

        {/* Staff Table */}
        {!calculated ? (
          <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
            <Calculator className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">Select a week and click Calculate</p>
            <p className="text-sm">This will aggregate hours, piecework, and support deductions for all staff</p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPendingSelected}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead className="text-right">Reg Hrs</TableHead>
                  <TableHead className="text-right">OT Hrs</TableHead>
                  <TableHead className="text-right">DT Hrs</TableHead>
                  <TableHead className="text-right">Hourly Total</TableHead>
                  <TableHead className="text-right">PW Gross</TableHead>
                  <TableHead className="text-right">Support Ded.</TableHead>
                  <TableHead className="text-right">PW Net</TableHead>
                  <TableHead className="text-right">Final Pay</TableHead>
                  <TableHead className="text-center">Std Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const isLocked = row.status === 'approved' || row.status === 'paid';
                  const hourlyWins = row.hourlyTotal >= row.pieceworkNet;

                  return (
                    <TableRow
                      key={row.staff_id}
                      className={`cursor-pointer ${
                        row.flaggedForReview && !row.otOverride
                          ? 'border-l-4 border-l-amber-500'
                          : ''
                      } ${isLocked ? 'opacity-60' : ''}`}
                      onClick={(e) => {
                        // Don't open panel when clicking checkbox or toggle
                        const target = e.target as HTMLElement;
                        if (target.closest('button') || target.closest('[role="checkbox"]') || target.closest('[role="switch"]')) return;
                        setSelectedStaffId(row.staff_id);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(row.staff_id)}
                          onCheckedChange={() => toggleSelect(row.staff_id)}
                          disabled={isLocked}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{row.job_description ?? '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatHours(row.regularHours)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${row.flaggedForReview && !row.otOverride ? 'text-amber-400 font-medium' : ''}`}>
                        {formatHours(row.otHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatHours(row.dtHours)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${hourlyWins ? 'text-green-400 font-medium' : ''}`}>
                        {formatRand(row.hourlyTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRand(row.pieceworkGross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.supportDeduction > 0 ? formatRand(row.supportDeduction) : '-'}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${!hourlyWins ? 'text-green-400 font-medium' : ''}`}>
                        {formatRand(row.pieceworkNet)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold">
                        {formatRand(row.finalPay)}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={row.otOverride}
                          onCheckedChange={(checked) => handleOtToggle(row.staff_id, checked)}
                          disabled={isLocked}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Staff Detail Panel */}
      <PayrollDetailPanel
        staffId={selectedStaffId}
        staffName={selectedRow?.name ?? ''}
        weekStart={startStr}
        weekEnd={endStr}
        row={selectedRow ?? null}
        onClose={() => setSelectedStaffId(null)}
        onOtToggle={handleOtToggle}
      />
    </div>
  );
}

// ---------- Drill-Down Panel ----------

interface PayrollDetailPanelProps {
  staffId: number | null;
  staffName: string;
  weekStart: string;
  weekEnd: string;
  row: PayrollRow | null;
  onClose: () => void;
  onOtToggle: (staffId: number, override: boolean) => void;
}

function PayrollDetailPanel({ staffId, staffName, weekStart, weekEnd, row, onClose, onOtToggle }: PayrollDetailPanelProps) {
  const { data: hoursData } = useQuery({
    queryKey: ['payroll-detail-hours', staffId, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_daily_summary')
        .select('date_worked, first_clock_in, last_clock_out, total_hours_worked, regular_minutes, ot_minutes, dt_minutes')
        .eq('staff_id', staffId!)
        .gte('date_worked', weekStart)
        .lte('date_worked', weekEnd)
        .order('date_worked');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!staffId,
  });

  const { data: pieceworkData } = useQuery({
    queryKey: ['payroll-detail-piecework', staffId, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_card_items')
        .select(`
          item_id, completed_quantity, piece_rate, piece_rate_override,
          quantity, remainder_action, remainder_qty, remainder_reason,
          job:jobs(name),
          job_card:job_cards!inner(job_card_id, order_id, completion_date, staff_id, completion_type,
            order:orders(order_number, customer:customers(name))
          ),
          product:products(name)
        `)
        .eq('job_card.staff_id', staffId!)
        .eq('job_card.status', 'completed')
        .gt('piece_rate', 0)
        .gte('job_card.completion_date', weekStart)
        .lte('job_card.completion_date', weekEnd);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        item_id: row.item_id,
        job_card_id: row.job_card?.job_card_id,
        order_number: row.job_card?.order?.order_number ?? null,
        customer_name: row.job_card?.order?.customer?.name ?? null,
        job_name: row.job?.name ?? null,
        product_name: row.product?.name ?? null,
        completed_quantity: row.completed_quantity,
        quantity: row.quantity,
        piece_rate: row.piece_rate,
        piece_rate_override: row.piece_rate_override,
        earned_amount: row.completed_quantity * (row.piece_rate_override ?? row.piece_rate),
        remainder_action: row.remainder_action,
        remainder_qty: row.remainder_qty,
        remainder_reason: row.remainder_reason,
        completion_type: row.job_card?.completion_type,
      }));
    },
    enabled: !!staffId,
  });

  return (
    <Sheet open={!!staffId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{staffName} — Weekly Detail</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="hours" className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="hours" className="flex-1">Hours</TabsTrigger>
            <TabsTrigger value="piecework" className="flex-1">Piecework</TabsTrigger>
          </TabsList>

          <TabsContent value="hours" className="mt-4 space-y-3">
            {/* OT Override toggle */}
            {row && (
              <div className="flex items-center justify-between px-1">
                <label className="text-sm text-muted-foreground">
                  Include overtime in pay calculation
                </label>
                <Switch
                  checked={!row.otOverride}
                  onCheckedChange={(includeOt) => {
                    if (staffId) onOtToggle(staffId, !includeOt);
                  }}
                  disabled={row.status === 'approved' || row.status === 'paid'}
                />
              </div>
            )}
            {row && row.otOverride && (
              <p className="text-xs text-amber-400 px-1">
                OT hours excluded — all time counted as regular hours
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead className="text-right">Reg</TableHead>
                  <TableHead className="text-right">OT</TableHead>
                  <TableHead className="text-right">DT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hoursData?.map((h) => (
                  <TableRow key={h.date_worked}>
                    <TableCell className="text-sm">
                      {format(new Date(h.date_worked + 'T00:00:00'), 'EEE d MMM')}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatTimeToSAST(h.first_clock_in)}</TableCell>
                    <TableCell className="tabular-nums">{formatTimeToSAST(h.last_clock_out)}</TableCell>
                    <TableCell className="text-right tabular-nums">{((h.regular_minutes ?? 0) / 60).toFixed(1)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${row?.otOverride ? 'line-through text-muted-foreground/50' : ''}`}>
                      {((h.ot_minutes ?? 0) / 60).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{((h.dt_minutes ?? 0) / 60).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
                {hoursData && hoursData.length > 0 && (
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(hoursData.reduce((s, h) => s + (h.regular_minutes ?? 0), 0) / 60).toFixed(1)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${row?.otOverride ? 'line-through text-muted-foreground/50' : ''}`}>
                      {(hoursData.reduce((s, h) => s + (h.ot_minutes ?? 0), 0) / 60).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(hoursData.reduce((s, h) => s + (h.dt_minutes ?? 0), 0) / 60).toFixed(1)}
                    </TableCell>
                  </TableRow>
                )}
                {(!hoursData || hoursData.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No hours recorded for this week
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="piecework" className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order / Job / Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pieceworkData?.map((p) => (
                  <TableRow key={p.item_id}>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {p.order_number ?? `Card #${p.job_card_id}`}
                        {p.customer_name && (
                          <span className="text-muted-foreground font-normal"> — {p.customer_name}</span>
                        )}
                      </div>
                      {p.job_name && (
                        <div className="text-xs text-foreground/80 truncate max-w-[280px]">
                          {p.job_name}
                        </div>
                      )}
                      {p.product_name && (
                        <div className="text-xs text-muted-foreground truncate max-w-[280px]">
                          {p.product_name}
                        </div>
                      )}
                      {p.remainder_action && (
                        <div className="mt-0.5">
                          <Badge variant="outline" className={
                            isLossAction(p.remainder_action)
                              ? 'text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0'
                              : 'text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0'
                          }>
                            {getRemainderLabel(p.remainder_action)}
                            {p.remainder_qty ? ` (${p.remainder_qty})` : ''}
                          </Badge>
                          {p.remainder_reason && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[280px]">
                              {p.remainder_reason}
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{p.completed_quantity}</div>
                      {p.remainder_action && p.quantity && p.completed_quantity < p.quantity && (
                        <div className="text-[10px] text-muted-foreground">of {p.quantity}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRand(Number(p.piece_rate_override ?? p.piece_rate ?? 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(Number(p.earned_amount))}</TableCell>
                  </TableRow>
                ))}
                {pieceworkData && pieceworkData.length > 0 && (
                  <>
                    <TableRow className="font-bold border-t-2">
                      <TableCell colSpan={3}>Gross Piecework</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRand(row?.pieceworkGross ?? 0)}
                      </TableCell>
                    </TableRow>
                    {row && row.supportDeduction > 0 && (
                      <TableRow className="text-muted-foreground">
                        <TableCell colSpan={3}>Support Deduction</TableCell>
                        <TableCell className="text-right tabular-nums">
                          -{formatRand(row.supportDeduction)}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className="font-bold">
                      <TableCell colSpan={3}>Net Piecework</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRand(row?.pieceworkNet ?? 0)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
                {(!pieceworkData || pieceworkData.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No piecework for this week
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
