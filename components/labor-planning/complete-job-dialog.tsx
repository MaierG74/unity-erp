'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

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

// Convert minutes from midnight to time string (HH:MM)
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Convert time string (HH:MM) to minutes from midnight
function timeStringToMinutes(timeStr: string): number {
  const [hours, mins] = timeStr.split(':').map(Number);
  return hours * 60 + mins;
}

// Format minutes as duration string
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function CompleteJobDialog({
  open,
  onOpenChange,
  assignment,
  onComplete,
}: CompleteJobDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [actualStartTime, setActualStartTime] = useState('');
  const [actualEndTime, setActualEndTime] = useState('');
  const [notes, setNotes] = useState('');

  // Calculate durations
  const scheduledDuration = assignment
    ? assignment.end_minutes - assignment.start_minutes
    : 0;

  const actualStartMinutes = actualStartTime ? timeStringToMinutes(actualStartTime) : null;
  const actualEndMinutes = actualEndTime ? timeStringToMinutes(actualEndTime) : null;
  const actualDuration =
    actualStartMinutes !== null && actualEndMinutes !== null
      ? actualEndMinutes - actualStartMinutes
      : null;

  const variance = actualDuration !== null ? actualDuration - scheduledDuration : null;

  // Initialize form when dialog opens
  useEffect(() => {
    if (open && assignment) {
      // Default actual start to scheduled start
      setActualStartTime(minutesToTimeString(assignment.start_minutes));

      // Default actual end to current time or scheduled end
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      // Use current time if it's after scheduled start, otherwise use scheduled end
      if (currentMinutes > assignment.start_minutes) {
        setActualEndTime(minutesToTimeString(currentMinutes));
      } else {
        setActualEndTime(minutesToTimeString(assignment.end_minutes));
      }

      setNotes('');
    }
  }, [open, assignment]);

  // Complete job mutation
  const completeJob = useMutation({
    mutationFn: async () => {
      if (!assignment || actualStartMinutes === null || actualEndMinutes === null) {
        throw new Error('Missing required data');
      }

      const duration = actualEndMinutes - actualStartMinutes;

      const { error } = await supabase
        .from('labor_plan_assignments')
        .update({
          job_status: 'completed',
          completed_at: new Date().toISOString(),
          actual_start_minutes: actualStartMinutes,
          actual_end_minutes: actualEndMinutes,
          actual_duration_minutes: duration,
          completion_notes: notes || null,
        })
        .eq('assignment_id', assignment.assignment_id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['laborAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['laborPlanningPayload'] });
      queryClient.invalidateQueries({ queryKey: ['jobs-in-factory'] });

      toast({
        title: 'Job completed',
        description: `${assignment?.jobName || 'Job'} has been marked as complete`,
      });

      onOpenChange(false);
      onComplete?.();
    },
    onError: (error) => {
      console.error('Error completing job:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete job. Please try again.',
        variant: 'destructive',
      });
    },
  });

  if (!assignment) return null;

  const isValid = actualStartMinutes !== null && actualEndMinutes !== null && actualDuration !== null && actualDuration > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Complete Job
          </DialogTitle>
          <DialogDescription>
            Record the actual times for this job
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
                Scheduled: {minutesToTimeString(assignment.start_minutes)} –{' '}
                {minutesToTimeString(assignment.end_minutes)} ({formatDuration(scheduledDuration)})
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

            {/* Duration & Variance */}
            {actualDuration !== null && (
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
