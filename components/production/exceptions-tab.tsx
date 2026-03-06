'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchProductionExceptions, type ExceptionJob, type PoolException } from '@/lib/queries/production-exceptions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, AlertTriangle, PauseCircle, TrendingDown, Play, Eye, CheckCircle, Package } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

function ExceptionCard({ job, type }: { job: ExceptionJob; type: 'overdue' | 'paused' | 'behind' }) {
  const router = useRouter();

  const statusColors = {
    overdue: 'border-red-500/30 bg-red-500/5',
    paused: 'border-yellow-500/30 bg-yellow-500/5',
    behind: 'border-amber-500/30 bg-amber-500/5',
  };

  return (
    <Card className={`${statusColors[type]}`}>
      <CardContent className="flex items-center justify-between py-3 px-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{job.job_name}</span>
            {job.order_number && (
              <Badge variant="outline" className="text-xs shrink-0">
                {job.order_number}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{job.staff_name}</span>
            {job.section_name && (
              <>
                <span className="text-muted-foreground/50">|</span>
                <span>{job.section_name}</span>
              </>
            )}
            {type === 'overdue' && job.minutes_elapsed > 0 && (
              <>
                <span className="text-muted-foreground/50">|</span>
                <span className="text-red-400">
                  {Math.round(job.minutes_elapsed)}m elapsed / {Math.round(job.estimated_minutes)}m est.
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => router.push('/production?view=floor')}
          >
            <Eye className="h-3 w-3 mr-1" />
            Floor
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ExceptionSection({
  title,
  icon: Icon,
  jobs,
  type,
  iconColor,
}: {
  title: string;
  icon: React.ElementType;
  jobs: ExceptionJob[];
  type: 'overdue' | 'paused' | 'behind';
  iconColor: string;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="secondary" className="text-xs">
          {jobs.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {jobs.map((job) => (
          <ExceptionCard key={job.assignment_id} job={job} type={type} />
        ))}
      </div>
    </div>
  );
}

// ── Pool Exception Card ──────────────────────────────────────────────────────

function PoolExceptionCard({ exception }: { exception: PoolException }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [resolveOpen, setResolveOpen] = useState(false);

  const acknowledgeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('acknowledge_work_pool_exception', {
        p_exception_id: exception.exception_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-exceptions'] });
      toast.success('Exception acknowledged');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to acknowledge'),
  });

  const typeLabel = exception.exception_type === 'over_issued_override'
    ? 'Over-Issued (Override)'
    : 'Over-Issued (Reconcile)';

  return (
    <>
      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardContent className="flex items-center justify-between py-3 px-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">
                {exception.job_name ?? 'Pool Job'}
              </span>
              {exception.order_number && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {exception.order_number}
                </Badge>
              )}
              <Badge variant="destructive" className="text-xs shrink-0">
                Variance: {exception.variance_qty > 0 ? '+' : ''}{exception.variance_qty}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{typeLabel}</span>
              <span className="text-muted-foreground/50">|</span>
              <span>Required: {exception.required_qty_snapshot} / Issued: {exception.issued_qty_snapshot}</span>
              {exception.product_name && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <span>{exception.product_name}</span>
                </>
              )}
              {exception.status === 'acknowledged' && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <span className="text-blue-400">Acknowledged</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {exception.status === 'open' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => acknowledgeMutation.mutate()}
                disabled={acknowledgeMutation.isPending}
              >
                <Eye className="h-3 w-3 mr-1" />
                Acknowledge
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setResolveOpen(true)}
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              Resolve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => router.push(`/orders/${exception.order_id}?tab=job-cards`)}
            >
              Order
            </Button>
          </div>
        </CardContent>
      </Card>
      {resolveOpen && (
        <ResolveExceptionDialog
          exception={exception}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
        />
      )}
    </>
  );
}

// ── Resolve Exception Dialog ─────────────────────────────────────────────────

function ResolveExceptionDialog({
  exception,
  open,
  onOpenChange,
}: {
  exception: PoolException;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [resolutionType, setResolutionType] = useState<string>('');
  const [notes, setNotes] = useState('');

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('resolve_work_pool_exception', {
        p_exception_id: exception.exception_id,
        p_resolution_type: resolutionType,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-exceptions'] });
      toast.success('Exception resolved');
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Failed to resolve'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve Exception</DialogTitle>
          <DialogDescription>
            {exception.job_name ?? 'Pool Job'} — Variance: {exception.variance_qty > 0 ? '+' : ''}{exception.variance_qty} units
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Resolution Action</label>
            <Select value={resolutionType} onValueChange={setResolutionType}>
              <SelectTrigger>
                <SelectValue placeholder="Select resolution..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cancel_unstarted_cards">Cancel unstarted cards</SelectItem>
                <SelectItem value="move_excess_to_stock">Move excess to stock</SelectItem>
                <SelectItem value="accept_overproduction_rework">Accept overproduction / rework</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Notes (optional)</label>
            <Textarea
              rows={2}
              placeholder="Additional context..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending || !resolutionType}
          >
            {resolveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pool Exception Section ───────────────────────────────────────────────────

function PoolExceptionSection({ exceptions }: { exceptions: PoolException[] }) {
  if (exceptions.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold">Work Pool Exceptions</h3>
        <Badge variant="secondary" className="text-xs">
          {exceptions.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {exceptions.map((ex) => (
          <PoolExceptionCard key={ex.exception_id} exception={ex} />
        ))}
      </div>
    </div>
  );
}

export function ExceptionsTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['production-exceptions'],
    queryFn: fetchProductionExceptions,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-destructive">
        Failed to load exceptions: {error.message}
      </div>
    );
  }

  const { overdue = [], paused = [], behind = [], poolExceptions = [] } = data ?? {};
  const totalCount = overdue.length + paused.length + behind.length + poolExceptions.length;

  if (totalCount === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No exceptions right now. All jobs are on track.
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <ExceptionSection
        title="Overdue"
        icon={AlertTriangle}
        jobs={overdue}
        type="overdue"
        iconColor="text-red-400"
      />
      <ExceptionSection
        title="Paused"
        icon={PauseCircle}
        jobs={paused}
        type="paused"
        iconColor="text-yellow-400"
      />
      <ExceptionSection
        title="At Risk"
        icon={TrendingDown}
        jobs={behind}
        type="behind"
        iconColor="text-amber-400"
      />
      <PoolExceptionSection exceptions={poolExceptions} />
    </div>
  );
}
