'use client';

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/common/auth-provider';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const MobileScanLogin = lazy(() =>
  import('@/components/features/scan/mobile-scan-login').then((m) => ({ default: m.MobileScanLogin })),
);
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
  ExternalLink,
  ScanLine,
  FileText,
  X,
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
  const { user, loading: authLoading } = useAuth();
  const params = useParams();
  const jobCardId = Number(params.id);

  const [jobCard, setJobCard] = useState<JobCardData | null>(null);
  const [items, setItems] = useState<JobCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [qtyDialogItem, setQtyDialogItem] = useState<JobCardItem | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [orderDocs, setOrderDocs] = useState<{ id: number; file_url: string; file_name: string }[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

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

  const handleViewOrder = async () => {
    if (!jobCard?.order_id) return;
    // Fetch customer order attachments
    const { data } = await supabase
      .from('order_attachments')
      .select('id, file_url, file_name')
      .eq('order_id', jobCard.order_id)
      .eq('document_type', 'customer_order');
    const docs = data || [];
    if (docs.length === 0) {
      toast.error('No customer order document uploaded for this order');
    } else if (docs.length === 1) {
      window.open(docs[0].file_url, '_blank');
    } else {
      setOrderDocs(docs);
      setShowDocPicker(true);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (!Number.isFinite(jobCardId) || jobCardId <= 0) {
      setError('Invalid job card ID');
      setLoading(false);
      return;
    }
    fetchData();
  }, [jobCardId, user]);

  const summary = useMemo(() => {
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const completedQty = items.reduce((s, i) => s + i.completed_quantity, 0);
    const totalValue = items.reduce((s, i) => s + i.quantity * (i.piece_rate || 0), 0);
    const earnedValue = items.reduce((s, i) => s + i.completed_quantity * (i.piece_rate || 0), 0);
    return { totalQty, completedQty, totalValue, earnedValue };
  }, [items]);

  /** Sync job_status back to labor_plan_assignments when a job card changes state */
  const syncAssignmentStatus = async (newStatus: 'in_progress' | 'completed') => {
    if (!jobCard) return;
    const jobIds = items.map((i) => i.job_id).filter(Boolean);
    if (jobIds.length === 0 || !jobCard.staff_id) return;
    const updates: Record<string, any> = { job_status: newStatus };
    if (newStatus === 'in_progress') updates.started_at = new Date().toISOString();
    if (newStatus === 'completed') updates.completed_at = new Date().toISOString();
    await supabase
      .from('labor_plan_assignments')
      .update(updates)
      .in('job_id', jobIds)
      .eq('staff_id', jobCard.staff_id);
  };

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
      await syncAssignmentStatus('in_progress');
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
      // Finalize items: only auto-fill quantity on untouched items (completed_quantity === 0).
      // Items where a partial qty was already entered keep their value.
      const untouchedItems = items.filter((i) => i.completed_quantity === 0);
      for (const item of untouchedItems) {
        await supabase
          .from('job_card_items')
          .update({ completed_quantity: item.quantity, status: 'completed', completion_time: new Date().toISOString() })
          .eq('item_id', item.item_id);
      }
      // Mark any remaining partial items as completed too (status only, keep their entered qty)
      const partialItems = items.filter((i) => i.completed_quantity > 0 && i.status !== 'completed');
      for (const item of partialItems) {
        await supabase
          .from('job_card_items')
          .update({ status: 'completed', completion_time: new Date().toISOString() })
          .eq('item_id', item.item_id);
      }
      await syncAssignmentStatus('completed');
      setJobCard((prev) => prev ? { ...prev, status: 'completed' } : prev);
      setItems((prev) => prev.map((i) => ({
        ...i,
        completed_quantity: i.completed_quantity === 0 ? i.quantity : i.completed_quantity,
        status: 'completed',
      })));
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
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
        <MobileScanLogin />
      </Suspense>
    );
  }

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
      <div className="sticky top-0 z-10 border-b bg-background/95 px-8 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Job Card #{jobCard.job_card_id}</h1>
            {jobCard.orders && (
              <button
                type="button"
                onClick={handleViewOrder}
                className="flex items-center gap-1 text-sm text-muted-foreground active:opacity-70"
              >
                <span className="underline decoration-muted-foreground/50 underline-offset-2">
                  Order #{jobCard.orders.order_number}
                </span>
                {jobCard.orders.customers ? <span> · {jobCard.orders.customers.name}</span> : null}
                <ExternalLink className="ml-0.5 h-3 w-3 shrink-0" />
              </button>
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

      <div className="space-y-4 px-8 pt-4">
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

        {/* ── Scan Another ─────────────────────── */}
        <button
          type="button"
          onClick={() => setShowScanner(true)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-muted-foreground/25 text-sm font-medium text-muted-foreground active:scale-[0.98]"
        >
          <ScanLine className="h-4 w-4" />
          Scan another job card
        </button>
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

      {/* ── Document Picker (multiple attachments) ── */}
      {showDocPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="w-full max-w-lg rounded-t-2xl bg-background p-6 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Customer Order Documents</h3>
              <button type="button" onClick={() => setShowDocPicker(false)} className="rounded-lg p-1 active:scale-95">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-2">
              {orderDocs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    window.open(doc.file_url, '_blank');
                    setShowDocPicker(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left active:scale-[0.98]"
                >
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{doc.file_name}</span>
                  <ExternalLink className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── QR Scanner ─────────────────────────────── */}
      {showScanner && (
        <QrScannerOverlay onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}

// ── QR Scanner Component ──────────────────────────────────────────
function QrScannerOverlay({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  // null = still trying, true = live camera, false = fallback
  const [useLiveCamera, setUseLiveCamera] = useState<boolean | null>(null);

  // Step 1: Try to get camera stream
  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setUseLiveCamera(true);
      })
      .catch(() => {
        if (!cancelled) setUseLiveCamera(false);
      });

    return () => {
      cancelled = true;
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Step 2: Once live camera is active AND video element is mounted, connect them
  useEffect(() => {
    if (!useLiveCamera || !streamRef.current) return;
    let cancelled = false;
    let animFrame: number;

    const connectVideo = async () => {
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = streamRef.current;
      await video.play();
      scanLoop();
    };

    const scanLoop = () => {
      if (cancelled || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState < video.HAVE_ENOUGH_DATA) {
        animFrame = requestAnimationFrame(scanLoop);
        return;
      }

      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        detector.detect(video).then((barcodes: any[]) => {
          if (cancelled) return;
          if (barcodes.length > 0) {
            handleResult(barcodes[0].rawValue);
            return;
          }
          animFrame = requestAnimationFrame(scanLoop);
        }).catch(() => {
          if (!cancelled) animFrame = requestAnimationFrame(scanLoop);
        });
      } else {
        setScanError('QR scanning not supported on this browser.');
      }
    };

    connectVideo();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animFrame);
    };
  }, [useLiveCamera]);

  const handleResult = (rawValue: string) => {
    const match = rawValue.match(/\/scan\/jc\/(\d+)/);
    if (match) {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      window.location.href = `/scan/jc/${match[1]}`;
    } else if (rawValue.startsWith('http')) {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      window.location.href = rawValue;
    } else {
      setScanError('Not a valid job card QR code. Try again.');
    }
  };

  // File input fallback — user takes photo with native camera, we decode QR from it
  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);
    setDecoding(true);

    try {
      const bitmap = await createImageBitmap(file);

      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(bitmap);
        if (barcodes.length > 0) {
          handleResult(barcodes[0].rawValue);
          return;
        }
      }

      setScanError('No QR code found in photo. Try again — make sure the QR code is clear and well-lit.');
    } catch {
      setScanError('Could not read the photo. Please try again.');
    } finally {
      setDecoding(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Loading (waiting for camera permission) ──
  if (useLiveCamera === null) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-lg font-bold text-white">Scan Job Card</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-white active:scale-95">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
          <p className="text-sm text-white/60">Starting camera...</p>
        </div>
      </div>
    );
  }

  // ── Live camera view ──
  if (useLiveCamera) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-lg font-bold text-white">Scan Job Card</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-white active:scale-95">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="relative flex flex-1 items-center justify-center">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-56 rounded-2xl border-2 border-white/60" />
          </div>
        </div>
        {scanError && (
          <div className="px-6 py-4 text-center text-sm text-red-400">{scanError}</div>
        )}
        <div className="px-6 pb-8 pt-4 text-center text-sm text-white/60">
          Point camera at a job card QR code
        </div>
      </div>
    );
  }

  // ── File input fallback (HTTP / camera denied) ──
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-bold text-white">Scan Job Card</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-white active:scale-95">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
        <ScanLine className="h-16 w-16 text-white/40" />
        <p className="text-center text-white/70">
          Take a photo of the job card QR code
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileCapture}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={decoding}
          className="flex h-14 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-white text-lg font-semibold text-black active:scale-[0.98] disabled:opacity-50"
        >
          {decoding ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <FileImage className="h-5 w-5" />
          )}
          {decoding ? 'Reading QR...' : 'Open Camera'}
        </button>
        {scanError && (
          <p className="text-center text-sm text-red-400">{scanError}</p>
        )}
      </div>
      <div className="px-6 pb-8 pt-4 text-center text-xs text-white/40">
        Camera opens your phone&apos;s camera app to take a photo
      </div>
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
