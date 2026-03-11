'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { minutesToClock, clockToMinutes } from '@/src/lib/laborScheduling';
import { formatDuration } from '@/lib/shift-utils';
import { fetchJobCardItems } from '@/lib/queries/factoryFloor';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import {
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  User,
  Package,
  FileText,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CompletionItemsList,
  isCompletionValid,
  buildItemsPayload,
  initCompletions,
  type ItemCompletion,
  type CompletionItem,
} from '@/components/features/completion/completion-items';

interface CompleteJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: {
    assignment_id: number;
    job_instance_id?: string;
    order_id?: number;
    orderNumber?: string;
    job_id?: number;
    jobName?: string;
    productName?: string;
    staffName?: string;
    staff_id?: number;
    assignment_date?: string;
    start_minutes: number;
    end_minutes: number;
    issued_at?: string;
    started_at?: string;
    job_status?: string;
  } | null;
  onComplete?: () => void;
}

function extractCardId(jobInstanceId?: string): number | null {
  if (!jobInstanceId) return null;
  const match = jobInstanceId.match(/:card-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CompleteJobDialog({
  open,
  onOpenChange,
  assignment,
  onComplete,
}: CompleteJobDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [actualStartTime, setActualStartTime] = useState('');
  const [actualEndTime, setActualEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [completions, setCompletions] = useState<Record<number, ItemCompletion>>({});

  const jobCardId = extractCardId(assignment?.job_instance_id);

  // Fetch job card items — reuse shared query function and cache key
  const { data: rawItems, isLoading: itemsLoading } = useQuery({
    queryKey: ['job-card-items', jobCardId],
    queryFn: () => fetchJobCardItems(jobCardId!),
    enabled: open && jobCardId != null,
  });

  const items: CompletionItem[] = rawItems ?? [];

  const scheduledDuration = assignment
    ? assignment.end_minutes - assignment.start_minutes
    : 0;

  const actualStartMinutes = actualStartTime ? clockToMinutes(actualStartTime) : null;
  const actualEndMinutes = actualEndTime ? clockToMinutes(actualEndTime) : null;
  const actualDuration =
    actualStartMinutes !== null && actualEndMinutes !== null
      ? actualEndMinutes - actualStartMinutes
      : null;

  const variance = actualDuration !== null ? actualDuration - scheduledDuration : null;

  // Initialize form + completions when dialog opens or items load
  useEffect(() => {
    if (open && assignment) {
      setActualStartTime(minutesToClock(assignment.start_minutes));

      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      if (currentMinutes > assignment.start_minutes) {
        setActualEndTime(minutesToClock(currentMinutes));
      } else {
        setActualEndTime(minutesToClock(assignment.end_minutes));
      }

      setNotes('');
      // Reset completions — will be re-initialized when items load
      setCompletions({});
    }
  }, [open, assignment]);

  // Initialize completions from items — uses functional updater to avoid stale closure
  useEffect(() => {
    if (items.length > 0) {
      setCompletions((prev) =>
        Object.keys(prev).length === 0 ? initCompletions(items) : prev
      );
    }
  }, [items]);

  const handleUpdateCompletion = useCallback((itemId: number, update: Partial<ItemCompletion>) => {
    setCompletions((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...update },
    }));
  }, []);

  const itemsValid = items.length === 0 || isCompletionValid(items, completions);

  // Complete job mutation
  const completeJob = useMutation({
    mutationFn: async () => {
      if (!assignment || actualStartMinutes === null || actualEndMinutes === null) {
        throw new Error('Missing required data');
      }

      const assignmentDate = assignment.assignment_date ?? new Date().toISOString().slice(0, 10);
      const actualStartIso = `${assignmentDate}T${actualStartTime}:00`;
      const actualEndIso = `${assignmentDate}T${actualEndTime}:00`;

      const itemsPayload = items.length > 0 ? buildItemsPayload(items, completions) : [];

      const { data, error } = await supabase.rpc('complete_assignment_with_card_v2', {
        p_assignment_id: assignment.assignment_id,
        p_items: itemsPayload,
        p_actual_start: new Date(actualStartIso).toISOString(),
        p_actual_end: new Date(actualEndIso).toISOString(),
        p_notes: notes || null,
      });

      if (error) throw error;
      return data as { job_card_completion?: { completion_type?: string; follow_up_card_id?: number } } | null;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['laborAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['laborPlanningPayload'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-in-factory'] });
      queryClient.invalidateQueries({ queryKey: ['jobCards'] });
      queryClient.invalidateQueries({ queryKey: ['production-summary'] });
      queryClient.invalidateQueries({ queryKey: ['factory-floor'] });

      const completionInfo = data?.job_card_completion;
      const followUpId = completionInfo?.follow_up_card_id;
      const isPartial = completionInfo?.completion_type === 'partial';

      let description = `${assignment?.jobName || 'Job'} has been marked as complete`;
      if (isPartial && followUpId) {
        description += `. Follow-up card #${followUpId} created for remainder.`;
      } else if (isPartial) {
        description += ` (partial completion — remainder recorded).`;
      }

      toast({ title: 'Job completed', description });

      onOpenChange(false);
      onComplete?.();
    },
    onError: (error) => {
      console.error('Error completing job:', error);
      toast({
        title: 'Error',
        description: (error as Error).message || 'Failed to complete job. Please try again.',
        variant: 'destructive',
      });
    },
  });

  if (!assignment) return null;

  const isValid =
    actualStartMinutes !== null &&
    actualEndMinutes !== null &&
    actualDuration !== null &&
    actualDuration > 0 &&
    itemsValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Complete Job
          </DialogTitle>
          <DialogDescription>
            Record the actual times and confirm completion
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Job Info */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{assignment.jobName || 'Unknown Job'}</span>
              {assignment.orderNumber && (
                <Badge variant="outline" className="ml-auto">
                  #{assignment.orderNumber}
                </Badge>
              )}
            </div>

            {assignment.productName && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>{assignment.productName}</span>
              </div>
            )}

            {assignment.staffName && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{assignment.staffName}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Scheduled: {minutesToClock(assignment.start_minutes)} –{' '}
                {minutesToClock(assignment.end_minutes)} ({formatDuration(scheduledDuration)})
              </span>
            </div>

            {assignment.issued_at && (
              <div className="text-xs text-muted-foreground">
                Issued: {format(new Date(assignment.issued_at), 'MMM d, h:mm a')}
              </div>
            )}
          </div>

          <Separator />

          {/* Actual Times */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Actual Times</Label>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="actualStart" className="text-xs text-muted-foreground">
                  Started
                </Label>
                <Input
                  id="actualStart"
                  type="time"
                  value={actualStartTime}
                  onChange={(e) => setActualStartTime(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="actualEnd" className="text-xs text-muted-foreground">
                  Ended
                </Label>
                <Input
                  id="actualEnd"
                  type="time"
                  value={actualEndTime}
                  onChange={(e) => setActualEndTime(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {actualDuration !== null && actualDuration > 0 && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Actual Duration</p>
                  <p className="text-2xl font-bold">{formatDuration(actualDuration)}</p>
                </div>

                {variance !== null && variance !== 0 && (
                  <div className={cn(
                    "text-right",
                    variance > 0 ? "text-amber-600" : "text-green-600"
                  )}>
                    <div className="flex items-center gap-1 text-sm font-medium">
                      {variance > 0 ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                      Variance
                    </div>
                    <p className="text-lg font-semibold">
                      {variance > 0 ? '+' : ''}{formatDuration(Math.abs(variance))}
                    </p>
                  </div>
                )}
              </div>
            )}

            {actualDuration !== null && actualDuration <= 0 && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                End time must be after start time
              </div>
            )}
          </div>

          {/* Job card items with remainder handling */}
          {jobCardId != null && (
            <>
              <Separator />
              {itemsLoading ? (
                <p className="text-sm text-muted-foreground">Loading items...</p>
              ) : items.length > 0 ? (
                <CompletionItemsList
                  items={items}
                  completions={completions}
                  onUpdate={handleUpdateCompletion}
                />
              ) : null}
            </>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-sm font-medium">
              Notes (optional)
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this job..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => completeJob.mutate()}
            disabled={!isValid || completeJob.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {completeJob.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Complete Job
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
