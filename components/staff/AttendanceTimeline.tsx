import { useState, useMemo } from 'react';
import { processClockEventsIntoSegments, generateDailySummary } from '@/lib/utils/attendance';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

  // Convert staffId to number for comparison since database uses number type
  const numericStaffId = Number(staffId);
  const staffEvents = clockEvents.filter(event => Number(event.staff_id) === numericStaffId);
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

  // Handle editing an event
  const handleEdit = async (event: ClockEvent) => {
    console.log('[handleEdit] Initial clockEvents prop:', clockEvents);
    console.log('[handleEdit] Event to edit:', event);
    try {
      const newTime = prompt('Edit time (HH:mm):', format(new Date(event.event_time), 'HH:mm'));
      if (!newTime) return;

      // Get the original date
      const originalDate = new Date(event.event_time);
      
      // Parse the new time
      const [hours, minutes] = newTime.split(':').map(Number);
      
      // Create a new date with original date but new time
      const newDate = new Date(originalDate);
      newDate.setHours(hours);
      newDate.setMinutes(minutes);
      
      console.log('Updating event time:', {
        id: event.id,
        oldTime: originalDate.toISOString(),
        newTime: newDate.toISOString()
      });

      // Update the event and get the updated row
      const { data: supabaseUpdateData, error: supabaseUpdateError } = await supabase
        .from('time_clock_events')
        .update({ event_time: newDate.toISOString() })
        .eq('id', event.id)
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
                {staffEvents.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-400">Clock Events</h4>
                    <div className="space-y-2">
                      {staffEvents.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-center justify-between p-3 bg-gray-700 rounded-lg"
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`w-3 h-3 rounded-full ${getEventColor(event.event_type)}`} />
                            <div>
                              <div className="text-sm font-medium text-white">
                                {format(new Date(event.event_time), 'h:mm a')} - {event.event_type.replace('_', ' ')}
                              </div>
                              <div className="text-xs text-gray-400">
                                {getVerificationMethod(event.verification_method)}
                                {event.break_type && ` (${event.break_type} break)`}
                              </div>
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEdit(event)}
                              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(event)}
                              className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Work Segments Section */}
                {staffSegments.length > 0 && (
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
                )}
                
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
    </div>
  );
}
