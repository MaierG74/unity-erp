'use client';

import { useState, useMemo, useCallback } from 'react';
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
} from 'lucide-react';

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
  jobs: { name: string } | null;
  products: { name: string } | null;
}

interface StaffOption {
  staff_id: number;
  first_name: string;
  last_name: string;
}

interface JobCardsTabProps {
  orderId: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ReactNode }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: 'In Progress', variant: 'default', icon: <PlayCircle className="h-3 w-3" /> },
  completed: { label: 'Completed', variant: 'outline', icon: <CheckCircle className="h-3 w-3 text-green-500" /> },
};

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
  const { data: workPool = [] } = useQuery({
    queryKey: ['orderWorkPool', orderId],
    queryFn: async () => {
      // Query base table with joins (view FK resolution can be unreliable)
      const { data: poolRows, error } = await supabase
        .from('job_work_pool')
        .select(`
          pool_id, order_id, product_id, job_id, bol_id, order_detail_id,
          required_qty, pay_type, piece_rate, piece_rate_id, hourly_rate_id,
          time_per_unit, source, status,
          jobs:job_id(name),
          products:product_id(name)
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
        .select('work_pool_id, quantity, completed_quantity, status, job_cards!inner(status)')
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
        return {
          ...row,
          issued_qty: agg.issued,
          completed_qty: agg.completed,
          remaining_qty: row.required_qty - agg.issued,
        } as WorkPoolRow;
      });
    },
  });

  // ── Stale pool detection ──────────────────────────────────────────────
  interface StalePoolRow {
    pool_id: number;
    job_name: string | null;
    product_name: string | null;
    pool_required: number;
    current_required: number;
    issued_qty: number;
    diff: number;
  }

  const { data: staleItems = [] } = useQuery<StalePoolRow[]>({
    queryKey: ['orderPoolStaleCheck', orderId],
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
    enabled: workPool.length > 0,
  });

  // ── Reconciliation mutation ─────────────────────────────────────────────
  const reconcileMutation = useMutation({
    mutationFn: async (items: StalePoolRow[]) => {
      for (const item of items) {
        const { error } = await supabase
          .from('job_work_pool')
          .update({
            required_qty: item.current_required,
            updated_at: new Date().toISOString(),
          })
          .eq('pool_id', item.pool_id);
        if (error) throw error;
      }
      return items.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderPoolStaleCheck', orderId] });
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
          <Button variant="outline" size="sm" onClick={() => setGenerateBOLOpen(true)}>
            <Wand2 className="h-4 w-4 mr-2" />
            Generate from BOL
          </Button>
          <Button size="sm" onClick={() => setAddJobOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Job
          </Button>
        </div>
      </div>

      {/* Stale Pool Warning */}
      {staleItems.length > 0 && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-950/20 text-amber-200 [&>svg]:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Work pool out of date</AlertTitle>
          <AlertDescription>
            <p className="text-sm mb-2">
              Order quantities have changed since the work pool was generated.
            </p>
            <div className="space-y-1 text-sm mb-3">
              {staleItems.map((s) => (
                <div key={s.pool_id} className="flex items-center gap-2">
                  <span className="font-medium">{s.job_name ?? 'Job'}</span>
                  {s.product_name && <span className="text-muted-foreground">({s.product_name})</span>}
                  <span>
                    Pool: {s.pool_required} → Current: {s.current_required}
                  </span>
                  {s.current_required < s.issued_qty && (
                    <Badge variant="destructive" className="ml-1">
                      Over-issued by {s.issued_qty - s.current_required}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/50 hover:bg-amber-500/20"
              onClick={() => reconcileMutation.mutate(staleItems)}
              disabled={reconcileMutation.isPending}
            >
              {reconcileMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Update Pool
            </Button>
          </AlertDescription>
        </Alert>
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
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {workPool.map((row) => {
                  const exception = exceptionByPoolId.get(row.pool_id);
                  return (
                  <TableRow key={row.pool_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {row.jobs?.name ?? 'Unknown'}
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
                    <TableCell className="text-muted-foreground">{row.products?.name ?? '-'}</TableCell>
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
    refetch,
  } = useQuery({
    queryKey: ['orderBOLPreview', orderId],
    queryFn: async (): Promise<BOLPreviewItem[]> => {
      // Get order details with products and their BOL entries
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
              jobs:job_id(job_id, name)
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

          // Lookup piece rate if configured
          let pieceRate: number | null = null;
          if (bol.piece_rate_id) {
            const { data: rateData } = await supabase
              .from('piece_work_rates')
              .select('rate')
              .eq('rate_id', bol.piece_rate_id)
              .single();
            pieceRate = rateData?.rate ? Number(rateData.rate) : null;
          }

          // Compute time_per_unit in minutes from BOL time_required + time_unit
          let timePerUnit: number | null = null;
          if (bol.time_required) {
            const raw = Number(bol.time_required);
            if (bol.time_unit === 'hours') timePerUnit = raw * 60;
            else if (bol.time_unit === 'seconds') timePerUnit = raw / 60;
            else timePerUnit = raw; // minutes (default)
          }

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
    },
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
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
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
                      <Badge variant="outline">{item.pay_type}</Badge>
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
          <DialogTitle>Issue Job Card</DialogTitle>
          <DialogDescription>
            Create a job card from the work pool for &quot;{pool.jobs?.name ?? 'Unknown'}&quot;
            {pool.products?.name ? ` — ${pool.products.name}` : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Read-only pool info */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Required</span>
              <p className="font-medium">{pool.required_qty}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Already Issued</span>
              <p className="font-medium">{pool.issued_qty}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Remaining</span>
              <p className="font-medium">{pool.remaining_qty}</p>
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label>Quantity to Issue</Label>
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

          {/* Staff picker */}
          <div className="space-y-2">
            <Label>Assign to Staff (optional)</Label>
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
      </DialogContent>
    </Dialog>
  );
}
