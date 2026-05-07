'use client';

import { useState, useMemo } from 'react';
import NextImage from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Plus,
  Wand2,
  Loader2,
  Trash2,
  ClipboardList,
  CheckCircle,
  Clock,
  PlayCircle,
  AlertTriangle,
  Send,
  RefreshCw,
  Info,
} from 'lucide-react';
import type { OrderDetailDrawing, ResolvedDrawingSource } from '@/types/drawings';
import {
  deleteOrderDetailDrawing,
  listOrderDetailDrawings,
  uploadOrderDetailDrawing,
} from '@/lib/db/order-detail-drawings';
import { validateImageFile } from '@/lib/db/bol-drawings';

// ── Types ───────────────────────────────────────────────────────────────────────

interface JobCardItemRow {
  item_id: number;
  job_card_id: number;
  product_id: number | null;
  job_id: number | null;
  quantity: number;
  completed_quantity: number;
  piece_rate: number | null;
  status: string;
  notes: string | null;
  drawing_url: string | null;
  jobs: { job_id: number; name: string } | null;
  products: { product_id: number; name: string } | null;
  // Denormalized from parent job_card
  staff_name: string | null;
}

interface JobOption {
  job_id: number;
  name: string;
  job_categories: { name: string } | null;
}

interface BOLPreviewItem {
  job_id: number;
  job_name: string;
  product_id: number;
  product_name: string;
  quantity: number;
  pay_type: string;
  piece_rate: number | null;
  order_detail_id: number;
  bol_id: number;
  piece_rate_id: number | null;
  hourly_rate_id: number | null;
  time_per_unit: number | null;
}

interface WorkPoolRow {
  pool_id: number;
  order_id: number;
  product_id: number | null;
  job_id: number | null;
  bol_id: number | null;
  order_detail_id: number | null;
  required_qty: number;
  issued_qty: number;
  completed_qty: number;
  remaining_qty: number;
  pay_type: string;
  piece_rate: number | null;
  piece_rate_id: number | null;
  hourly_rate_id: number | null;
  time_per_unit: number | null;
  source: string;
  status: string;
  // Cutting-plan-source rows (POL-94) carry these in place of `job_id` /
  // `product_id`. The Work Pool table renders the activity label + material
  // label so they no longer fall through to "Unknown".
  material_color_label: string | null;
  piecework_activity_id: string | null;
  cutting_plan_run_id: number | null;
  jobs: { name: string } | null;
  products: { name: string } | null;
  piecework_activities: { code: string; label: string | null } | null;
}

interface DrawingContext {
  overrides: OrderDetailDrawing[];
  bolById: Map<number, { drawing_url: string | null; use_product_drawing: boolean }>;
  productById: Map<number, { configurator_drawing_url: string | null }>;
}

interface StaffOption {
  staff_id: number;
  first_name: string;
  last_name: string;
}

interface JobCardsTabProps {
  orderId: number;
}

interface StalePoolRow {
  pool_id: number;
  job_name: string | null;
  product_name: string | null;
  pool_required: number;
  current_required: number;
  issued_qty: number;
  diff: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ReactNode }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: 'In Progress', variant: 'default', icon: <PlayCircle className="h-3 w-3" /> },
  completed: { label: 'Completed', variant: 'outline', icon: <CheckCircle className="h-3 w-3 text-green-500" /> },
};

function normalizeOptionalNumber(value: number | null | undefined): number | null {
  return value == null ? null : Number(value);
}

function optionalNumbersEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  return normalizeOptionalNumber(a) === normalizeOptionalNumber(b);
}

function convertTimeToMinutes(value: number | string | null | undefined, unit?: string | null): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const normalizedUnit = (unit ?? 'hours').toLowerCase();
  if (normalizedUnit === 'minutes') return numeric;
  if (normalizedUnit === 'seconds') return numeric / 60;
  return numeric * 60;
}

function resolveTimePerUnitMinutes(
  explicitTime: number | string | null | undefined,
  explicitUnit: string | null | undefined,
  fallbackTime: number | string | null | undefined,
  fallbackUnit: string | null | undefined,
): number | null {
  return convertTimeToMinutes(explicitTime, explicitUnit) ?? convertTimeToMinutes(fallbackTime, fallbackUnit);
}

function resolvePoolTimePerUnitMinutes(
  poolTimePerUnit: number | string | null | undefined,
  fallbackTime: number | string | null | undefined,
  fallbackUnit: string | null | undefined,
): number | null {
  const explicitMinutes = poolTimePerUnit == null ? null : Number(poolTimePerUnit);
  return explicitMinutes ?? convertTimeToMinutes(fallbackTime, fallbackUnit);
}

function resolveDrawingForRow(
  row: { order_detail_id: number | null; bol_id: number | null; product_id: number | null },
  ctx: DrawingContext,
): ResolvedDrawingSource {
  if (row.order_detail_id != null && row.bol_id != null) {
    const override = ctx.overrides.find(
      (drawing) => drawing.order_detail_id === row.order_detail_id && drawing.bol_id === row.bol_id,
    );
    if (override) return { source: 'override', url: override.drawing_url };
  }

  if (row.bol_id == null) return null;
  const bol = ctx.bolById.get(row.bol_id);
  if (bol?.drawing_url) return { source: 'bol', url: bol.drawing_url };

  if (bol?.use_product_drawing && row.product_id != null) {
    const product = ctx.productById.get(row.product_id);
    if (product?.configurator_drawing_url) return { source: 'product', url: product.configurator_drawing_url };
  }

  return null;
}

async function fetchOrderBOLPreview(orderId: number): Promise<BOLPreviewItem[]> {
  const { data: orderDetails, error: odErr } = await supabase
    .from('order_details')
    .select(`
      order_detail_id,
      product_id,
      quantity,
      products:product_id(
        product_id,
        name,
        billoflabour(
          bol_id,
          job_id,
          quantity,
          pay_type,
          piece_rate_id,
          hourly_rate_id,
          time_required,
          time_unit,
          jobs:job_id(job_id, name, estimated_minutes, time_unit)
        )
      )
    `)
    .eq('order_id', orderId);

  if (odErr) throw odErr;
  if (!orderDetails || orderDetails.length === 0) return [];

  const preview: BOLPreviewItem[] = [];

  for (const detail of orderDetails) {
    const product = detail.products as any;
    if (!product) continue;

    const bolEntries = Array.isArray(product.billoflabour)
      ? product.billoflabour
      : [];

    for (const bol of bolEntries) {
      const job = bol.jobs as any;
      if (!job) continue;

      const orderQty = detail.quantity || 1;
      const bolQty = bol.quantity || 1;
      const totalQty = orderQty * bolQty;

      let pieceRate: number | null = null;
      if (bol.piece_rate_id) {
        const { data: rateData } = await supabase
          .from('piece_work_rates')
          .select('rate')
          .eq('rate_id', bol.piece_rate_id)
          .single();
        pieceRate = rateData?.rate ? Number(rateData.rate) : null;
      }

      const timePerUnit = resolveTimePerUnitMinutes(
        bol.time_required,
        bol.time_unit,
        job.estimated_minutes,
        job.time_unit,
      );

      preview.push({
        job_id: job.job_id,
        job_name: job.name,
        product_id: product.product_id,
        product_name: product.name,
        quantity: totalQty,
        pay_type: bol.pay_type || 'hourly',
        piece_rate: pieceRate,
        order_detail_id: detail.order_detail_id,
        bol_id: bol.bol_id,
        piece_rate_id: bol.piece_rate_id ?? null,
        hourly_rate_id: bol.hourly_rate_id ?? null,
        time_per_unit: timePerUnit,
      });
    }
  }

  return preview;
}

// ── Main Component ──────────────────────────────────────────────────────────────

export function JobCardsTab({ orderId }: JobCardsTabProps) {
  const queryClient = useQueryClient();
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [generateBOLOpen, setGenerateBOLOpen] = useState(false);
  const [issuePool, setIssuePool] = useState<WorkPoolRow | null>(null);

  // ── Fetch job card items for this order ───────────────────────────────────
  const { data: jobCardItems = [], isLoading } = useQuery({
    queryKey: ['orderJobCardItems', orderId],
    queryFn: async () => {
      // First get all job_cards for this order with staff info
      const { data: cards, error: cardsErr } = await supabase
        .from('job_cards')
        .select('job_card_id, staff_id, staff:staff_id(first_name, last_name)')
        .eq('order_id', orderId);

      if (cardsErr) throw cardsErr;
      if (!cards || cards.length === 0) return [];

      // Build a lookup from card_id → staff name
      const cardStaffMap = new Map<number, string | null>();
      for (const card of cards) {
        const s = card.staff as { first_name: string; last_name: string } | null;
        cardStaffMap.set(card.job_card_id, s ? `${s.first_name} ${s.last_name}`.trim() : null);
      }

      const cardIds = cards.map((c) => c.job_card_id);

      // Fetch items for those cards
      const { data, error } = await supabase
        .from('job_card_items')
        .select(`
          item_id,
          job_card_id,
          product_id,
          job_id,
          quantity,
          completed_quantity,
          piece_rate,
          status,
          notes,
          drawing_url,
          jobs:job_id(job_id, name),
          products:product_id(product_id, name)
        `)
        .in('job_card_id', cardIds)
        .order('item_id');

      if (error) throw error;

      // Denormalize staff name onto each item
      return (data || []).map((item) => ({
        ...item,
        staff_name: cardStaffMap.get(item.job_card_id) ?? null,
      })) as JobCardItemRow[];
    },
  });

  // ── Fetch jobs for the picker ─────────────────────────────────────────────
  const { data: jobOptions = [] } = useQuery({
    queryKey: ['jobs', 'forPicker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('job_id, name, job_categories:category_id(name)')
        .order('name');
      if (error) throw error;
      return (data || []) as JobOption[];
    },
  });

  // ── Fetch work pool for this order ──────────────────────────────────────
  const { data: workPool = [] } = useQuery<WorkPoolRow[]>({
    queryKey: ['orderWorkPool', orderId],
    queryFn: async () => {
      // Query base table with joins (view FK resolution can be unreliable).
      // material_color_label, piecework_activity_id, cutting_plan_run_id and
      // the piecework_activities join are needed for cutting_plan-source
      // rows (POL-94). Without them, the Work Pool table can only render
      // BOL-derived rows; the cutting_plan rows fall back to "Unknown".
      const { data: poolRows, error } = await supabase
        .from('job_work_pool')
        .select(`
          pool_id, order_id, product_id, job_id, bol_id, order_detail_id,
          required_qty, pay_type, piece_rate, piece_rate_id, hourly_rate_id,
          time_per_unit, source, status,
          material_color_label, piecework_activity_id, cutting_plan_run_id,
          jobs:job_id(name, estimated_minutes, time_unit),
          products:product_id(name),
          piecework_activities:piecework_activity_id(code, label)
        `)
        .eq('order_id', orderId)
        .neq('status', 'cancelled')
        .order('pool_id');
      if (error) throw error;
      if (!poolRows || poolRows.length === 0) return [];

      // Get issuance counts from job_card_items linked to these pool rows
      const poolIds = poolRows.map((r) => r.pool_id);
      const { data: issuanceData, error: issuanceErr } = await supabase
        .from('job_card_items')
        .select('work_pool_id, quantity, completed_quantity, status, drawing_url, job_cards!job_card_items_job_card_id_fkey(status)')
        .in('work_pool_id', poolIds);
      if (issuanceErr) throw issuanceErr;

      // Compute issued/completed per pool row (excluding cancelled cards/items)
      const issuanceMap = new Map<number, { issued: number; completed: number }>();
      for (const item of issuanceData ?? []) {
        const cardStatus = (item.job_cards as any)?.status;
        if (cardStatus === 'cancelled' || item.status === 'cancelled') continue;
        const pid = item.work_pool_id!;
        const cur = issuanceMap.get(pid) ?? { issued: 0, completed: 0 };
        cur.issued += item.quantity;
        cur.completed += item.completed_quantity;
        issuanceMap.set(pid, cur);
      }

      return poolRows.map((row) => {
        const agg = issuanceMap.get(row.pool_id) ?? { issued: 0, completed: 0 };
        const job = row.jobs as { estimated_minutes?: number | null; time_unit?: string | null } | null;
        return {
          ...row,
          time_per_unit: resolvePoolTimePerUnitMinutes(
            row.time_per_unit,
            job?.estimated_minutes,
            job?.time_unit,
          ),
          issued_qty: agg.issued,
          completed_qty: agg.completed,
          remaining_qty: row.required_qty - agg.issued,
        } as WorkPoolRow;
      });
    },
  });

  const { data: orgId } = useQuery({
    queryKey: ['currentOrgId'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();
      if (error) throw error;
      return data.org_id as string;
    },
  });

  const { data: drawingContext } = useQuery<DrawingContext>({
    queryKey: ['order-drawing-context', orderId, workPool.map((row) => row.pool_id).join(',')],
    queryFn: async () => {
      const overrides = await listOrderDetailDrawings(orderId);
      const bolIds = [...new Set(workPool.map((row) => row.bol_id).filter((id): id is number => id != null))];
      const productIds = [...new Set(workPool.map((row) => row.product_id).filter((id): id is number => id != null))];

      const bolById = new Map<number, { drawing_url: string | null; use_product_drawing: boolean }>();
      if (bolIds.length > 0) {
        const { data, error } = await supabase
          .from('billoflabour')
          .select('bol_id, drawing_url, use_product_drawing')
          .in('bol_id', bolIds);
        if (error) throw error;
        for (const row of data ?? []) {
          bolById.set(Number(row.bol_id), {
            drawing_url: row.drawing_url ?? null,
            use_product_drawing: Boolean(row.use_product_drawing),
          });
        }
      }

      const productById = new Map<number, { configurator_drawing_url: string | null }>();
      if (productIds.length > 0) {
        const { data, error } = await supabase
          .from('products')
          .select('product_id, configurator_drawing_url')
          .in('product_id', productIds);
        if (error) throw error;
        for (const row of data ?? []) {
          productById.set(Number(row.product_id), {
            configurator_drawing_url: row.configurator_drawing_url ?? null,
          });
        }
      }

      return { overrides, bolById, productById };
    },
    enabled: workPool.length > 0,
  });

  const staleCheckDeps = useMemo(
    () =>
      workPool
        .filter((p) => p.source === 'bol' && p.bol_id != null && p.order_detail_id != null)
        .map((p) => ({
          pool_id: p.pool_id,
          bol_id: p.bol_id,
          order_detail_id: p.order_detail_id,
          required_qty: p.required_qty,
          issued_qty: p.issued_qty,
        })),
    [workPool],
  );

  const { data: bolSync = { hasBolRows: false, isInSync: false } } = useQuery({
    queryKey: ['orderBolSync', orderId, staleCheckDeps],
    queryFn: async () => {
      const bolPreview = await fetchOrderBOLPreview(orderId);
      if (bolPreview.length === 0) {
        return { hasBolRows: false, isInSync: false };
      }

      const bolPool = workPool.filter((row) => row.source === 'bol' && row.bol_id != null && row.order_detail_id != null);
      const previewByKey = new Map(
        bolPreview.map((item) => [`${item.order_detail_id}:${item.bol_id}`, item] as const),
      );
      const poolByKey = new Map(
        bolPool.map((row) => [`${row.order_detail_id}:${row.bol_id}`, row] as const),
      );

      if (previewByKey.size !== poolByKey.size) {
        return { hasBolRows: true, isInSync: false };
      }

      for (const [key, item] of previewByKey) {
        const poolRow = poolByKey.get(key);
        if (!poolRow) return { hasBolRows: true, isInSync: false };

        const isRowInSync =
          poolRow.required_qty === item.quantity &&
          poolRow.pay_type === item.pay_type &&
          optionalNumbersEqual(poolRow.piece_rate, item.piece_rate) &&
          optionalNumbersEqual(poolRow.piece_rate_id, item.piece_rate_id) &&
          optionalNumbersEqual(poolRow.hourly_rate_id, item.hourly_rate_id) &&
          optionalNumbersEqual(poolRow.time_per_unit, item.time_per_unit);

        if (!isRowInSync) {
          return { hasBolRows: true, isInSync: false };
        }
      }

      return { hasBolRows: true, isInSync: true };
    },
    enabled: workPool.length > 0,
  });

  const isBolGenerateDisabled = bolSync.hasBolRows && bolSync.isInSync;

  // ── Stale pool detection ──────────────────────────────────────────────
  const { data: staleItems = [] } = useQuery<StalePoolRow[]>({
    // Include the current pool snapshot in the key because the stale check is derived from it.
    queryKey: ['orderPoolStaleCheck', orderId, staleCheckDeps],
    queryFn: async () => {
      // Only check BOL-sourced pool rows (manual ones don't drift)
      const bolPool = workPool.filter((p) => p.source === 'bol' && p.bol_id != null && p.order_detail_id != null);
      if (bolPool.length === 0) return [];

      // Fetch current order_details + BOL quantities
      const detailIds = [...new Set(bolPool.map((p) => p.order_detail_id!))];
      const { data: details, error } = await supabase
        .from('order_details')
        .select(`
          order_detail_id,
          quantity,
          products:product_id(
            billoflabour(bol_id, quantity)
          )
        `)
        .in('order_detail_id', detailIds);
      if (error) throw error;

      // Build a lookup: bol_id → current total qty (order_detail.qty × bol.qty)
      const currentQtyByBol = new Map<number, number>();
      for (const detail of details ?? []) {
        const product = detail.products as any;
        const bols = Array.isArray(product?.billoflabour) ? product.billoflabour : [];
        for (const bol of bols) {
          currentQtyByBol.set(bol.bol_id, (detail.quantity || 1) * (bol.quantity || 1));
        }
      }

      // Compare against pool required_qty
      const stale: StalePoolRow[] = [];
      for (const row of bolPool) {
        const currentReq = currentQtyByBol.get(row.bol_id!) ?? 0;
        if (currentReq !== row.required_qty) {
          stale.push({
            pool_id: row.pool_id,
            job_name: row.jobs?.name ?? null,
            product_name: row.products?.name ?? null,
            pool_required: row.required_qty,
            current_required: currentReq,
            issued_qty: row.issued_qty,
            diff: currentReq - row.required_qty,
          });
        }
      }
      return stale;
    },
    enabled: staleCheckDeps.length > 0,
  });

  // ── Reconciliation mutation ─────────────────────────────────────────────
  const reconcileMutation = useMutation({
    mutationFn: async (items: StalePoolRow[]) => {
      // Atomic reconciliation: updates required_qty + creates/resolves exceptions server-side
      const results = await Promise.all(
        items.map((item) =>
          supabase.rpc('reconcile_work_pool_row', {
            p_pool_id: item.pool_id,
            p_new_required_qty: item.current_required,
          })
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;

      return items.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderPoolStaleCheck', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderPoolExceptions', orderId] });
      toast.success(`Updated ${count} work pool row${count !== 1 ? 's' : ''} to match current demand`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update work pool');
    },
  });

  // ── Fetch active pool exceptions for this order ────────────────────────
  const { data: poolExceptions = [] } = useQuery({
    queryKey: ['orderPoolExceptions', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_work_pool_exceptions')
        .select('exception_id, work_pool_id, exception_type, status, variance_qty')
        .eq('order_id', orderId)
        .in('status', ['open', 'acknowledged']);
      if (error) throw error;
      return data ?? [];
    },
    enabled: workPool.length > 0,
  });

  const exceptionByPoolId = useMemo(() => {
    const map = new Map<number, { exception_type: string; status: string; variance_qty: number }>();
    for (const ex of poolExceptions) {
      map.set(ex.work_pool_id, ex);
    }
    return map;
  }, [poolExceptions]);

  // ── Fetch staff for issue dialog picker ─────────────────────────────────
  const { data: staffOptions = [] } = useQuery({
    queryKey: ['staff', 'forIssuePicker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name')
        .order('first_name');
      if (error) throw error;
      return (data ?? []) as StaffOption[];
    },
  });

  // ── Delete mutation ───────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const { error } = await supabase
        .from('job_card_items')
        .delete()
        .eq('item_id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderJobCardItems', orderId] });
      toast.success('Job removed from order');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to remove job');
    },
  });

  const uploadDrawingMutation = useMutation({
    mutationFn: async ({ row, file }: { row: WorkPoolRow; file: File }) => {
      if (!orgId) throw new Error('No organization');
      if (row.order_detail_id == null || row.bol_id == null) {
        throw new Error('Drawing overrides are only available for BOL work-pool rows');
      }
      validateImageFile(file);
      return uploadOrderDetailDrawing(file, row.order_detail_id, row.bol_id, orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-drawing-context'] });
      toast.success('Drawing override saved');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to save drawing override');
    },
  });

  const removeDrawingMutation = useMutation({
    mutationFn: async (row: WorkPoolRow) => {
      if (row.order_detail_id == null || row.bol_id == null) return;
      await deleteOrderDetailDrawing(row.order_detail_id, row.bol_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-drawing-context'] });
      toast.success('Drawing override removed');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to remove drawing override');
    },
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = jobCardItems.length;
    const pending = jobCardItems.filter((i) => i.status === 'pending').length;
    const inProgress = jobCardItems.filter((i) => i.status === 'in_progress').length;
    const completed = jobCardItems.filter((i) => i.status === 'completed').length;
    const totalValue = jobCardItems.reduce(
      (sum, item) => sum + (item.piece_rate ? item.quantity * item.piece_rate : 0),
      0,
    );
    return { total, pending, inProgress, completed, totalValue };
  }, [jobCardItems]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">{summary.total}</strong> job{summary.total !== 1 ? 's' : ''}
          </span>
          {summary.pending > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {summary.pending} pending
            </Badge>
          )}
          {summary.inProgress > 0 && (
            <Badge variant="default" className="gap-1">
              <PlayCircle className="h-3 w-3" />
              {summary.inProgress} in progress
            </Badge>
          )}
          {summary.completed > 0 && (
            <Badge variant="outline" className="gap-1 border-green-500 text-green-500">
              <CheckCircle className="h-3 w-3" />
              {summary.completed} completed
            </Badge>
          )}
          {summary.totalValue > 0 && (
            <span>
              Est. value: <strong className="text-foreground">R {summary.totalValue.toFixed(2)}</strong>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={isBolGenerateDisabled ? 0 : -1}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setGenerateBOLOpen(true)}
                    disabled={isBolGenerateDisabled}
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate from BOL
                  </Button>
                </span>
              </TooltipTrigger>
              {isBolGenerateDisabled && (
                <TooltipContent>
                  Bill of Labor in sync already
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <Button size="sm" onClick={() => setAddJobOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Job
          </Button>
        </div>
      </div>

      {/* Stale Pool Warning */}
      {staleItems.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-amber-100/80 dark:bg-amber-900/40 border-b border-amber-500/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Work pool out of date
              </span>
              <span className="text-xs text-amber-700/70 dark:text-amber-400/60">
                — quantities have changed since the pool was generated
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-500/40 bg-white/60 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60"
              onClick={() => reconcileMutation.mutate(staleItems)}
              disabled={reconcileMutation.isPending}
            >
              {reconcileMutation.isPending ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1.5" />
              )}
              Update Pool
            </Button>
          </div>
          {/* Mismatch table */}
          <div className="px-4 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-amber-700/60 dark:text-amber-400/50">
                  <th className="text-left font-medium py-1 pr-4">Job</th>
                  <th className="text-left font-medium py-1 pr-4">Product</th>
                  <th className="text-right font-medium py-1 pr-4">Pool Qty</th>
                  <th className="text-right font-medium py-1 pr-4">Current Qty</th>
                  <th className="text-right font-medium py-1">Diff</th>
                </tr>
              </thead>
              <tbody>
                {staleItems.map((s) => {
                  const diff = s.current_required - s.pool_required;
                  const overIssued = s.current_required < s.issued_qty;
                  return (
                    <tr key={s.pool_id} className="border-t border-amber-500/10">
                      <td className="py-1.5 pr-4 font-medium text-amber-900 dark:text-amber-100">
                        {s.job_name ?? 'Job'}
                      </td>
                      <td className="py-1.5 pr-4 text-amber-800/70 dark:text-amber-300/60">
                        {s.product_name || '—'}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-amber-800/70 dark:text-amber-300/60">
                        {s.pool_required}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums font-medium text-amber-900 dark:text-amber-100">
                        {s.current_required}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        <span className={diff > 0
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-red-600 dark:text-red-400'
                        }>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                        {overIssued && (
                          <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
                            over-issued
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Work Pool */}
      {workPool.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Work Pool</CardTitle>
            <CardDescription>
              Demand snapshot from Bill of Labour. Issue job cards from here.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead className="text-right">Piece Rate</TableHead>
                  <TableHead>Drawing</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {workPool.map((row) => {
                  const exception = exceptionByPoolId.get(row.pool_id);
                  // BOL-source rows have a job_id → row.jobs.name. Cutting-plan
                  // rows (POL-94) have piecework_activity_id + material_color_label
                  // and no job_id; fall back to those so they don't render as
                  // "Unknown - -". The activity label ('Cutting' / 'Edging')
                  // plus the material label ('16mm African Wenge / 16mm') gives
                  // enough context to issue the card.
                  const isCuttingPlan = row.source === 'cutting_plan';
                  const activityLabel =
                    row.piecework_activities?.label ??
                    (row.piecework_activities?.code === 'cut_pieces'
                      ? 'Cutting'
                      : row.piecework_activities?.code === 'edge_bundles'
                        ? 'Edging'
                        : null);
                  const jobLabel = isCuttingPlan
                    ? activityLabel ?? 'Cutlist'
                    : row.jobs?.name ?? 'Unknown';
                  const productLabel = isCuttingPlan
                    ? row.material_color_label ?? 'Cutlist (all products)'
                    : row.products?.name ?? '-';
                  const resolvedDrawing = drawingContext ? resolveDrawingForRow(row, drawingContext) : null;
                  const hasOverride = Boolean(
                    drawingContext?.overrides.some(
                      (drawing) => drawing.order_detail_id === row.order_detail_id && drawing.bol_id === row.bol_id,
                    ),
                  );
                  const canOverrideDrawing = row.order_detail_id != null && row.bol_id != null;
                  return (
                  <TableRow key={row.pool_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {jobLabel}
                        {isCuttingPlan && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            Cutlist
                          </Badge>
                        )}
                        {exception && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-1.5 py-0"
                          >
                            {exception.status === 'open' ? 'Exception' : 'Acknowledged'}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{productLabel}</TableCell>
                    <TableCell className="text-right">{row.required_qty}</TableCell>
                    <TableCell className="text-right">{row.issued_qty}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.remaining_qty > 0 ? (
                        row.remaining_qty
                      ) : row.remaining_qty < 0 ? (
                        <span className="text-destructive">{row.remaining_qty}</span>
                      ) : (
                        <span className="text-green-500">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.pay_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.piece_rate != null ? `R ${Number(row.piece_rate).toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[190px] items-start gap-2">
                        {resolvedDrawing ? (
                          <NextImage
                            src={resolvedDrawing.url}
                            alt=""
                            width={64}
                            height={48}
                            unoptimized
                            className="h-12 w-16 shrink-0 rounded border object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded border text-xs text-muted-foreground">
                            —
                          </div>
                        )}
                        <div className="space-y-1">
                          {resolvedDrawing ? (
                            <Badge variant="outline" className="text-[10px]">
                              {resolvedDrawing.source === 'override'
                                ? 'Order override'
                                : resolvedDrawing.source === 'bol'
                                  ? 'From BOL'
                                  : 'From product'}
                            </Badge>
                          ) : (
                            <span className="block text-xs text-muted-foreground">No drawing</span>
                          )}
                          {canOverrideDrawing && (
                            <div className="flex flex-wrap items-center gap-1">
                              <Label className="cursor-pointer text-xs text-primary">
                                {hasOverride ? 'Replace override' : 'Override drawing'}
                                <Input
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  className="sr-only"
                                  disabled={uploadDrawingMutation.isPending}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0] ?? null;
                                    event.target.value = '';
                                    if (!file) return;
                                    uploadDrawingMutation.mutate({ row, file });
                                  }}
                                />
                              </Label>
                              {hasOverride && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-xs"
                                  onClick={() => removeDrawingMutation.mutate(row)}
                                  disabled={removeDrawingMutation.isPending}
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          )}
                          {row.issued_qty > 0 && (
                            <span className="block text-[11px] text-muted-foreground">Already issued - won't affect printed cards</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.remaining_qty > 0 ? (
                        <Button size="sm" variant="outline" onClick={() => setIssuePool(row)}>
                          <Send className="h-3.5 w-3.5 mr-1.5" />
                          Issue Card
                        </Button>
                      ) : row.remaining_qty < 0 ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Over-issued by {Math.abs(row.remaining_qty)}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-green-500 text-green-500">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Fully Issued
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Issued Job Cards */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Piece Rate</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobCardItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
                    <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No jobs added to this order yet.</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click &quot;Add Job&quot; to manually add jobs, or &quot;Generate from BOL&quot; to
                      auto-populate from product labour configurations.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                jobCardItems.map((item) => {
                  const status = statusConfig[item.status] || statusConfig.pending;
                  const totalVal = item.piece_rate ? item.quantity * item.piece_rate : null;
                  const isStarted = item.status !== 'pending';

                  return (
                    <TableRow key={item.item_id}>
                      <TableCell className="font-medium">
                        {item.jobs?.name || 'Unknown Job'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.products?.name || '-'}
                      </TableCell>
                      <TableCell>
                        {item.staff_name ? (
                          <span className="text-foreground">{item.staff_name}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        <span className={item.completed_quantity >= item.quantity ? 'text-green-500 font-medium' : ''}>
                          {item.completed_quantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="gap-1">
                          {status.icon}
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.piece_rate != null ? `R ${Number(item.piece_rate).toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {totalVal != null ? `R ${totalVal.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell>
                        {!isStarted && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove job?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Remove &quot;{item.jobs?.name}&quot; from this order. This cannot be
                                  undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(item.item_id)}
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AddJobDialog
        orderId={orderId}
        open={addJobOpen}
        onOpenChange={setAddJobOpen}
        jobOptions={jobOptions}
      />
      <GenerateBOLDialog
        orderId={orderId}
        open={generateBOLOpen}
        onOpenChange={setGenerateBOLOpen}
      />
      {issuePool && (
        <IssueJobCardDialog
          orderId={orderId}
          pool={issuePool}
          staffOptions={staffOptions}
          open={!!issuePool}
          onOpenChange={(v) => { if (!v) setIssuePool(null); }}
        />
      )}
    </div>
  );
}

// ── Add Job Dialog ──────────────────────────────────────────────────────────────

function AddJobDialog({
  orderId,
  open,
  onOpenChange,
  jobOptions,
}: {
  orderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobOptions: JobOption[];
}) {
  const queryClient = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [pieceRate, setPieceRate] = useState<string>('');
  const [loadingRate, setLoadingRate] = useState(false);

  const resetForm = () => {
    setSelectedJobId('');
    setQuantity('1');
    setPieceRate('');
  };

  // Auto-fill piece rate when job is selected
  const handleJobChange = async (jobId: string) => {
    setSelectedJobId(jobId);
    if (!jobId) {
      setPieceRate('');
      return;
    }

    setLoadingRate(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('piece_work_rates')
        .select('rate')
        .eq('job_id', parseInt(jobId))
        .is('product_id', null)
        .lte('effective_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order('effective_date', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setPieceRate(Number(data[0].rate).toFixed(2));
      } else {
        setPieceRate('');
      }
    } catch {
      // Silently fail — user can still enter manually
    } finally {
      setLoadingRate(false);
    }
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: membership } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();
      if (!membership?.org_id) throw new Error('No organization');

      const qty = parseInt(quantity) || 1;
      const { error } = await supabase.from('job_work_pool').insert({
        org_id: membership.org_id,
        order_id: orderId,
        order_detail_id: null,
        product_id: null,
        job_id: parseInt(selectedJobId),
        bol_id: null,
        source: 'manual',
        required_qty: qty,
        pay_type: pieceRate ? 'piece' : 'hourly',
        piece_rate: pieceRate ? parseFloat(pieceRate) : null,
        status: 'active',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
      toast.success('Job added to work pool');
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to add job');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJobId) {
      toast.error('Please select a job');
      return;
    }
    if (!parseInt(quantity) || parseInt(quantity) < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }
    addMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Job to Work Pool</DialogTitle>
          <DialogDescription>
            Add a manual job to the work pool. Issue job cards from the pool after adding.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Job</Label>
            <Select value={selectedJobId} onValueChange={handleJobChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a job..." />
              </SelectTrigger>
              <SelectContent>
                {jobOptions.map((job) => (
                  <SelectItem key={job.job_id} value={job.job_id.toString()}>
                    {job.name}
                    {job.job_categories?.name && (
                      <span className="text-muted-foreground ml-2">({job.job_categories.name})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Piece Rate (optional)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              placeholder="e.g. 50.00"
              value={pieceRate}
              onChange={(e) => setPieceRate(e.target.value)}
              disabled={loadingRate}
            />
            <p className="text-xs text-muted-foreground">
              {loadingRate
                ? 'Looking up default rate...'
                : 'Auto-filled from job defaults. Edit or leave blank for hourly rates.'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addMutation.isPending || !selectedJobId}>
              {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add to Work Pool
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Generate from BOL Dialog ────────────────────────────────────────────────────

function GenerateBOLDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  // Fetch BOL preview when dialog opens
  const {
    data: bolPreview = [],
    isLoading: loadingPreview,
  } = useQuery({
    queryKey: ['orderBOLPreview', orderId],
    queryFn: () => fetchOrderBOLPreview(orderId),
    enabled: open,
  });

  const generateMutation = useMutation({
    mutationFn: async (items: BOLPreviewItem[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: membership } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();
      if (!membership?.org_id) throw new Error('No organization');

      // Insert or update each pool row individually to handle the partial unique index
      let count = 0;
      for (const item of items) {
        // Check if this BOL entry already exists in the pool
        const { data: existing } = await supabase
          .from('job_work_pool')
          .select('pool_id')
          .eq('order_detail_id', item.order_detail_id)
          .eq('bol_id', item.bol_id)
          .maybeSingle();

        if (existing) {
          // Update existing pool row with fresh snapshot
          const { error } = await supabase
            .from('job_work_pool')
            .update({
              required_qty: item.quantity,
              pay_type: item.pay_type,
              piece_rate: item.piece_rate,
              piece_rate_id: item.piece_rate_id,
              hourly_rate_id: item.hourly_rate_id,
              time_per_unit: item.time_per_unit,
              updated_at: new Date().toISOString(),
            })
            .eq('pool_id', existing.pool_id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('job_work_pool')
            .insert({
              org_id: membership.org_id,
              order_id: orderId,
              order_detail_id: item.order_detail_id,
              product_id: item.product_id,
              job_id: item.job_id,
              bol_id: item.bol_id,
              source: 'bol' as const,
              required_qty: item.quantity,
              pay_type: item.pay_type,
              piece_rate: item.piece_rate,
              piece_rate_id: item.piece_rate_id,
              hourly_rate_id: item.hourly_rate_id,
              time_per_unit: item.time_per_unit,
              status: 'active' as const,
            });
          if (error) throw error;
        }
        count++;
      }
      return count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderJobCardItems', orderId] });
      toast.success(`Added ${count} job${count !== 1 ? 's' : ''} to work pool`);
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to populate work pool');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Jobs to Work Pool from Bill of Labour</DialogTitle>
          <DialogDescription>
            Preview jobs from this order&apos;s Bill of Labour. These will be added to the work pool
            for issuing as job cards.
          </DialogDescription>
        </DialogHeader>

        {loadingPreview ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : bolPreview.length === 0 ? (
          <Alert>
            <AlertDescription>
              No Bill of Labour entries found for products on this order. Products may not have
              labour configurations set up yet, or this order may have no products added.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="my-4 max-h-96 overflow-auto rounded-md border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Job</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead className="text-right">Piece Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bolPreview.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.job_name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.product_name}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">{item.pay_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.piece_rate != null ? `R ${item.piece_rate.toFixed(2)}` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => generateMutation.mutate(bolPreview)}
            disabled={generateMutation.isPending || bolPreview.length === 0}
          >
            {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {bolPreview.length} to Work Pool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Issue Job Card Dialog ──────────────────────────────────────────────────────

function formatDurationFromMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function IssueJobCardDialog({
  orderId,
  pool,
  staffOptions,
  open,
  onOpenChange,
}: {
  orderId: number;
  pool: WorkPoolRow;
  staffOptions: StaffOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState<string>(String(pool.remaining_qty));
  const [staffId, setStaffId] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState('');

  const qty = parseInt(quantity) || 0;
  const isOverIssue = qty > pool.remaining_qty;
  const estimatedMinutes = pool.time_per_unit ? qty * pool.time_per_unit : null;

  const canSubmit =
    qty >= 1 && (!isOverIssue || overrideReason.trim().length > 0);

  const issueMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('issue_job_card_from_pool', {
        p_pool_id: pool.pool_id,
        p_quantity: qty,
        p_staff_id: staffId ? parseInt(staffId) : null,
        p_allow_overissue: isOverIssue,
        p_override_reason: isOverIssue ? overrideReason.trim() : null,
      });
      if (error) throw error;
      return { cardId: data, qty };
    },
    onSuccess: ({ cardId, qty: issuedQty }) => {
      queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderJobCardItems', orderId] });
      toast.success(`Issued job card #${cardId} for ${issuedQty} units`);
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to issue job card');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Issue Job Card</DialogTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p>Create a job card from the work pool for &quot;{
                    pool.source === 'cutting_plan'
                      ? (pool.piecework_activities?.label ?? pool.piecework_activities?.code ?? 'Cutlist')
                      : pool.jobs?.name ?? 'Unknown'
                  }&quot;{
                    pool.source === 'cutting_plan'
                      ? pool.material_color_label ? ` — ${pool.material_color_label}` : ''
                      : pool.products?.name ? ` — ${pool.products.name}` : ''
                  }.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DialogDescription className="sr-only">Issue a job card from the work pool</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Read-only pool info */}
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Pool Status</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Required</span>
                <p className="font-medium">{pool.required_qty}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Already Issued</span>
                <p className="font-medium">{pool.issued_qty}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Remaining</span>
                <p className="font-medium">{pool.remaining_qty}</p>
              </div>
            </div>
          </div>

          {/* Quantity & Staff */}
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Issuance Details</p>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quantity to Issue</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {estimatedMinutes != null && qty > 0 && (
                <p className="text-xs text-muted-foreground">
                  Estimated time: ~{formatDurationFromMinutes(estimatedMinutes)}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Assign to Staff (optional)</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned — assign later" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((s) => (
                    <SelectItem key={s.staff_id} value={s.staff_id.toString()}>
                      {s.first_name} {s.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Over-issuance warning */}
          {isOverIssue && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Over-issuance warning</p>
                <p className="text-sm">
                  You are issuing {qty - pool.remaining_qty} more than the remaining {pool.remaining_qty} units.
                  A production exception will be created and visible in the shared queue.
                </p>
                <div className="mt-2">
                  <Label className="text-destructive-foreground">Reason (required)</Label>
                  <Textarea
                    rows={2}
                    placeholder="Explain why this over-issuance is needed..."
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="border-t border-border/50 pt-4">
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => issueMutation.mutate()}
            disabled={issueMutation.isPending || !canSubmit}
            variant={isOverIssue ? 'destructive' : 'default'}
          >
            {issueMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isOverIssue ? 'Override & Issue Card' : 'Issue Job Card'}
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
