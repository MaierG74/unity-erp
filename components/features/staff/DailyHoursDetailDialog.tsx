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
import { Separator } from '@/components/ui/separator';
import { 
  Clock, 
  Edit3, 
  Save, 
  X, 
  Coffee, 
  Utensils,
  AlertCircle,
  Calculator
} from 'lucide-react';

// Types
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

  // Fetch time segments for the day
  const { data: timeSegments = [], isLoading: isLoadingSegments, refetch: refetchSegments } = useQuery({
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
      const startTime = createSASTTimestamp(dateStr, editingSegment.tempStartTime);
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

        {isLoadingSegments || isLoadingSummary ? (
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

            <Separator />

            {/* Time Segments Table */}
            <div>
              <h3 className="font-semibold mb-3">Time Entries</h3>
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
    </Dialog>
  );
}