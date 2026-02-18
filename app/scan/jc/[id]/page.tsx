'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Hash,
  FileImage,
  AlertTriangle,
  Package,
  User,
  CalendarDays,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────
interface JobCardData {
  job_card_id: number;
  order_id: number | null;
  staff_id: number | null;
  issue_date: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  staff: { first_name: string; last_name: string } | null;
  orders: {
    order_number: string;
    customers: { name: string } | null;
  } | null;
}

interface JobCardItem {
  item_id: number;
  job_id: number | null;
  product_id: number | null;
  quantity: number;
  completed_quantity: number;
  piece_rate: number;
  status: string;
  jobs: { name: string } | null;
  products: { name: string } | null;
}

// ── Page ───────────────────────────────────────────────────────────
export default function JobCardScanPage() {
  const params = useParams();
  const jobCardId = Number(params.id);

  const [jobCard, setJobCard] = useState<JobCardData | null>(null);
  const [items, setItems] = useState<JobCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [qtyDialogItem, setQtyDialogItem] = useState<JobCardItem | null>(null);
  const [qtyInput, setQtyInput] = useState('');

  const fetchData = async () => {
    try {
      const [cardRes, itemsRes] = await Promise.all([
        supabase
          .from('job_cards')
          .select(`
            job_card_id, order_id, staff_id, issue_date, due_date, status, notes,
            staff:staff_id(first_name, last_name),
            orders:order_id(order_number, customers(name))
          `)
          .eq('job_card_id', jobCardId)
          .single(),
        supabase
          .from('job_card_items')
          .select(`
            item_id, job_id, product_id, quantity, completed_quantity, piece_rate, status,
            jobs:job_id(name),
            products:product_id(name)
          `)
          .eq('job_card_id', jobCardId)
          .order('item_id'),
      ]);

      if (cardRes.error) throw cardRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setJobCard(cardRes.data as unknown as JobCardData);
      setItems((itemsRes.data as unknown as JobCardItem[]) || []);
    } catch (err: any) {
      setError(err.message || 'Job card not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!Number.isFinite(jobCardId) || jobCardId <= 0) {
      setError('Invalid job card ID');
      setLoading(false);
      return;
    }
    fetchData();
  }, [jobCardId]);

  const summary = useMemo(() => {
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const completedQty = items.reduce((s, i) => s + i.completed_quantity, 0);
    const totalValue = items.reduce((s, i) => s + i.quantity * (i.piece_rate || 0), 0);
    const earnedValue = items.reduce((s, i) => s + i.completed_quantity * (i.piece_rate || 0), 0);
    return { totalQty, completedQty, totalValue, earnedValue };
  }, [items]);

  // ── Actions ────────────────────────────────────────────────────
  const handleStartJob = async () => {
    if (!jobCard || jobCard.status !== 'pending') return;
    setActionLoading('start');
    try {
      const { error: err } = await supabase
        .from('job_cards')
        .update({ status: 'in_progress' })
        .eq('job_card_id', jobCardId);
      if (err) throw err;
      setJobCard((prev) => prev ? { ...prev, status: 'in_progress' } : prev);
      toast.success('Job started');
    } catch (err: any) {
      toast.error(err.message || 'Failed to start job');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompleteJob = async () => {
    if (!jobCard) return;
    setActionLoading('complete');
    try {
      const { error: err } = await supabase
        .from('job_cards')
        .update({ status: 'completed', completion_date: new Date().toISOString().split('T')[0] })
        .eq('job_card_id', jobCardId);
      if (err) throw err;
      setJobCard((prev) => prev ? { ...prev, status: 'completed' } : prev);
      toast.success('Job completed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to complete job');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmitQty = async () => {
    if (!qtyDialogItem) return;
    const qty = parseInt(qtyInput, 10);
    if (Number.isNaN(qty) || qty < 0) {
      toast.error('Enter a valid quantity');
      return;
    }
    const clampedQty = Math.min(qty, qtyDialogItem.quantity);
    setActionLoading('qty');
    try {
      const newStatus = clampedQty >= qtyDialogItem.quantity ? 'completed' : clampedQty > 0 ? 'in_progress' : 'pending';
      const updates: Record<string, any> = { completed_quantity: clampedQty, status: newStatus };
      if (newStatus === 'completed') updates.completion_time = new Date().toISOString();
      if (clampedQty > 0 && qtyDialogItem.completed_quantity === 0) updates.start_time = new Date().toISOString();

      const { error: err } = await supabase
        .from('job_card_items')
        .update(updates)
        .eq('item_id', qtyDialogItem.item_id);
      if (err) throw err;

      setItems((prev) =>
        prev.map((i) =>
          i.item_id === qtyDialogItem.item_id ? { ...i, completed_quantity: clampedQty, status: newStatus } : i,
        ),
      );
      toast.success(`Quantity updated: ${clampedQty}`);
      setQtyDialogItem(null);
      setQtyInput('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update quantity');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !jobCard) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="text-lg font-medium">Job card not found</p>
        <p className="text-sm text-muted-foreground">{error || `ID: ${jobCardId}`}</p>
      </div>
    );
  }

  const isActive = jobCard.status === 'pending' || jobCard.status === 'in_progress';
  const statusColor =
    jobCard.status === 'completed'
      ? 'bg-emerald-500'
      : jobCard.status === 'in_progress'
        ? 'bg-blue-500'
        : jobCard.status === 'cancelled'
          ? 'bg-red-500'
          : 'bg-amber-500';

  const progressPct = summary.totalQty > 0 ? Math.round((summary.completedQty / summary.totalQty) * 100) : 0;

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background pb-8">
      {/* ── Header ───────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Job Card #{jobCard.job_card_id}</h1>
            {jobCard.orders && (
              <p className="text-sm text-muted-foreground">
                Order #{jobCard.orders.order_number}
                {jobCard.orders.customers ? ` · ${jobCard.orders.customers.name}` : ''}
              </p>
            )}
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white ${statusColor}`}>
            {jobCard.status === 'completed' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
            {jobCard.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        </div>
      </div>

      <div className="space-y-4 px-4 pt-4">
        {/* ── Info Cards ─────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <InfoCard
            icon={<User className="h-4 w-4" />}
            label="Staff"
            value={jobCard.staff ? `${jobCard.staff.first_name} ${jobCard.staff.last_name}` : 'Unassigned'}
          />
          <InfoCard
            icon={<CalendarDays className="h-4 w-4" />}
            label="Due"
            value={jobCard.due_date || 'No due date'}
          />
        </div>

        {/* ── Progress ───────────────────────────── */}
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Progress</span>
            <span className="font-bold">{progressPct}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-2xl font-bold">{summary.completedQty}</p>
              <p className="text-xs text-muted-foreground">of {summary.totalQty} done</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-2xl font-bold">R {summary.earnedValue.toFixed(0)}</p>
              <p className="text-xs text-muted-foreground">of R {summary.totalValue.toFixed(0)}</p>
            </div>
          </div>
        </div>

        {/* ── Items ──────────────────────────────── */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Items</h2>
          {items.map((item) => {
            const done = item.completed_quantity >= item.quantity;
            return (
              <div
                key={item.item_id}
                className={`flex items-center gap-3 rounded-xl border p-3 transition ${done ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'bg-card'}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Package className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.products?.name || item.jobs?.name || 'Item'}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.jobs?.name || '—'} · {item.completed_quantity}/{item.quantity}
                    {item.piece_rate ? ` · R ${item.piece_rate}` : ''}
                  </p>
                </div>
                {isActive && !done && (
                  <button
                    type="button"
                    onClick={() => {
                      setQtyDialogItem(item);
                      setQtyInput(String(item.completed_quantity));
                    }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground active:scale-95"
                  >
                    <Hash className="h-5 w-5" />
                  </button>
                )}
                {done && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
              </div>
            );
          })}
        </div>

        {/* ── Notes ──────────────────────────────── */}
        {jobCard.notes && (
          <div className="rounded-xl border bg-amber-50/50 p-3 dark:bg-amber-950/20">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Instructions</p>
            <p className="mt-1 text-sm">{jobCard.notes}</p>
          </div>
        )}

        {/* ── Action Buttons ─────────────────────── */}
        {isActive && (
          <div className="space-y-3 pt-2">
            {jobCard.status === 'pending' && (
              <button
                type="button"
                onClick={handleStartJob}
                disabled={!!actionLoading}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-lg font-semibold text-white active:scale-[0.98] disabled:opacity-50"
              >
                {actionLoading === 'start' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
                Start Job
              </button>
            )}
            {jobCard.status === 'in_progress' && (
              <button
                type="button"
                onClick={handleCompleteJob}
                disabled={!!actionLoading}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-lg font-semibold text-white active:scale-[0.98] disabled:opacity-50"
              >
                {actionLoading === 'complete' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
                Complete Job
              </button>
            )}
          </div>
        )}

        {/* ── Completed State ────────────────────── */}
        {jobCard.status === 'completed' && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 dark:border-emerald-800 dark:bg-emerald-950/20">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">Job Completed</p>
          </div>
        )}
      </div>

      {/* ── Quantity Entry Dialog ─────────────────── */}
      {qtyDialogItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="w-full max-w-lg rounded-t-2xl bg-background p-6 sm:rounded-2xl">
            <h3 className="text-lg font-bold">Enter Quantity</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {qtyDialogItem.products?.name || qtyDialogItem.jobs?.name} — Target: {qtyDialogItem.quantity}
            </p>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={qtyDialogItem.quantity}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              autoFocus
              className="mt-4 h-16 w-full rounded-xl border bg-muted text-center text-3xl font-bold focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="mt-3 flex gap-2">
              {[
                Math.ceil(qtyDialogItem.quantity * 0.25),
                Math.ceil(qtyDialogItem.quantity * 0.5),
                Math.ceil(qtyDialogItem.quantity * 0.75),
                qtyDialogItem.quantity,
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQtyInput(String(preset))}
                  className="flex-1 rounded-lg border bg-muted/50 py-2 text-sm font-medium active:scale-95"
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setQtyDialogItem(null);
                  setQtyInput('');
                }}
                className="h-12 rounded-xl border text-sm font-medium active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitQty}
                disabled={!!actionLoading}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50"
              >
                {actionLoading === 'qty' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper Components ──────────────────────────────────────────────
function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
