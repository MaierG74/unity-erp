import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from '@/components/ui/dialog';
import { ChevronDown, ChevronUp, Edit3, Trash2, Plus, User, RefreshCw, Loader2 } from 'lucide-react';
import { ClockEvent, TimeSegment } from '@/lib/types/attendance';

import { DailySummary } from '@/lib/types/attendance';

interface AttendanceTimelineProps {
  staffId: number;
  staffName: string;
  date: Date;
  clockEvents: ClockEvent[];
  segments: TimeSegment[];
  onAddManualEvent: (staffId: number, eventType: string, time: string, breakType?: string | null) => Promise<void>;
  onSegmentsChanged: () => void;
  onProcessStaff: (staffId?: number) => Promise<void>;
  summary?: DailySummary | null;
};

export function AttendanceTimeline({ 
  staffId, 
  staffName,
  date, 
  clockEvents, 
  segments,
  onAddManualEvent,
  onSegmentsChanged,
  onProcessStaff,
  summary,
}: AttendanceTimelineProps) {
  const { toast } = useToast();

  const [showTimeline, setShowTimeline] = useState(true);
  const [showSegments, setShowSegments] = useState(false);
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [eventType, setEventType] = useState<string>('clock_in');
  const [eventTime, setEventTime] = useState('');
  const [breakType, setBreakType] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Time edit dialog states
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ClockEvent | null>(null);
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('');
  const [timeError, setTimeError] = useState<string | null>(null);
  
  // Delete confirmation dialog states
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState<ClockEvent | null>(null);

  const staffEvents = useMemo(() => clockEvents.filter(event => event.staff_id === staffId), [clockEvents, staffId]);

  // Detect missing clock-out: if last event is clock_in and no subsequent clock_out
  let missingClockOut = false;
  if (staffEvents.length > 0) {
    const lastEvent = staffEvents[staffEvents.length - 1];
    if (lastEvent.event_type === 'clock_in') {
      missingClockOut = true;
    }
  }
  const staffSegments = useMemo(() => segments.filter(segment => segment.staff_id === staffId), [segments, staffId]);
  // Only include segments with positive duration
  const validSegments = useMemo(
    () => staffSegments
      .filter(s => new Date(s.end_time).getTime() > new Date(s.start_time).getTime())
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    [staffSegments]
  );

  // Debug: Log incoming props and filtered data
  // // console.log('[AttendanceTimeline] staffId:', staffId, 'type:', typeof staffId, 'numericStaffId:', numericStaffId); // Removed due to numericStaffId being undefined
  // console.log('[AttendanceTimeline] segments:', segments);
  // console.log('[AttendanceTimeline] clockEvents:', clockEvents);
  // console.log('[AttendanceTimeline] Filtered staffEvents:', staffEvents);
  // console.log('[AttendanceTimeline] Filtered staffSegments:', staffSegments);

  // Helper functions
  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'clock_in':
        return 'bg-green-500';
      case 'clock_out':
        return 'bg-red-500';
      case 'break_start':
      case 'break_end':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getVerificationMethod = (method: string) => {
    switch (method) {
      case 'facial':
        return 'Facial Recognition';
      case 'manual':
        return 'Manual Entry';
      default:
        return method;
    }
  };

  // Calculate display hours
  const displayHours = useMemo(() => {
    // Debug: Log summary data to understand what's being passed
    console.log(`[AttendanceTimeline] Summary for ${staffName}:`, summary);
    
    // If a precomputed daily summary is provided, use it so totals reflect unpaid-break deductions
    if (summary) {
      const totalHours = Number(summary.total_hours_worked || summary.total_work_minutes / 60);
      const unpaid = summary.unpaid_break_minutes ?? 0;
      console.log(`[AttendanceTimeline] Using summary data for ${staffName}: ${totalHours} hours`);
      return {
        total_hours: totalHours,
        regular_hours: totalHours, // daily OT suppressed
        overtime_hours: 0,
        unpaid_break_minutes: unpaid,
        verification_method: 'summary',
      } as any;
    }

    // fallback to client-side segment calculation
    // console.log('Calculating hours from staffSegments:', staffSegments);
    
    // Calculate total minutes from start_time and end_time
    const totalMinutes = staffSegments.reduce((acc, segment) => {
      // Parse start and end times
      try {
        const startTime = new Date(segment.start_time);
        const endTime = new Date(segment.end_time);
        
        // Calculate duration in minutes
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = Math.round(durationMs / (1000 * 60));
        
        // console.log('Segment duration calculation:', { 
        //   // segment: segment.id, 
        //   // start: startTime.toISOString(), 
        //   // end: endTime.toISOString(), 
        //   // durationMinutes 
        // });
        
        // All segments are considered work segments unless specified otherwise
        // We could add additional checks here if needed
        return acc + (durationMinutes > 0 ? durationMinutes : 0);
      } catch (error) {
        console.error('Error calculating segment duration:', error, segment);
        return acc;
      }
    }, 0);
    
    // console.log('Total minutes calculated:', totalMinutes);
    
    // Daily view no longer shows per-day overtime. All worked minutes are regular; weekly summary handles OT.
    const regularMinutes = totalMinutes;
    const overtimeMinutes = 0;

    const firstEvent = staffEvents[0];
    const verificationMethod = firstEvent?.verification_method || 'manual';

    const result = {
      total_hours: totalMinutes / 60,
      regular_hours: regularMinutes / 60,
      overtime_hours: overtimeMinutes / 60,
      verification_method: verificationMethod
    };
    
    // console.log('Final hours calculation:', result);
    return result; // from segment calculation
  }, [staffSegments, staffEvents, summary]);

  // Open the edit dialog for an event
  const openEditDialog = (event: ClockEvent) => {
    const eventDate = new Date(event.event_time);
    setEditingEvent(event);
    setEditHour(format(eventDate, 'HH'));
    setEditMinute(format(eventDate, 'mm'));
    setTimeError(null);
    setIsEditDialogOpen(true);
  };

  // Validate and process the edited time
  const handleEditSubmit = async () => {
    if (!editingEvent) return;
    
    // Validate inputs
    const hour = parseInt(editHour, 10);
    const minute = parseInt(editMinute, 10);
    
    if (isNaN(hour) || hour < 0 || hour > 23) {
      setTimeError('Hour must be between 0 and 23');
      return;
    }
    
    if (isNaN(minute) || minute < 0 || minute > 59) {
      setTimeError('Minute must be between 0 and 59');
      return;
    }
    
    setTimeError(null);
    setIsEditDialogOpen(false);
    setIsProcessing(true);
    
    try {
      // console.log('[handleEdit] Event to edit:', editingEvent);

      // Get the original date
      const originalDate = new Date(editingEvent.event_time);
      
      // Create a new date with original date but new time
      const newDate = new Date(originalDate);
      newDate.setHours(hour);
      newDate.setMinutes(minute);
      
      // console.log('Updating event time:', {
        // id: editingEvent.id,
        // oldTime: originalDate.toISOString(),
        // newTime: newDate.toISOString()
      // });

      // Update the event. The backend trigger will handle reprocessing.
      const { error: supabaseUpdateError } = await supabase
        .from('time_clock_events')
        .update({ event_time: newDate.toISOString() })
        .eq('id', editingEvent.id);

      if (supabaseUpdateError) throw supabaseUpdateError;

      toast({
        title: 'Success',
        description: 'Event updated successfully. Refreshing data...'
      });

      // Process only this staff member after editing a clock event
      // Get staff ID from the editing event to ensure we have the right value
      const eventStaffId = editingEvent.staff_id;
      console.log(`[AttendanceTimeline] Edit completed for staffId: ${eventStaffId} (prop: ${staffId}), calling onProcessStaff`);
      await onProcessStaff(eventStaffId);
    } catch (error: any) {
      console.error('[Edit Event] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update event',
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Open delete confirmation dialog
  const openDeleteDialog = (event: ClockEvent) => {
    // console.log('[openDeleteDialog] Event:', event);
    setDeletingEvent(event);
    setIsDeleteDialogOpen(true);
  };

  // Handle deleting an event
  const handleDeleteConfirm = async () => {
    if (!deletingEvent) {
      console.error('[handleDeleteConfirm] No event selected for deletion');
      return;
    }
    
    setIsDeleteDialogOpen(false);
    console.log('[handleDeleteConfirm] Starting delete process, setting isProcessing=true');
    setIsProcessing(true);
    
    // Give React a moment to update the UI and show the spinner
    await new Promise(resolve => setTimeout(resolve, 50));
    // console.log('[handleDeleteConfirm] Deleting event:', deletingEvent);

    try {
      // console.log('[handleDeleteConfirm] Deleting event ID:', deletingEvent.id);
      
      const { error } = await supabase
        .from('time_clock_events')
        .delete()
        .eq('id', deletingEvent.id);
        
      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Event deleted successfully. Refreshing data...'
      });

      // Process only this staff member after deleting a clock event
      console.log('[handleDeleteConfirm] Event deleted, now processing segments...');
      await onProcessStaff(staffId);
      console.log('[handleDeleteConfirm] Segment processing complete');
    } catch (error: any) {
      console.error('[Delete Event] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete event',
        variant: 'destructive'
      });
    } finally {
      console.log('[handleDeleteConfirm] Delete process complete, setting isProcessing=false');
      setIsProcessing(false);
    }
  };

  // Handle adding a new event
  const handleAddEvent = async () => {
    if (!eventType || !eventTime) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      });
      return;
    }

    console.log('[AttendanceTimeline] Starting manual event processing, setting isProcessing=true');
    setIsProcessing(true);
    
    // Give React a moment to update the UI and show the spinner
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      if (onAddManualEvent) {
        console.log('[AttendanceTimeline] Calling onAddManualEvent...');
        await onAddManualEvent(staffId, eventType, eventTime, breakType);
        console.log('[AttendanceTimeline] onAddManualEvent completed');
      }

      // Reset form
      setEventType('clock_in');
      setEventTime('');
      setBreakType(null);
      setIsAddingEvent(false);
    } catch (error) {
      console.error('Error adding manual event:', error);
    } finally {
      console.log('[AttendanceTimeline] Manual event processing complete, setting isProcessing=false');
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Staff info and timeline toggle */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <User className="h-6 w-6" />
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium">{staffName}</h3>
            {/* Conditionally render job description if available as a prop */}
            {/* Example: {props.jobDescription && <p className="text-sm text-muted-foreground">{props.jobDescription}</p>} */}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={async () => {
              console.log(`[AttendanceTimeline] Processing staff: ${staffName} (ID: ${staffId})`);
              setIsProcessing(true);
              try {
                await onProcessStaff(staffId);
              } finally {
                setIsProcessing(false);
              }
            }}
            disabled={isProcessing}
            title="Process this staff member's time segments"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-3 text-xs font-semibold"
          onClick={() => setShowTimeline(!showTimeline)}
        >
          {showTimeline ? (
            <div className="flex items-center gap-1">
              <span>Hide Timeline</span>
              <ChevronUp className="h-4 w-4" />
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span>Show Timeline</span>
              <ChevronDown className="h-4 w-4" />
            </div>
          )}
        </Button>
      </div>

      {/* Timeline content */}
      {showTimeline && (
        <div className="space-y-4">
          {/* Hours summary */}
          <div className="grid grid-cols-4 gap-4 rounded-xl border bg-muted/60 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
              {staffEvents.length > 0 ? (
                <span className="inline-flex items-center align-middle rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-100">
                  Present
                </span>
              ) : (
                <span className="inline-flex items-center align-middle rounded-full border px-2 py-1 text-xs font-semibold text-muted-foreground">
                  Absent
                </span>
              )}
              {missingClockOut && (
                <span className="ml-2 inline-flex items-center align-middle rounded-full bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-100 animate-pulse">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Missing clock-out
                </span>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="flex items-center space-x-1 text-2xl font-semibold text-foreground">
                <span>{displayHours.total_hours.toFixed(2)}</span>
                {('unpaid_break_minutes' in displayHours && displayHours.unpaid_break_minutes > 0) && (
                  <span className="text-xs text-muted-foreground">(-{(displayHours.unpaid_break_minutes/60).toFixed(1)}h tea)</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Regular</div>
              <div className="text-2xl font-semibold text-foreground">{displayHours.regular_hours.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Overtime</div>
              <div className="text-2xl font-semibold text-foreground">{displayHours.overtime_hours ? displayHours.overtime_hours.toFixed(2) : '0.00'}</div>
            </div>

          </div>

          {/* Clock Events Timeline */}
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSegments(!showSegments)}
              className="flex h-9 items-center gap-2 rounded-md px-3"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showSegments ? 'rotate-180' : ''}`} />
              <span className="text-sm font-medium">
                {showSegments ? 'Hide Events & Segments' : 'Show Events & Segments'}
              </span>
            </Button>
            
            {showSegments && (
              <div className="mt-4 space-y-4">
                {/* Clock Events Section */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Clock Events</h4>
                  <div className="space-y-2">
                    {staffEvents.map((event) => (
                      <div 
                        key={event.id} 
                        className="group rounded-lg border bg-card/80 p-3"
                      >
                        <div className="flex justify-between items-start">
                          {/* Event details on the left */}
                          <div className="flex items-start space-x-3">
                            <div className={`mt-1 w-3 h-3 rounded-full ${getEventColor(event.event_type)}`} />
                            <div>
                              <div className="flex items-center">
                                <span className="text-sm font-medium text-foreground capitalize">
                                  {event.event_type.replace('_', ' ')} - {format(new Date(event.event_time), 'HH:mm')}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {getVerificationMethod(event.verification_method)}
                                {event.event_type.includes('break') && event.break_type && ` (${event.break_type})`}
                              </div>
                            </div>
                          </div>
                          {/* Edit/Delete buttons on the right */}
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => openEditDialog(event)}
                            >
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7 text-red-500 hover:text-red-400"
                              onClick={() => openDeleteDialog(event)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Work Segments Section */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Work Segments</h4>
                  <div className="space-y-2">
                    {validSegments.map((segment, index) => (
                      <div
                        key={`${segment.staff_id}-${segment.start_time}-${index}`}
                        className="flex items-center justify-between rounded-lg border bg-card/80 p-3"
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              segment.segment_type === 'work' ? 'bg-green-500' : 'bg-yellow-500'
                            }`}
                          />
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              {format(new Date(segment.start_time), 'h:mm a')} - {format(new Date(segment.end_time), 'h:mm a')}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {segment.segment_type === 'work' ? 'Work' : 'Break'}
                              {segment.segment_type === 'break' && segment.break_type && ` (${segment.break_type})`}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-foreground">
                          {Math.round((new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / (1000 * 60))} min
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {staffEvents.length === 0 && staffSegments.length === 0 && (
                  <div className="py-4 text-center text-muted-foreground">
                    No clock events or work segments found for this date.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add event form */}
      {isAddingEvent && (
        <div className="mt-4 rounded-xl border bg-card p-4 shadow-sm">
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-4">
              <Select
                value={eventType}
                onValueChange={setEventType}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Event Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clock_in">Clock In</SelectItem>
                  <SelectItem value="clock_out">Clock Out</SelectItem>
                  <SelectItem value="break_start">Break Start</SelectItem>
                  <SelectItem value="break_end">Break End</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="time"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                lang="en-GB"
                step={60}
              />
              {(eventType === 'break_start' || eventType === 'break_end') && (
                <Select
                  value={breakType || ''}
                  onValueChange={setBreakType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Break Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lunch">Lunch</SelectItem>
                    <SelectItem value="coffee">Coffee</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              <b>Clock In</b> and <b>Clock Out</b> are for work. <b>Break Start</b> and <b>Break End</b> are for breaks.<br />
              Enter times in <b>24-hour format</b> (e.g. 07:00, 17:30) to avoid AM/PM mistakes and keep records accurate.
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAddingEvent(false);
                setEventType('clock_in');
                setEventTime('');
                setBreakType(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddEvent} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Event'
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Add event button */}
      {!isAddingEvent && (
        <div className="mt-4">
          <Button
            size="sm"
            onClick={() => {
              // console.log('Add Event button clicked, setting isAddingEvent to true');
              setIsAddingEvent(true);
            }}
            className="flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </div>
      )}
      
      {/* Custom Time Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="border bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle>Edit time (24-hour format)</DialogTitle>
            <DialogDescription>
              Enter the new time for this clock event.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <label htmlFor="hour" className="text-sm font-medium text-foreground">Hour (0-23)</label>
              <Input
                id="hour"
                type="number"
                min="0"
                max="23"
                value={editHour}
                onChange={(e) => {
                  const val = e.target.value;
                  // Only allow 0-23
                  if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 23)) {
                    setEditHour(val);
                    setTimeError(null);
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="minute" className="text-sm font-medium text-foreground">Minute (0-59)</label>
              <Input
                id="minute"
                type="number"
                min="0"
                max="59"
                value={editMinute}
                onChange={(e) => {
                  const val = e.target.value;
                  // Only allow 0-59
                  if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 59)) {
                    setEditMinute(val);
                    setTimeError(null);
                  }
                }}
              />
            </div>
          </div>
          
          {timeError && (
            <div className="text-red-500 text-sm mb-4">{timeError}</div>
          )}
          
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button 
              onClick={handleEditSubmit}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="border bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this clock event? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {deletingEvent && (
            <div className="my-2 rounded-md border bg-muted/70 p-3">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full ${getEventColor(deletingEvent.event_type)}`} />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {deletingEvent.event_type === 'clock_in' ? 'Clock in' : 'Clock out'} - {format(new Date(deletingEvent.event_time), 'HH:mm')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getVerificationMethod(deletingEvent.verification_method)}
                    {deletingEvent.break_type && ` (${deletingEvent.break_type} break)`}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button 
              onClick={handleDeleteConfirm}
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
