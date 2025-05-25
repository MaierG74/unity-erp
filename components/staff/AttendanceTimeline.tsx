import { useState, useMemo, useRef } from 'react';
import { processClockEventsIntoSegments, generateDailySummary } from '@/lib/utils/attendance';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { ChevronDown, ChevronUp, Plus, User } from 'lucide-react';

interface ClockEvent {
  id: string;
  staff_id: number;
  event_type: string;
  event_time: string;
  verification_method: string;
  break_type?: string | null;
  _loading?: boolean;
  confidence_score?: number | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface Segment {
  id: string;
  staff_id: number;
  segment_type: string;
  duration_minutes: number;
  start_time: string;
  end_time: string;
  date_worked?: string;
  break_type?: string | null;
}

interface TimeSegment {
  id: string;
  staff_id: number;
  segment_type: 'work' | 'break';
  start_time: string;
  end_time: string;
  duration_minutes: number;
  break_type?: string;
}

interface DailySummary {
  staff_id: string;
  total_work_minutes: number;
}

interface AttendanceTimelineProps {
  staffId: string | number;
  staffName: string;
  date: Date;
  clockEvents: ClockEvent[];
  segments: Segment[];
  dailySummaries?: DailySummary[];
  present?: boolean;
  jobDescription?: string;
  onTogglePresence?: () => void;
  onAddManualEvent?: (staffId: string, eventType: string, time: string, breakType?: string | null) => void;
  onSegmentsChanged?: () => void;
};

export function AttendanceTimeline({ 
  staffId, 
  staffName,
  date, 
  clockEvents, 
  segments,
  dailySummaries = [],
  present = true,
  jobDescription = '',
  onTogglePresence,
  onAddManualEvent,
  onSegmentsChanged,
}: AttendanceTimelineProps) {
  const { toast } = useToast();

  const [showTimeline, setShowTimeline] = useState(true);
  const [showSegments, setShowSegments] = useState(false);
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [eventType, setEventType] = useState<string>('');
  const [eventTime, setEventTime] = useState('');
  const [breakType, setBreakType] = useState<string | null>(null);
  
  // Time edit dialog states
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ClockEvent | null>(null);
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('');
  const [timeError, setTimeError] = useState<string | null>(null);

  // Convert staffId to number for comparison since database uses number type
  const numericStaffId = Number(staffId);
  const staffEvents = clockEvents.filter(event => Number(event.staff_id) === numericStaffId);

  // Detect missing clock-out: if last event is clock_in and no subsequent clock_out
  let missingClockOut = false;
  if (staffEvents.length > 0) {
    const lastEvent = staffEvents[staffEvents.length - 1];
    if (lastEvent.event_type === 'clock_in') {
      missingClockOut = true;
    }
  }
  const staffSegments = segments.filter(segment => Number(segment.staff_id) === numericStaffId);

  // Debug: Log incoming props and filtered data
  console.log('[AttendanceTimeline] staffId:', staffId, 'type:', typeof staffId, 'numericStaffId:', numericStaffId);
  console.log('[AttendanceTimeline] segments:', segments);
  console.log('[AttendanceTimeline] clockEvents:', clockEvents);
  console.log('[AttendanceTimeline] Filtered staffEvents:', staffEvents);
  console.log('[AttendanceTimeline] Filtered staffSegments:', staffSegments);

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
    console.log('Calculating hours from staffSegments:', staffSegments);
    
    // Calculate total minutes from start_time and end_time
    const totalMinutes = staffSegments.reduce((acc, segment) => {
      // Parse start and end times
      try {
        const startTime = new Date(segment.start_time);
        const endTime = new Date(segment.end_time);
        
        // Calculate duration in minutes
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = Math.round(durationMs / (1000 * 60));
        
        console.log('Segment duration calculation:', {
          segment: segment.id,
          start: startTime.toISOString(),
          end: endTime.toISOString(),
          durationMinutes
        });
        
        // All segments are considered work segments unless specified otherwise
        // We could add additional checks here if needed
        return acc + (durationMinutes > 0 ? durationMinutes : 0);
      } catch (error) {
        console.error('Error calculating segment duration:', error, segment);
        return acc;
      }
    }, 0);
    
    console.log('Total minutes calculated:', totalMinutes);
    
    const regularMinutes = Math.min(totalMinutes, 8 * 60); // 8 hours in minutes
    const overtimeMinutes = Math.max(0, totalMinutes - 8 * 60);

    const firstEvent = staffEvents[0];
    const verificationMethod = firstEvent?.verification_method || 'manual';

    const result = {
      total_hours: totalMinutes / 60,
      regular_hours: regularMinutes / 60,
      overtime_hours: overtimeMinutes / 60,
      verification_method: verificationMethod
    };
    
    console.log('Final hours calculation:', result);
    return result;
  }, [staffSegments, staffEvents]);

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
    
    try {
      console.log('[handleEdit] Initial clockEvents prop:', clockEvents);
      console.log('[handleEdit] Event to edit:', editingEvent);

      // Get the original date
      const originalDate = new Date(editingEvent.event_time);
      
      // Create a new date with original date but new time
      const newDate = new Date(originalDate);
      newDate.setHours(hour);
      newDate.setMinutes(minute);
      
      console.log('Updating event time:', {
        id: editingEvent.id,
        oldTime: originalDate.toISOString(),
        newTime: newDate.toISOString()
      });

      // Update the event and get the updated row
      const { data: supabaseUpdateData, error: supabaseUpdateError } = await supabase
        .from('time_clock_events')
        .update({ event_time: newDate.toISOString() })
        .eq('id', editingEvent.id)
        .select(); // Add .select() to get the updated row(s)

      console.log('[handleEdit] Supabase update result:', { supabaseUpdateData, supabaseUpdateError });

      if (supabaseUpdateError) throw supabaseUpdateError;
      
      // Determine the date of the event for reprocessing
      // newDate holds the event's date after modification
      const dateToReprocess = format(newDate, 'yyyy-MM-dd');
      console.log('Processing segments for date:', dateToReprocess);
      
      try {
        // Call the utility function to regenerate segments for the event's actual date
        await processClockEventsIntoSegments(dateToReprocess);
        console.log('Successfully processed segments after edit');
        
        // Also regenerate daily summary for that date
        await generateDailySummary(dateToReprocess);
        console.log('Successfully regenerated daily summary');
      } catch (processingError) {
        console.error('Error processing segments after edit:', processingError);
      }

      toast({
        title: 'Success',
        description: 'Event updated successfully'
      });

      // Notify parent to refresh data
      if (onSegmentsChanged) {
        onSegmentsChanged();
      }
    } catch (error: any) {
      console.error('[Edit Event] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update event',
        variant: 'destructive'
      });
    }
  };

  // Handle deleting an event
  const handleDelete = async (event: ClockEvent) => {
    if (!window.confirm('Are you sure you want to delete this event?')) {
      return;
    }

    try {
      console.log('Deleting event:', event.id);
      
      const { error } = await supabase
        .from('time_clock_events')
        .delete()
        .eq('id', event.id);

      if (error) throw error;
      
      // Determine the date of the event for reprocessing
      const eventDate = new Date(event.event_time);
      const dateToReprocess = format(eventDate, 'yyyy-MM-dd');
      console.log('Processing segments after delete for date:', dateToReprocess);

      try {
        // Call the utility function to regenerate segments for the event's actual date
        await processClockEventsIntoSegments(dateToReprocess);
        console.log('Successfully processed segments after delete');

        // Also regenerate daily summary for that date
        await generateDailySummary(dateToReprocess);
        console.log('Successfully regenerated daily summary after delete');
      } catch (processingError) {
        console.error('Error processing segments after delete:', processingError);
      }

      toast({
        title: 'Success',
        description: 'Event deleted successfully'
      });

      // Wait for backend to process (optional)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Notify parent to refresh data
      if (onSegmentsChanged) {
        onSegmentsChanged();
      }
    } catch (error: any) {
      console.error('[Delete Event] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete event',
        variant: 'destructive'
      });
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

    try {
      // Get the current date
      const now = new Date();
      
      // Parse the time input
      const [hours, minutes] = eventTime.split(':').map(Number);
      
      // Create a new date with today's date and selected time
      const eventDate = new Date(now);
      eventDate.setHours(hours);
      eventDate.setMinutes(minutes);

      // Prepare the event data
      const eventData = {
        staff_id: staffId,
        event_type: eventType,
        event_time: eventDate.toISOString(),
        verification_method: 'manual',
        break_type: (eventType === 'break_start' || eventType === 'break_end') ? breakType : null
      };

      // Insert the event
      const { error } = await supabase
        .from('time_clock_events')
        .insert(eventData);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Event added successfully'
      });

      // Reset form
      setEventType('');
      setEventTime('');
      setBreakType(null);
      setIsAddingEvent(false);

      // Wait for backend to process
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh the page
      window.location.reload();
    } catch (error: any) {
      console.error('[Add Event] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add event',
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Staff info and timeline toggle */}
      <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg">
        <div className="flex items-center space-x-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center">
              <User className="w-6 h-6 text-gray-400" />
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">{staffName}</h3>
            {jobDescription && (
              <p className="text-sm text-gray-400">{jobDescription}</p>
            )}
          </div>
        </div>
        <button
          className="text-xs px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600 transition"
          onClick={() => setShowTimeline(!showTimeline)}
        >
          {showTimeline ? (
            <div className="flex items-center space-x-1">
              <span>Hide Timeline</span>
              <ChevronUp className="w-4 h-4" />
            </div>
          ) : (
            <div className="flex items-center space-x-1">
              <span>Show Timeline</span>
              <ChevronDown className="w-4 h-4" />
            </div>
          )}
        </button>
      </div>

      {/* Timeline content */}
      {showTimeline && (
        <div className="space-y-4">
          {/* Hours summary */}
          <div className="grid grid-cols-4 gap-4 p-4 bg-gray-800 rounded-md">
            <div>
              <div className="text-xs text-gray-400">Status</div>
              {staffEvents.length > 0 ? (
                <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-green-600 text-white">Present</span>
              ) : (
                <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-gray-600 text-gray-300">Absent</span>
              )}
              {missingClockOut && (
                <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-semibold rounded bg-yellow-600 text-white animate-pulse">
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Missing clock-out
                </span>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-400">Total</div>
              <div className="text-xl text-white">{displayHours.total_hours.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Regular</div>
              <div className="text-xl text-white">{displayHours.regular_hours.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Overtime</div>
              <div className="text-xl text-white">{displayHours.overtime_hours ? displayHours.overtime_hours.toFixed(2) : '0.00'}</div>
            </div>

          </div>

          {/* Clock Events Timeline */}
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSegments(!showSegments)}
              className="flex items-center text-white border-gray-700 hover:bg-gray-800 h-9 rounded-md px-3"
            >
              <ChevronDown className="w-4 h-4 mr-1" />
              {showSegments ? 'Hide Events & Segments' : 'Show Events & Segments'}
            </Button>
            
            {showSegments && (
              <div className="mt-4 space-y-4">
                {/* Clock Events Section */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-400">Clock Events</h4>
                  <div className="space-y-2">
                    {staffEvents.map((event) => (
                      <div 
                        key={event.id} 
                        className="p-3 bg-gray-800 rounded-lg group"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-start space-x-3">
                            <div className={`mt-1 w-3 h-3 rounded-full ${getEventColor(event.event_type)}`} />
                            <div>
                              <div className="flex items-center">
                                <span className="text-sm font-medium text-white">
                                  {event.event_type === 'clock_in' ? 'clock in' : 'clock out'} - {format(new Date(event.event_time), 'HH:mm')}
                                </span>
                              </div>
                              <div className="text-xs text-gray-400">
                                {getVerificationMethod(event.verification_method)}
                                {event.break_type && ` (${event.break_type} break)`}
                              </div>
                            </div>
                          </div>
                          {/* Edit/Delete buttons for clock events */}
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              className={`text-xs px-2 py-1 bg-yellow-600 rounded hover:bg-yellow-500 text-black ${event._loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                              disabled={!!event._loading}
                              onClick={() => openEditDialog(event)}
                            >Edit</button>
                            <button
                              className={`text-xs px-2 py-1 bg-red-600 rounded hover:bg-red-500 text-white ${event._loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                              disabled={!!event._loading}
                              onClick={() => handleDelete(event)}
                            >Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Work Segments Section */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-400">Work Segments</h4>
                  <div className="space-y-2">
                    {staffSegments.map((segment, index) => (
                      <div
                        key={`${segment.staff_id}-${segment.start_time}-${index}`}
                        className="flex items-center justify-between p-3 bg-gray-800 rounded-lg"
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              segment.segment_type === 'work' ? 'bg-green-500' : 'bg-yellow-500'
                            }`}
                          />
                          <div>
                            <div className="text-sm font-medium text-white">
                              {format(new Date(segment.start_time), 'h:mm a')} - {format(new Date(segment.end_time), 'h:mm a')}
                            </div>
                            <div className="text-xs text-gray-400">
                              {segment.segment_type === 'work' ? 'Work' : 'Break'}
                              {segment.break_type && ` (${segment.break_type})`}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-white">
                          {Math.round((new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / (1000 * 60))} min
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {staffEvents.length === 0 && staffSegments.length === 0 && (
                  <div className="text-center text-gray-400 py-4">
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
        <div className="mt-4 p-4 bg-gray-800 rounded-md">
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

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsAddingEvent(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleAddEvent}>Add Event</Button>
          </div>
        </div>
      )}

      {/* Add event button */}
      {!isAddingEvent && (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddingEvent(true)}
            className="flex items-center text-white border-gray-700 hover:bg-gray-800"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Event
          </Button>
        </div>
      )}
      
      {/* Custom Time Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Edit time (24-hour format)</DialogTitle>
            <DialogDescription className="text-gray-400">
              Enter the new time for this clock event.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <label htmlFor="hour" className="text-sm font-medium text-gray-300">Hour (0-23)</label>
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
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="minute" className="text-sm font-medium text-gray-300">Minute (0-59)</label>
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
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
          </div>
          
          {timeError && (
            <div className="text-red-500 text-sm mb-4">{timeError}</div>
          )}
          
          <DialogFooter className="flex justify-end space-x-2">
            <DialogClose asChild>
              <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white">
                Cancel
              </Button>
            </DialogClose>
            <Button 
              onClick={handleEditSubmit}
              className="bg-[#F26B3A] hover:bg-[#E25A29] text-white"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
