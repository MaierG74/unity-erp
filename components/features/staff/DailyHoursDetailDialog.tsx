'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import { format, parseISO } from 'date-fns';
import { formatTimeToSAST, createSASTTimestamp } from '@/lib/utils/timezone';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Clock,
  Edit3,
  Save,
  X,
  Coffee,
  Utensils,
  AlertCircle,
  Calculator,
  Trash2,
  AlertTriangle,
  LogIn,
  LogOut,
  Plus
} from 'lucide-react';
import { processAttendanceBatch } from '@/lib/utils/attendance';

// Types
type ClockEvent = {
  id: string;
  staff_id: number;
  event_time: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  verification_method: string;
  break_type: string | null;
  notes: string | null;
};

type TimeSegment = {
  id: string;
  staff_id: number;
  date_worked: string;
  start_time: string;
  end_time: string | null;
  segment_type: string;
  break_type: string | null;
  duration_minutes: number | null;
  verification_method: string | null;
};

type DailySummary = {
  id: string;
  staff_id: number;
  date_worked: string;
  first_clock_in: string | null;
  last_clock_out: string | null;
  total_work_minutes: number;
  total_break_minutes: number;
  lunch_break_minutes: number;
  other_breaks_minutes: number;
  unpaid_break_minutes: number;
  regular_minutes: number;
  dt_minutes: number;
  ot_minutes: number;
  total_hours_worked: number;
  is_complete: boolean;
  notes: string | null;
};

type EditableSegment = TimeSegment & {
  isEditing?: boolean;
  tempStartTime?: string;
  tempEndTime?: string;
};

interface DailyHoursDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  staffId: number;
  staffName: string;
  date: string;
  initialHours: number;
}

// Stable empty arrays to prevent infinite useEffect loops
const EMPTY_CLOCK_EVENTS: ClockEvent[] = [];
const EMPTY_TIME_SEGMENTS: TimeSegment[] = [];

export function DailyHoursDetailDialog({
  isOpen,
  onClose,
  staffId,
  staffName,
  date,
  initialHours
}: DailyHoursDetailDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingSegments, setEditingSegments] = useState<Record<string, EditableSegment>>({});
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEventTime, setEditEventTime] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteConfirmEvent, setDeleteConfirmEvent] = useState<ClockEvent | null>(null);
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [newEventType, setNewEventType] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [newEventTime, setNewEventTime] = useState<string>('');

  // Add CSS to prevent AI assistant overlays on time inputs
  React.useEffect(() => {
    if (isOpen) {
      const style = document.createElement('style');
      style.textContent = `
        .dialog-time-input-container [data-no-ai-assist] {
          position: relative !important;
          z-index: 1000 !important;
        }
        .dialog-time-input-container [data-no-ai-assist]:focus {
          z-index: 1001 !important;
        }
        /* Hide any overlay buttons on time inputs */
        .dialog-time-input-container input[type="time"] + button,
        .dialog-time-input-container input[type="time"] ~ button {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
      
      return () => {
        document.head.removeChild(style);
      };
    }
  }, [isOpen]);

  // Fetch clock events for the day
  const { data: clockEvents = EMPTY_CLOCK_EVENTS, isLoading: isLoadingEvents, refetch: refetchEvents } = useQuery({
    queryKey: ['time_clock_events', staffId, date],
    queryFn: async () => {
      // Calculate SAST day boundaries
      const sastStart = `${date}T00:00:00+02:00`;
      const sastEnd = `${date}T23:59:59+02:00`;

      const { data, error } = await supabase
        .from('time_clock_events')
        .select('*')
        .eq('staff_id', staffId)
        .gte('event_time', sastStart)
        .lte('event_time', sastEnd)
        .order('event_time');

      if (error) throw error;
      return data || [];
    },
    enabled: isOpen && !!staffId && !!date,
  });

  // Fetch time segments for the day
  const { data: timeSegments = EMPTY_TIME_SEGMENTS, isLoading: isLoadingSegments, refetch: refetchSegments } = useQuery({
    queryKey: ['time_segments', staffId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_segments')
        .select('*')
        .eq('staff_id', staffId)
        .eq('date_worked', date)
        .order('start_time');

      if (error) throw error;
      return data || [];
    },
    enabled: isOpen && !!staffId && !!date,
  });

  // Fetch daily summary
  const { data: dailySummary, isLoading: isLoadingSummary, refetch: refetchSummary } = useQuery({
    queryKey: ['time_daily_summary', staffId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_daily_summary')
        .select('*')
        .eq('staff_id', staffId)
        .eq('date_worked', date)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
      return data;
    },
    enabled: isOpen && !!staffId && !!date,
  });

  // Recalculate daily summary from time segments
  const recalculateDailySummary = async (staffId: number, date: string) => {
    try {
      console.log('Recalculating daily summary for:', { staffId, date });
      
      // Get all time segments for the day
      const { data: segments, error: segmentsError } = await supabase
        .from('time_segments')
        .select('*')
        .eq('staff_id', staffId)
        .eq('date_worked', date)
        .order('start_time');

      if (segmentsError) {
        console.error('Error fetching segments:', segmentsError);
        throw segmentsError;
      }

      console.log('Fetched segments:', segments);

      // Calculate totals from segments
      let totalWorkMinutes = 0;
      let totalBreakMinutes = 0;
      let lunchBreakMinutes = 0;
      let otherBreaksMinutes = 0;
      let firstClockIn: string | null = null;
      let lastClockOut: string | null = null;

      segments?.forEach((segment: TimeSegment) => {
        if (segment.segment_type === 'work' && segment.duration_minutes) {
          totalWorkMinutes += segment.duration_minutes;
          if (!firstClockIn || segment.start_time < firstClockIn) {
            firstClockIn = segment.start_time;
          }
          if (!lastClockOut || (segment.end_time && segment.end_time > lastClockOut)) {
            lastClockOut = segment.end_time;
          }
        } else if (segment.segment_type === 'break' && segment.duration_minutes) {
          totalBreakMinutes += segment.duration_minutes;
          if (segment.break_type === 'lunch') {
            lunchBreakMinutes += segment.duration_minutes;
          } else {
            otherBreaksMinutes += segment.duration_minutes;
          }
        }
      });

      const isComplete = !!lastClockOut;

      const summaryData = {
        staff_id: staffId,
        date_worked: date,
        first_clock_in: firstClockIn,
        last_clock_out: lastClockOut,
        total_work_minutes: totalWorkMinutes,
        total_break_minutes: totalBreakMinutes,
        lunch_break_minutes: lunchBreakMinutes,
        other_breaks_minutes: otherBreaksMinutes,
        is_complete: isComplete
      };

      console.log('Upserting daily summary:', summaryData);

      // Update the daily summary - this will trigger the payroll calculation triggers
      const { error: updateError } = await supabase
        .from('time_daily_summary')
        .upsert(summaryData, {
          onConflict: 'staff_id,date_worked'
        });

      if (updateError) {
        console.error('Upsert error:', updateError);
        throw updateError;
      }

      console.log('Daily summary updated successfully');
    } catch (error) {
      console.error('Error recalculating daily summary:', error);
      throw error;
    }
  };

  // Update time segment mutation
  const updateSegmentMutation = useMutation({
    mutationFn: async ({ segmentId, updates }: { segmentId: string; updates: Partial<TimeSegment> }) => {
      const { data, error } = await supabase
        .from('time_segments')
        .update(updates)
        .eq('id', segmentId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      try {
        // Recalculate daily summary after segment update
        await recalculateDailySummary(staffId, date);
        
        refetchSegments();
        refetchSummary();
        // Invalidate weekly summary to update the main table
        queryClient.invalidateQueries({ queryKey: ['time_daily_summary', 'weekly'] });
        toast({
          title: 'Success',
          description: 'Time entry updated successfully',
        });
      } catch (error) {
        console.error('Error in onSuccess callback:', error);
        toast({
          title: 'Warning',
          description: 'Time entry saved but summary may not have updated',
          variant: 'destructive',
        });
      }
    },
    onError: (error) => {
      console.error('Error updating time segment:', error);
      toast({
        title: 'Error',
        description: 'Failed to update time entry',
        variant: 'destructive',
      });
    },
  });

  // Detect clock event anomalies
  const eventAnomalies = React.useMemo(() => {
    const clockIns = clockEvents.filter(e => e.event_type === 'clock_in');
    const clockOuts = clockEvents.filter(e => e.event_type === 'clock_out');
    return {
      clockInCount: clockIns.length,
      clockOutCount: clockOuts.length,
      hasMultipleClockIns: clockIns.length > 1,
      hasMultipleClockOuts: clockOuts.length > 1,
      hasDuplicates: clockIns.length > 1 || clockOuts.length > 1,
      missingClockIn: clockOuts.length > 0 && clockIns.length === 0,
      missingClockOut: clockIns.length > 0 && clockOuts.length === 0,
      hasAnyAnomaly: clockIns.length > 1 || clockOuts.length > 1 ||
                     (clockOuts.length > 0 && clockIns.length === 0) ||
                     (clockIns.length > 0 && clockOuts.length === 0),
    };
  }, [clockEvents]);

  // For backward compatibility
  const duplicateInfo = eventAnomalies;

  // Reprocess attendance after event changes
  const reprocessAttendance = async () => {
    setIsProcessing(true);
    try {
      await processAttendanceBatch(date, staffId);
      // Refresh all data
      await Promise.all([
        refetchEvents(),
        refetchSegments(),
        refetchSummary(),
      ]);
      // Invalidate weekly summary to update the main table
      queryClient.invalidateQueries({ queryKey: ['time_daily_summary', 'weekly'] });
      queryClient.invalidateQueries({ queryKey: ['time_clock_events', 'weekly'] });
    } catch (error) {
      console.error('Error reprocessing attendance:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  // Start editing a clock event
  const startEditingEvent = (event: ClockEvent) => {
    const eventDate = new Date(event.event_time);
    setEditingEventId(event.id);
    setEditEventTime(format(eventDate, 'HH:mm'));
  };

  // Cancel editing event
  const cancelEditingEvent = () => {
    setEditingEventId(null);
    setEditEventTime('');
  };

  // Save edited clock event
  const saveEventEdit = async (eventId: string) => {
    const event = clockEvents.find(e => e.id === eventId);
    if (!event) return;

    setIsProcessing(true);
    try {
      // Parse the time and create new timestamp
      const [hours, minutes] = editEventTime.split(':').map(Number);
      const originalDate = new Date(event.event_time);
      const newDate = new Date(originalDate);
      newDate.setHours(hours);
      newDate.setMinutes(minutes);

      const { error } = await supabase
        .from('time_clock_events')
        .update({ event_time: newDate.toISOString() })
        .eq('id', eventId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Clock event updated',
      });

      cancelEditingEvent();
      await reprocessAttendance();
    } catch (error: any) {
      console.error('Error updating clock event:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update clock event',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Open delete confirmation dialog
  const openDeleteConfirm = (event: ClockEvent) => {
    setDeleteConfirmEvent(event);
  };

  // Close delete confirmation dialog
  const closeDeleteConfirm = () => {
    setDeleteConfirmEvent(null);
  };

  // Delete a clock event (called after confirmation)
  const confirmDeleteEvent = async () => {
    if (!deleteConfirmEvent) return;

    const eventId = deleteConfirmEvent.id;
    closeDeleteConfirm();
    setIsProcessing(true);

    try {
      const { error } = await supabase
        .from('time_clock_events')
        .delete()
        .eq('id', eventId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Clock event deleted',
      });

      await reprocessAttendance();
    } catch (error: any) {
      console.error('Error deleting clock event:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete clock event',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Add a new clock event
  const addNewEvent = async () => {
    if (!newEventTime) {
      toast({
        title: 'Error',
        description: 'Please enter a time for the event',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Parse the time and create timestamp for the date
      const [hours, minutes] = newEventTime.split(':').map(Number);
      const eventDateTime = new Date(`${date}T00:00:00+02:00`); // SAST
      eventDateTime.setHours(hours);
      eventDateTime.setMinutes(minutes);

      const { error } = await supabase
        .from('time_clock_events')
        .insert({
          staff_id: staffId,
          event_time: eventDateTime.toISOString(),
          event_type: newEventType,
          verification_method: 'manual',
          notes: 'Added via Weekly Summary',
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: `${newEventType === 'clock_in' ? 'Clock in' : 'Clock out'} event added`,
      });

      // Reset form
      setIsAddingEvent(false);
      setNewEventTime('');

      await reprocessAttendance();
    } catch (error: any) {
      console.error('Error adding clock event:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add clock event',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Get event type display info
  const getEventTypeInfo = (eventType: string) => {
    switch (eventType) {
      case 'clock_in':
        return { icon: LogIn, color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', label: 'Clock In' };
      case 'clock_out':
        return { icon: LogOut, color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', label: 'Clock Out' };
      case 'break_start':
        return { icon: Coffee, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', label: 'Break Start' };
      case 'break_end':
        return { icon: Coffee, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', label: 'Break End' };
      default:
        return { icon: Clock, color: 'bg-gray-100 text-gray-800', label: eventType };
    }
  };

  // Calculate duration between two times
  const calculateDuration = (startTime: string, endTime: string | null): number => {
    if (!endTime) return 0;
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  };

  // Start editing a segment
  const startEditing = (segment: TimeSegment) => {
    setEditingSegments(prev => ({
      ...prev,
      [segment.id]: {
        ...segment,
        isEditing: true,
        tempStartTime: formatTimeToSAST(segment.start_time),
        tempEndTime: segment.end_time ? formatTimeToSAST(segment.end_time) : '',
      }
    }));
  };

  // Cancel editing
  const cancelEditing = (segmentId: string) => {
    setEditingSegments(prev => {
      const newState = { ...prev };
      delete newState[segmentId];
      return newState;
    });
  };

  // Save edited segment
  const saveSegment = async (segmentId: string) => {
    const editingSegment = editingSegments[segmentId];
    if (!editingSegment) return;

    try {
      const dateStr = date;
      const startTime = createSASTTimestamp(dateStr, editingSegment.tempStartTime || '00:00');
      const endTime = editingSegment.tempEndTime ? createSASTTimestamp(dateStr, editingSegment.tempEndTime) : null;
      
      const duration = endTime ? calculateDuration(startTime, endTime) : null;
      
      const updates: Partial<TimeSegment> = {
        start_time: startTime,
        end_time: endTime,
        duration_minutes: duration,
      };

      console.log('Saving segment updates:', updates);
      await updateSegmentMutation.mutateAsync({ segmentId, updates });
      cancelEditing(segmentId);
    } catch (error) {
      console.error('Error in saveSegment:', error);
      toast({
        title: 'Error',
        description: 'Failed to save time entry',
        variant: 'destructive',
      });
    }
  };

  // Update temp time values
  const updateTempTime = (segmentId: string, field: 'tempStartTime' | 'tempEndTime', value: string) => {
    setEditingSegments(prev => ({
      ...prev,
      [segmentId]: {
        ...prev[segmentId],
        [field]: value,
      }
    }));
  };

  // Get segment type icon and color
  const getSegmentInfo = (segmentType: string, breakType: string | null) => {
    switch (segmentType) {
      case 'work':
        return { icon: Clock, color: 'bg-green-100 text-green-800', label: 'Work' };
      case 'break':
        if (breakType === 'lunch') {
          return { icon: Utensils, color: 'bg-orange-100 text-orange-800', label: 'Lunch Break' };
        }
        return { icon: Coffee, color: 'bg-blue-100 text-blue-800', label: 'Tea Break' };
      default:
        return { icon: Clock, color: 'bg-gray-100 text-gray-800', label: segmentType };
    }
  };

  // Format time for display in SAST timezone
  const formatTime = formatTimeToSAST;

  // Format duration
  const formatDuration = (minutes: number | null) => {
    if (!minutes) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {staffName} - {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
          </DialogTitle>
          <DialogDescription>
            Detailed breakdown of hours and time entries for this day
          </DialogDescription>
        </DialogHeader>

        {isLoadingSegments || isLoadingSummary || isLoadingEvents ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Daily Summary Card */}
            {dailySummary && (
              <div className="bg-muted/50 p-4 rounded-lg">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  Daily Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <Label className="text-muted-foreground">Clock In</Label>
                    <div className="font-medium">{formatTime(dailySummary.first_clock_in)}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Clock Out</Label>
                    <div className="font-medium">{formatTime(dailySummary.last_clock_out)}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Total Work</Label>
                    <div className="font-medium">{formatDuration(dailySummary.total_work_minutes)}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Total Breaks</Label>
                    <div className="font-medium">{formatDuration(dailySummary.total_break_minutes)}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Regular Hours</Label>
                    <div className="font-medium">{(dailySummary.regular_minutes / 60).toFixed(2)}h</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Double Time</Label>
                    <div className="font-medium text-red-600">{(dailySummary.dt_minutes / 60).toFixed(2)}h</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Overtime</Label>
                    <div className="font-medium">{(dailySummary.ot_minutes / 60).toFixed(2)}h</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Total Hours</Label>
                    <div className="font-bold">{dailySummary.total_hours_worked?.toFixed(2) || '0.00'}h</div>
                  </div>
                </div>
                {dailySummary.notes && (
                  <div className="mt-3">
                    <Label className="text-muted-foreground">Notes</Label>
                    <div className="text-sm mt-1">{dailySummary.notes}</div>
                  </div>
                )}
              </div>
            )}

            {/* Clock Events Section - for viewing/editing raw events */}
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Clock Events
                  {eventAnomalies.hasDuplicates && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                      <AlertTriangle className="h-3 w-3" />
                      {eventAnomalies.hasMultipleClockIns && `${eventAnomalies.clockInCount} clock-ins`}
                      {eventAnomalies.hasMultipleClockIns && eventAnomalies.hasMultipleClockOuts && ' & '}
                      {eventAnomalies.hasMultipleClockOuts && `${eventAnomalies.clockOutCount} clock-outs`}
                    </span>
                  )}
                  {eventAnomalies.missingClockIn && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                      <AlertTriangle className="h-3 w-3" />
                      Missing clock-in
                    </span>
                  )}
                  {eventAnomalies.missingClockOut && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                      <AlertTriangle className="h-3 w-3" />
                      Missing clock-out
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {isProcessing && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary"></div>
                      Processing...
                    </span>
                  )}
                  {!isAddingEvent && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        // Smart default: suggest clock_out only if there's a clock-in without clock-out
                        // Otherwise default to clock_in (no events, or missing clock-in, etc.)
                        setNewEventType(eventAnomalies.missingClockOut ? 'clock_out' : 'clock_in');
                        setIsAddingEvent(true);
                      }}
                      disabled={isProcessing}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Event
                    </Button>
                  )}
                </div>
              </div>

              {/* Warning for missing clock-in */}
              {eventAnomalies.missingClockIn && (
                <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-red-700 dark:text-red-300">Missing clock-in</p>
                      <p className="text-muted-foreground mt-1">
                        This staff member has a clock-out recorded but no clock-in for this day.
                        Click "Add Event" to manually add the missing clock-in.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning for missing clock-out */}
              {eventAnomalies.missingClockOut && (
                <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-red-700 dark:text-red-300">Missing clock-out</p>
                      <p className="text-muted-foreground mt-1">
                        This staff member has a clock-in recorded but no clock-out for this day.
                        Click "Add Event" to manually add the missing clock-out.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning for duplicate events */}
              {eventAnomalies.hasDuplicates && (
                <div className="mb-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-orange-700 dark:text-orange-300">Potential data entry error detected</p>
                      <p className="text-muted-foreground mt-1">
                        Multiple {eventAnomalies.hasMultipleClockIns ? 'clock-in' : ''}{eventAnomalies.hasMultipleClockIns && eventAnomalies.hasMultipleClockOuts ? ' and ' : ''}{eventAnomalies.hasMultipleClockOuts ? 'clock-out' : ''} entries found.
                        Review the events below and delete any duplicates.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Add Event Form */}
              {isAddingEvent && (
                <div className="mb-3 p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground mb-1 block">Event Type</Label>
                      <Select value={newEventType} onValueChange={(v) => setNewEventType(v as 'clock_in' | 'clock_out')}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="clock_in">
                            <span className="flex items-center gap-2">
                              <LogIn className="h-3 w-3 text-green-500" />
                              Clock In
                            </span>
                          </SelectItem>
                          <SelectItem value="clock_out">
                            <span className="flex items-center gap-2">
                              <LogOut className="h-3 w-3 text-red-500" />
                              Clock Out
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground mb-1 block">Time (24h)</Label>
                      <Input
                        type="time"
                        value={newEventTime}
                        onChange={(e) => setNewEventTime(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={addNewEvent} disabled={isProcessing || !newEventTime}>
                        <Save className="h-3 w-3 mr-1" />
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setIsAddingEvent(false); setNewEventTime(''); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Clock Events Table */}
              {clockEvents.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event Type</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clockEvents.map((event: ClockEvent) => {
                        const eventInfo = getEventTypeInfo(event.event_type);
                        const EventIcon = eventInfo.icon;
                        const isEditing = editingEventId === event.id;
                        const isDuplicate =
                          (event.event_type === 'clock_in' && eventAnomalies.hasMultipleClockIns) ||
                          (event.event_type === 'clock_out' && eventAnomalies.hasMultipleClockOuts);

                        return (
                          <TableRow key={event.id} className={isDuplicate ? 'bg-orange-500/5' : ''}>
                            <TableCell>
                              <Badge className={eventInfo.color}>
                                <EventIcon className="h-3 w-3 mr-1" />
                                {eventInfo.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  type="time"
                                  value={editEventTime}
                                  onChange={(e) => setEditEventTime(e.target.value)}
                                  className="w-28"
                                  autoComplete="off"
                                />
                              ) : (
                                <span className="font-mono">
                                  {format(new Date(event.event_time), 'HH:mm')}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {event.verification_method === 'facial' ? 'Facial Recognition' : event.verification_method || 'Manual'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    onClick={() => saveEventEdit(event.id)}
                                    disabled={isProcessing}
                                  >
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={cancelEditingEvent}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => startEditingEvent(event)}
                                    disabled={isProcessing}
                                  >
                                    <Edit3 className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                    onClick={() => openDeleteConfirm(event)}
                                    disabled={isProcessing}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground border rounded-lg">
                  <p>No clock events recorded for this day</p>
                  <p className="text-xs mt-1">Use the "Add Event" button above to add a clock-in or clock-out</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Time Segments Table */}
            <div>
              <h3 className="font-semibold mb-3">Time Entries (Processed Segments)</h3>
              {timeSegments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                  <p>No time entries found for this day</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden dialog-time-input-container">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Start Time</TableHead>
                        <TableHead>End Time</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timeSegments.map((segment: TimeSegment) => {
                        const editingSegment = editingSegments[segment.id];
                        const isEditing = editingSegment?.isEditing;
                        const segmentInfo = getSegmentInfo(segment.segment_type, segment.break_type);
                        const Icon = segmentInfo.icon;

                        return (
                          <TableRow key={segment.id}>
                            <TableCell>
                              <Badge className={segmentInfo.color}>
                                <Icon className="h-3 w-3 mr-1" />
                                {segmentInfo.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <div className="relative">
                                  <Input
                                    type="time"
                                    value={editingSegment.tempStartTime || ''}
                                    onChange={(e) => updateTempTime(segment.id, 'tempStartTime', e.target.value)}
                                    className="w-28 pr-8"
                                    style={{ zIndex: 10 }}
                                    autoComplete="off"
                                    data-no-ai-assist="true"
                                  />
                                </div>
                              ) : (
                                formatTime(segment.start_time)
                              )}
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <div className="relative">
                                  <Input
                                    type="time"
                                    value={editingSegment.tempEndTime || ''}
                                    onChange={(e) => updateTempTime(segment.id, 'tempEndTime', e.target.value)}
                                    className="w-28 pr-8"
                                    style={{ zIndex: 10 }}
                                    autoComplete="off"
                                    data-no-ai-assist="true"
                                  />
                                </div>
                              ) : (
                                formatTime(segment.end_time)
                              )}
                            </TableCell>
                            <TableCell>
                              {formatDuration(segment.duration_minutes)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {segment.verification_method || 'Manual'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {isEditing ? (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    onClick={() => saveSegment(segment.id)}
                                    disabled={updateSegmentMutation.isPending}
                                  >
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => cancelEditing(segment.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => startEditing(segment)}
                                >
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      {deleteConfirmEvent && (
        <Dialog open={!!deleteConfirmEvent} onOpenChange={closeDeleteConfirm}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Delete Clock Event
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this clock event? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 p-4 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-3">
                {(() => {
                  const info = getEventTypeInfo(deleteConfirmEvent.event_type);
                  const Icon = info.icon;
                  return (
                    <>
                      <Badge className={info.color}>
                        <Icon className="h-3 w-3 mr-1" />
                        {info.label}
                      </Badge>
                      <span className="font-mono text-lg font-semibold">
                        {format(new Date(deleteConfirmEvent.event_time), 'HH:mm')}
                      </span>
                      <Badge variant="outline" className="capitalize">
                        {deleteConfirmEvent.verification_method === 'facial' ? 'Facial Recognition' : deleteConfirmEvent.verification_method || 'Manual'}
                      </Badge>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="text-sm text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <span>
                  After deletion, the daily summary will be automatically recalculated based on the remaining clock events.
                </span>
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={closeDeleteConfirm}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDeleteEvent}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Event
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}