'use client';

import { useState, useMemo } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Plus,
  Wand2,
  Loader2,
  Trash2,
  ClipboardList,
  CheckCircle,
  Clock,
  PlayCircle,
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

async function getOrCreateUnassignedJobCard(orderId: number): Promise<number> {
  // Look for an existing unassigned job card for this order
  const { data: existing, error: fetchErr } = await supabase
    .from('job_cards')
    .select('job_card_id')
    .eq('order_id', orderId)
    .is('staff_id', null)
    .eq('status', 'pending')
    .limit(1);

  if (fetchErr) throw fetchErr;

  if (existing && existing.length > 0) {
    return existing[0].job_card_id;
  }

  // Create a new unassigned job card
  const { data: newCard, error: createErr } = await supabase
    .from('job_cards')
    .insert({
      order_id: orderId,
      staff_id: null,
      issue_date: new Date().toISOString().split('T')[0],
      status: 'pending',
    })
    .select('job_card_id')
    .single();

  if (createErr) throw createErr;
  return newCard.job_card_id;
}

// ── Main Component ──────────────────────────────────────────────────────────────

export function JobCardsTab({ orderId }: JobCardsTabProps) {
  const queryClient = useQueryClient();
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [generateBOLOpen, setGenerateBOLOpen] = useState(false);

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

      {/* Jobs Table */}
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
      const qty = parseInt(quantity) || 1;
      const jobCardId = await getOrCreateUnassignedJobCard(orderId);

      const { error } = await supabase.from('job_card_items').insert({
        job_card_id: jobCardId,
        job_id: parseInt(selectedJobId),
        product_id: null,
        quantity: qty,
        completed_quantity: 0,
        piece_rate: pieceRate ? parseFloat(pieceRate) : null,
        status: 'pending',
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderJobCardItems', orderId] });
      toast.success('Job added to order');
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
          <DialogTitle>Add Job to Order</DialogTitle>
          <DialogDescription>
            Add a job manually to this order. Staff assignment can be done later.
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
              Add Job
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

          preview.push({
            job_id: job.job_id,
            job_name: job.name,
            product_id: product.product_id,
            product_name: product.name,
            quantity: totalQty,
            pay_type: bol.pay_type || 'hourly',
            piece_rate: pieceRate,
          });
        }
      }

      return preview;
    },
    enabled: open,
  });

  const generateMutation = useMutation({
    mutationFn: async (items: BOLPreviewItem[]) => {
      const jobCardId = await getOrCreateUnassignedJobCard(orderId);

      // Fetch existing items on this card to deduplicate
      const { data: existingItems } = await supabase
        .from('job_card_items')
        .select('job_id, product_id')
        .eq('job_card_id', jobCardId);
      const existingKeys = new Set(
        (existingItems ?? []).map((e) => `${e.job_id ?? 0}:${e.product_id ?? 0}`),
      );

      const newItems = items.filter(
        (item) => !existingKeys.has(`${item.job_id ?? 0}:${item.product_id ?? 0}`),
      );

      if (newItems.length === 0) {
        throw new Error('All BOL items already exist on this job card');
      }

      const inserts = newItems.map((item) => ({
        job_card_id: jobCardId,
        job_id: item.job_id,
        product_id: item.product_id,
        quantity: item.quantity,
        completed_quantity: 0,
        piece_rate: item.piece_rate,
        status: 'pending' as const,
      }));

      const { error } = await supabase.from('job_card_items').insert(inserts);
      if (error) throw error;
      return inserts.length;
    },
    onSuccess: (insertedCount) => {
      queryClient.invalidateQueries({ queryKey: ['orderJobCardItems', orderId] });
      toast.success(`Generated ${insertedCount} job${insertedCount !== 1 ? 's' : ''} from BOL`);
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to generate jobs from BOL');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate Jobs from Bill of Labour</DialogTitle>
          <DialogDescription>
            Preview jobs that will be created based on this order&apos;s products&apos; Bill of Labour
            configurations.
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
            Generate {bolPreview.length} Job{bolPreview.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
