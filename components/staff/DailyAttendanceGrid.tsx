'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { format, parseISO, isToday, isSunday } from 'date-fns';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { 
  AlertCircle, 
  CalendarIcon, 
  ChevronDown,
  ChevronUp,
  Coffee, 
  Loader2, 
  Save 
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';

// Types
type Staff = {
  staff_id: number;
  first_name: string;
  last_name: string;
  job_description: string | null;
  is_active: boolean;
  current_staff: boolean;
};

type StaffHours = {
  hours_id?: number;
  staff_id: number;
  date_worked: string;
  hours_worked: number;
  start_time: string | null;
  end_time: string | null;
  break_duration: number;
  lunch_break_taken: boolean;
  morning_break_taken: boolean;
  afternoon_break_taken: boolean;
  is_holiday: boolean;
  overtime_hours: number;
  overtime_rate: number;
  notes: string | null;
};

type PublicHoliday = {
  holiday_id: number;
  holiday_date: string;
  holiday_name: string;
};

type AttendanceRecord = StaffHours & {
  present: boolean;
  staff_name: string;
  job_description: string | null;
  isEditing: boolean;
};

// Default values
const DEFAULT_BREAK_DURATION = 0.5; // 30 minutes lunch break

// Default times based on day of week
const getDefaultTimes = (date: Date) => {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  switch (dayOfWeek) {
    case 0: // Sunday
      return {
        startTime: '08:00',
        endTime: '14:00',
        hoursWorked: 6, // 8am to 2pm
        morningBreak: false,
        afternoonBreak: false
      };
    case 5: // Friday
      return {
        startTime: '07:00',
        endTime: '14:00',
        hoursWorked: 7, // 7am to 2pm
        morningBreak: false,
        afternoonBreak: false
      };
    case 6: // Saturday
      return {
        startTime: '08:00',
        endTime: '14:00',
        hoursWorked: 6, // 8am to 2pm
        morningBreak: false,
        afternoonBreak: false
      };
    default: // Monday to Thursday
      return {
        startTime: '07:00',
        endTime: '17:00',
        hoursWorked: 10, // 7am to 5pm
        morningBreak: true,
        afternoonBreak: true
      };
  }
};

export function DailyAttendanceGrid() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [isHoliday, setIsHoliday] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sortField, setSortField] = useState<string>('staff_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch active staff
  const { data: activeStaff = [], isLoading: isLoadingStaff } = useQuery({
    queryKey: ['staff', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name, job_description, is_active, current_staff')
        .eq('is_active', true)
        .eq('current_staff', true)
        .order('last_name', { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch public holidays
  const { data: publicHolidays = [] } = useQuery({
    queryKey: ['public_holidays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_holidays')
        .select('*');

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch existing hours records for the selected date
  const { data: existingHours = [], isLoading: isLoadingHours } = useQuery({
    queryKey: ['staff_hours', format(selectedDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('staff_hours')
        .select('*')
        .eq('date_worked', dateStr);

      if (error) throw error;
      return data || [];
    },
  });

  // Save hours mutation
  const saveHoursMutation = useMutation({
    mutationFn: async (records: StaffHours[]) => {
      // Filter out records where present is false (absent staff)
      const recordsToSave = records.filter(record => record.hours_worked > 0);
      
      // Get the date string for the selected date
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      
      // If no records to save, we need to check if there are existing records to delete
      if (recordsToSave.length === 0) {
        // Get all existing records for this date
        const { data: existingRecords, error: fetchError } = await supabase
          .from('staff_hours')
          .select('hours_id')
          .eq('date_worked', dateStr);
        
        if (fetchError) {
          console.error('Error fetching existing records:', fetchError);
          throw fetchError;
        }
        
        // If there are existing records, delete them
        if (existingRecords && existingRecords.length > 0) {
          const { error: deleteError } = await supabase
            .from('staff_hours')
            .delete()
            .eq('date_worked', dateStr);
          
          if (deleteError) {
            console.error('Error deleting records:', deleteError);
            throw deleteError;
          }
          
          console.log(`Deleted ${existingRecords.length} records for ${dateStr}`);
        }
        
        setIsSaving(false);
        return;
      }

      console.log('Records to save:', JSON.stringify(recordsToSave, null, 2));

      // First try to insert new records
      for (const record of recordsToSave) {
        try {
          // If we have an hours_id, update the existing record
          if (record.hours_id) {
            const { error } = await supabase
              .from('staff_hours')
              .update({
                hours_worked: record.hours_worked,
                start_time: record.start_time,
                end_time: record.end_time,
                break_duration: record.break_duration,
                lunch_break_taken: record.lunch_break_taken,
                morning_break_taken: record.morning_break_taken,
                afternoon_break_taken: record.afternoon_break_taken,
                is_holiday: record.is_holiday,
                overtime_hours: record.overtime_hours,
                overtime_rate: record.overtime_rate,
                notes: record.notes
              })
              .eq('hours_id', record.hours_id);
            
            if (error) {
              console.error('Error updating record:', error);
              throw error;
            }
          } else {
            // Insert a new record
            const { error } = await supabase
              .from('staff_hours')
              .insert({
                staff_id: record.staff_id,
                date_worked: record.date_worked,
                hours_worked: record.hours_worked,
                start_time: record.start_time,
                end_time: record.end_time,
                break_duration: record.break_duration,
                lunch_break_taken: record.lunch_break_taken,
                morning_break_taken: record.morning_break_taken,
                afternoon_break_taken: record.afternoon_break_taken,
                is_holiday: record.is_holiday,
                overtime_hours: record.overtime_hours,
                overtime_rate: record.overtime_rate,
                notes: record.notes
              });
            
            if (error) {
              console.error('Error inserting record:', error);
              throw error;
            }
          }
        } catch (error) {
          console.error('Error processing record:', error);
          setIsSaving(false);
          throw error;
        }
      }
      
      return { success: true };
    },
    onSuccess: () => {
      // Update UI state
      setIsSaving(false);
      setLastSaved(new Date());
      
      // Refresh data - invalidate all staff_hours related queries with a single call
      queryClient.invalidateQueries({ queryKey: ['staff_hours'] });
      
      // Show success notification with more details
      toast({
        title: 'Attendance Saved',
        description: `Records updated for ${format(selectedDate, 'EEEE, MMMM d, yyyy')}. Staff present: ${attendanceRecords.filter(r => r.present).length}`,
        duration: 6000, // Show for 6 seconds
      });
    },
    onError: (error: any) => {
      // Update UI state
      setIsSaving(false);
      
      console.error('Error saving attendance records:', error);
      toast({
        title: 'Error',
        description: `Failed to save attendance records: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  // Initialize attendance records when staff or existing hours data changes
  useEffect(() => {
    if (activeStaff.length === 0) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    
    // Check if the selected date is a holiday
    const holiday = publicHolidays.find(h => h.holiday_date === dateStr);
    const isSundayDate = isSunday(selectedDate);
    
    setIsHoliday(!!holiday || isSundayDate);
    setHolidayName(holiday?.holiday_name || (isSundayDate ? 'Sunday' : ''));

    // Create attendance records for each staff member
    const records = activeStaff.map(staff => {
      // Check if there's an existing record for this staff member on this date
      const existingRecord = existingHours.find(h => h.staff_id === staff.staff_id);

      if (existingRecord) {
        // Use existing record data
        return {
          ...existingRecord,
          present: existingRecord.hours_worked > 0,
          staff_name: `${staff.first_name} ${staff.last_name}`,
          job_description: staff.job_description,
          isEditing: false,
        };
      } else {
        // Create a new record with default values
        const defaults = getDefaultTimes(selectedDate);
        const defaultRecord = {
          staff_id: staff.staff_id,
          date_worked: dateStr,
          start_time: defaults.startTime,
          end_time: defaults.endTime,
          break_duration: DEFAULT_BREAK_DURATION,
          lunch_break_taken: true,
          morning_break_taken: defaults.morningBreak,
          afternoon_break_taken: defaults.afternoonBreak,
          is_holiday: !!holiday || isSundayDate,
          overtime_hours: 0,
          overtime_rate: (!!holiday || isSundayDate) ? 2.0 : 1.5,
          notes: null,
          present: false, // Not marked as present by default
          staff_name: `${staff.first_name} ${staff.last_name}`,
          job_description: staff.job_description,
          isEditing: false,
          hours_worked: 0, // Default to 0 until marked present
        };

        return defaultRecord;
      }
    });

    setAttendanceRecords(records);
    
    // Reset last saved timestamp when changing date
    setLastSaved(null);
  }, [activeStaff, existingHours, selectedDate, publicHolidays]);

  // Calculate hours worked based on start and finish times
  const calculateHoursWorked = (startTime: string, endTime: string, 
    morningBreak: boolean, afternoonBreak: boolean, lunchBreak: boolean): number => {
    if (!startTime || !endTime) return 0;
    
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    // Convert to minutes since midnight
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    
    // Calculate total minutes worked
    let totalMinutes = endMinutes - startMinutes;
    
    // Handle negative time (overnight shift)
    if (totalMinutes < 0) {
      totalMinutes += 24 * 60; // Add 24 hours in minutes
    }
    
    // Adjust for breaks
    if (morningBreak) totalMinutes -= 15; // 15 min morning break (unpaid)
    if (afternoonBreak) totalMinutes -= 15; // 15 min afternoon break (unpaid)
    if (!lunchBreak) totalMinutes += 30; // Add 30 min if lunch break NOT taken (extra work)
    
    // Convert back to hours (rounded to 2 decimal places)
    return Math.max(0, parseFloat((totalMinutes / 60).toFixed(2)));
  };

  // Toggle staff presence - fixed to prevent infinite updates
  const togglePresence = (staffId: number) => {
    const defaults = getDefaultTimes(selectedDate);
    
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          const present = !record.present;
          
          if (present) {
            // If toggling to present, use day-specific defaults if times aren't set
            const startTime = record.start_time || defaults.startTime;
            const endTime = record.end_time || defaults.endTime;
            
            // Use defaults for breaks if not already set
            const morningBreak = record.morning_break_taken !== undefined ? 
              record.morning_break_taken : defaults.morningBreak;
            const afternoonBreak = record.afternoon_break_taken !== undefined ? 
              record.afternoon_break_taken : defaults.afternoonBreak;
            
            // Calculate hours based on current break settings
            const newHoursWorked = calculateHoursWorked(
              startTime, 
              endTime,
              morningBreak,
              afternoonBreak,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              present,
              isEditing: true, // Automatically enable editing when marked present
              start_time: startTime,
              end_time: endTime,
              morning_break_taken: morningBreak,
              afternoon_break_taken: afternoonBreak,
              hours_worked: newHoursWorked
            };
          } else {
            // If not present, set hours to 0
            return {
              ...record,
              present,
              isEditing: false, // Disable editing when not present
              hours_worked: 0
            };
          }
        }
        return record;
      })
    );
  };

  // Toggle lunch break taken - fixed to prevent infinite updates
  const toggleLunchBreak = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          const lunchBreakTaken = !record.lunch_break_taken;
          let newHoursWorked = record.hours_worked;
          
          // Only adjust hours if the staff member is present
          if (record.present) {
            // Lunch break is PAID by default, so ADD 30 min if NOT taking lunch
            if (lunchBreakTaken) {
              // Taking lunch now, but wasn't before - remove the 30 min bonus
              if (!record.lunch_break_taken) {
                newHoursWorked -= 0.5;
              }
            } else {
              // Not taking lunch now, but was before - add the 30 min bonus
              if (record.lunch_break_taken) {
                newHoursWorked += 0.5;
              }
            }
          } else {
            newHoursWorked = 0;
          }
          
          return {
            ...record,
            lunch_break_taken: lunchBreakTaken,
            hours_worked: newHoursWorked
          };
        }
        return record;
      })
    );
  };

  // Toggle morning break taken - fixed to prevent infinite updates
  const toggleMorningBreak = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          const morningBreakTaken = !record.morning_break_taken;
          let newHoursWorked = record.hours_worked;
          
          // Only adjust hours if the staff member is present
          if (record.present) {
            // Morning break is unpaid by default
            if (morningBreakTaken) {
              // Taking break now, but wasn't before - subtract 15 min
              if (!record.morning_break_taken) {
                newHoursWorked -= 0.25;
              }
            } else {
              // Not taking break now, but was before - add 15 min
              if (record.morning_break_taken) {
                newHoursWorked += 0.25;
              }
            }
          } else {
            newHoursWorked = 0;
          }
          
          return {
            ...record,
            morning_break_taken: morningBreakTaken,
            hours_worked: newHoursWorked
          };
        }
        return record;
      })
    );
  };

  // Toggle afternoon break taken - fixed to prevent infinite updates
  const toggleAfternoonBreak = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          const afternoonBreakTaken = !record.afternoon_break_taken;
          let newHoursWorked = record.hours_worked;
          
          // Only adjust hours if the staff member is present
          if (record.present) {
            // Afternoon break is unpaid by default
            if (afternoonBreakTaken) {
              // Taking break now, but wasn't before - subtract 15 min
              if (!record.afternoon_break_taken) {
                newHoursWorked -= 0.25;
              }
            } else {
              // Not taking break now, but was before - add 15 min
              if (record.afternoon_break_taken) {
                newHoursWorked += 0.25;
              }
            }
          } else {
            newHoursWorked = 0;
          }
          
          return {
            ...record,
            afternoon_break_taken: afternoonBreakTaken,
            hours_worked: newHoursWorked
          };
        }
        return record;
      })
    );
  };

  // Update hours worked
  const updateHoursWorked = (staffId: number, hours: string) => {
    const hoursValue = parseFloat(hours);
    if (isNaN(hoursValue)) return;

    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          return {
            ...record,
            hours_worked: hoursValue,
            present: hoursValue > 0,
          };
        }
        return record;
      })
    );
  };

  // Handle start time change - fixed to prevent infinite updates
  const handleStartTimeChange = (staffId: number, time: string) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          // Only recalculate hours if the staff member is present
          if (record.present && time) {
            const newHoursWorked = calculateHoursWorked(
              time, 
              record.end_time || '', 
              record.morning_break_taken,
              record.afternoon_break_taken,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              start_time: time,
              hours_worked: newHoursWorked
            };
          } else {
            return {
              ...record,
              start_time: time
            };
          }
        }
        return record;
      })
    );
  };

  // Handle finish time change - fixed to prevent infinite updates
  const handleFinishTimeChange = (staffId: number, time: string) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          // Only recalculate hours if the staff member is present
          if (record.present && time) {
            const newHoursWorked = calculateHoursWorked(
              record.start_time || '', 
              time,
              record.morning_break_taken,
              record.afternoon_break_taken,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              end_time: time,
              hours_worked: newHoursWorked
            };
          } else {
            return {
              ...record,
              end_time: time
            };
          }
        }
        return record;
      })
    );
  };

  // Update notes
  const updateNotes = (staffId: number, notes: string) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          return {
            ...record,
            notes,
          };
        }
        return record;
      })
    );
  };

  // Mark all staff as present with default values
  const markAllPresent = () => {
    const defaults = getDefaultTimes(selectedDate);
    
    setAttendanceRecords(prev => 
      prev.map(record => {
        // Calculate hours based on day-specific defaults
        const newHoursWorked = calculateHoursWorked(
          defaults.startTime, 
          defaults.endTime,
          defaults.morningBreak,
          defaults.afternoonBreak,
          true // lunch break taken by default
        );
        
        return {
          ...record,
          present: true,
          start_time: defaults.startTime,
          end_time: defaults.endTime,
          morning_break_taken: defaults.morningBreak,
          afternoon_break_taken: defaults.afternoonBreak,
          hours_worked: newHoursWorked,
        };
      })
    );
  };

  // Save all attendance records
  const saveAttendance = () => {
    // Prepare records for saving
    const recordsToSave = attendanceRecords
      .filter(record => record.present)
      .map(({ present, staff_name, job_description, isEditing, ...record }) => {
        // Create a clean record with only the fields expected by the database
        const cleanRecord: any = {
          staff_id: record.staff_id,
          date_worked: record.date_worked,
          hours_worked: record.hours_worked,
          start_time: record.start_time,
          end_time: record.end_time,
          break_duration: record.break_duration,
          lunch_break_taken: record.lunch_break_taken,
          morning_break_taken: record.morning_break_taken,
          afternoon_break_taken: record.afternoon_break_taken,
          is_holiday: record.is_holiday,
          overtime_hours: record.overtime_hours,
          overtime_rate: record.is_holiday ? 2.0 : 1.5,
          notes: record.notes
        };
        
        // Only include hours_id if it exists (for updates)
        if (record.hours_id) {
          cleanRecord.hours_id = record.hours_id;
        }
        
        return cleanRecord;
      });

    // Show saving indicator
    setIsSaving(true);
    
    // If no staff are present, show a confirmation dialog
    if (recordsToSave.length === 0) {
      const hasExistingRecords = attendanceRecords.some(record => record.hours_id);
      
      if (hasExistingRecords) {
        if (window.confirm('No staff are marked as present. This will remove all attendance records for this date. Continue?')) {
          console.log('Proceeding with deletion of all records for this date');
          saveHoursMutation.mutate([]);
        } else {
          setIsSaving(false);
        }
      } else {
        // No existing records, nothing to delete
        toast({
          title: 'No changes',
          description: 'No staff are marked as present and no existing records found.',
        });
        setIsSaving(false);
      }
    } else {
      // Normal save with records
      console.log('Records prepared for saving:', JSON.stringify(recordsToSave, null, 2));
      saveHoursMutation.mutate(recordsToSave);
    }
  };

  // Increment time by 5 minutes
  const incrementTime = (time: string): string => {
    if (!time) return '';
    
    const [hours, minutes] = time.split(':').map(Number);
    let newMinutes = minutes + 5;
    let newHours = hours;
    
    if (newMinutes >= 60) {
      newMinutes = newMinutes - 60;
      newHours = (newHours + 1) % 24;
    }
    
    return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
  };
  
  // Decrement time by 5 minutes
  const decrementTime = (time: string): string => {
    if (!time) return '';
    
    const [hours, minutes] = time.split(':').map(Number);
    let newMinutes = minutes - 5;
    let newHours = hours;
    
    if (newMinutes < 0) {
      newMinutes = newMinutes + 60;
      newHours = (newHours - 1 + 24) % 24;
    }
    
    return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
  };
  
  // Increment start time - fixed to prevent infinite updates
  const incrementStartTime = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId && record.start_time) {
          const newTime = incrementTime(record.start_time);
          
          // Only recalculate hours if the staff member is present
          if (record.present) {
            const newHoursWorked = calculateHoursWorked(
              newTime, 
              record.end_time || '', 
              record.morning_break_taken,
              record.afternoon_break_taken,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              start_time: newTime,
              hours_worked: newHoursWorked
            };
          } else {
            return {
              ...record,
              start_time: newTime
            };
          }
        }
        return record;
      })
    );
  };
  
  // Decrement start time - fixed to prevent infinite updates
  const decrementStartTime = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId && record.start_time) {
          const newTime = decrementTime(record.start_time);
          
          // Only recalculate hours if the staff member is present
          if (record.present) {
            const newHoursWorked = calculateHoursWorked(
              newTime, 
              record.end_time || '', 
              record.morning_break_taken,
              record.afternoon_break_taken,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              start_time: newTime,
              hours_worked: newHoursWorked
            };
          } else {
            return {
              ...record,
              start_time: newTime
            };
          }
        }
        return record;
      })
    );
  };
  
  // Increment end time - fixed to prevent infinite updates
  const incrementEndTime = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId && record.end_time) {
          const newTime = incrementTime(record.end_time);
          
          // Only recalculate hours if the staff member is present
          if (record.present) {
            const newHoursWorked = calculateHoursWorked(
              record.start_time || '', 
              newTime,
              record.morning_break_taken,
              record.afternoon_break_taken,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              end_time: newTime,
              hours_worked: newHoursWorked
            };
          } else {
            return {
              ...record,
              end_time: newTime
            };
          }
        }
        return record;
      })
    );
  };
  
  // Decrement end time - fixed to prevent infinite updates
  const decrementEndTime = (staffId: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId && record.end_time) {
          const newTime = decrementTime(record.end_time);
          
          // Only recalculate hours if the staff member is present
          if (record.present) {
            const newHoursWorked = calculateHoursWorked(
              record.start_time || '', 
              newTime,
              record.morning_break_taken,
              record.afternoon_break_taken,
              record.lunch_break_taken
            );
            
            return {
              ...record,
              end_time: newTime,
              hours_worked: newHoursWorked
            };
          } else {
            return {
              ...record,
              end_time: newTime
            };
          }
        }
        return record;
      })
    );
  };

  // Sort function for attendance records
  const sortRecords = (records: AttendanceRecord[]): AttendanceRecord[] => {
    return [...records].sort((a, b) => {
      let valueA, valueB;
      
      // Get the values to compare based on the sort field
      switch (sortField) {
        case 'staff_name':
          valueA = a.staff_name;
          valueB = b.staff_name;
          break;
        case 'job_description':
          valueA = a.job_description || '';
          valueB = b.job_description || '';
          break;
        case 'hours_worked':
          valueA = a.hours_worked;
          valueB = b.hours_worked;
          break;
        default:
          valueA = a.staff_name;
          valueB = b.staff_name;
      }
      
      // Compare the values based on their type
      if (typeof valueA === 'string' && typeof valueB === 'string') {
        const comparison = valueA.localeCompare(valueB);
        return sortDirection === 'asc' ? comparison : -comparison;
      } else {
        // For numbers or other types
        if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
        if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      }
    });
  };
  
  // Handle sort click
  const handleSort = (field: string) => {
    if (sortField === field) {
      // If already sorting by this field, toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // If sorting by a new field, set it and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  // Get sorted records
  const sortedRecords = sortRecords(attendanceRecords);

  // Handle overtime hours change
  const handleOvertimeChange = (staffId: number, hours: number) => {
    setAttendanceRecords(prev => 
      prev.map(record => {
        if (record.staff_id === staffId) {
          return {
            ...record,
            overtime_hours: hours
          };
        }
        return record;
      })
    );
  };

  // Loading state
  if (isLoadingStaff || isLoadingHours) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Loading attendance data...</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Daily Attendance</CardTitle>
            <div className="flex items-center mt-1">
              <CardDescription className="mr-2">
                Record staff attendance and hours for {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </CardDescription>
              {isHoliday && (
                <Badge variant="outline">
                  {holidayName}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, 'PPP') : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                  defaultMonth={selectedDate}
                  fixedWeeks={true}
                  disableNavigation={false}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {isHoliday && (
          <Alert className="mt-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {isSunday(selectedDate) 
                ? "Sunday work is paid at double time (2.0x)" 
                : `${holidayName} is a public holiday and is paid at double time (2.0x)`}
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Present</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('staff_name')}
                >
                  <div className="flex items-center">
                    Staff Member
                    {sortField === 'staff_name' && (
                      sortDirection === 'asc' ? 
                        <ChevronUp className="ml-1 h-4 w-4" /> : 
                        <ChevronDown className="ml-1 h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('job_description')}
                >
                  <div className="flex items-center">
                    Job
                    {sortField === 'job_description' && (
                      sortDirection === 'asc' ? 
                        <ChevronUp className="ml-1 h-4 w-4" /> : 
                        <ChevronDown className="ml-1 h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead 
                  className="w-[100px] cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('hours_worked')}
                >
                  <div className="flex items-center">
                    Hours
                    {sortField === 'hours_worked' && (
                      sortDirection === 'asc' ? 
                        <ChevronUp className="ml-1 h-4 w-4" /> : 
                        <ChevronDown className="ml-1 h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="w-[120px]">Start Time</TableHead>
                <TableHead className="w-[120px]">End Time</TableHead>
                <TableHead className="w-[120px]">Overtime</TableHead>
                <TableHead className="w-[180px]">Breaks</TableHead>
                <TableHead className="w-[280px]">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRecords.map((record) => (
                <TableRow key={record.staff_id}>
                  <TableCell>
                    <Checkbox 
                      checked={record.present} 
                      onCheckedChange={() => togglePresence(record.staff_id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{record.staff_name}</TableCell>
                  <TableCell>{record.job_description || 'N/A'}</TableCell>
                  <TableCell>
                    <span className={record.present ? "font-medium" : ""}>{record.hours_worked}</span>
                  </TableCell>
                  <TableCell>
                    {record.present ? (
                      <div className="flex items-center space-x-1">
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => decrementStartTime(record.staff_id)}
                        >
                          <span className="sr-only">Decrement start time</span>
                          <span>-</span>
                        </Button>
                        <Input 
                          type="time" 
                          value={record.start_time || ''} 
                          onChange={(e) => handleStartTimeChange(record.staff_id, e.target.value)}
                          className="w-24"
                        />
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => incrementStartTime(record.staff_id)}
                        >
                          <span className="sr-only">Increment start time</span>
                          <span>+</span>
                        </Button>
                      </div>
                    ) : (
                      <span>{record.start_time || 'N/A'}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {record.present ? (
                      <div className="flex items-center space-x-1">
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => decrementEndTime(record.staff_id)}
                        >
                          <span className="sr-only">Decrement end time</span>
                          <span>-</span>
                        </Button>
                        <Input 
                          type="time" 
                          value={record.end_time || ''} 
                          onChange={(e) => handleFinishTimeChange(record.staff_id, e.target.value)}
                          className="w-24"
                        />
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => incrementEndTime(record.staff_id)}
                        >
                          <span className="sr-only">Increment end time</span>
                          <span>+</span>
                        </Button>
                      </div>
                    ) : (
                      <span>{record.end_time || 'N/A'}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {record.present ? (
                      <div className="flex items-center space-x-1">
                        <Input 
                          type="number" 
                          value={record.overtime_hours || 0} 
                          onChange={(e) => handleOvertimeChange(record.staff_id, parseFloat(e.target.value) || 0)}
                          className="w-24"
                          min="0"
                          step="0.5"
                        />
                        <div className="text-xs text-muted-foreground ml-1">
                          {record.is_holiday ? "2.0x" : "1.5x"}
                        </div>
                      </div>
                    ) : (
                      <span>{record.overtime_hours || 0}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center space-x-1">
                        <Checkbox 
                          id={`lunch-${record.staff_id}`}
                          checked={record.lunch_break_taken} 
                          onCheckedChange={() => toggleLunchBreak(record.staff_id)}
                          disabled={!record.present}
                        />
                        <label 
                          htmlFor={`lunch-${record.staff_id}`}
                          className={cn(
                            "text-sm",
                            !record.present && "text-muted-foreground"
                          )}
                        >
                          Lunch
                        </label>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Checkbox 
                          id={`morning-${record.staff_id}`}
                          checked={record.morning_break_taken} 
                          onCheckedChange={() => toggleMorningBreak(record.staff_id)}
                          disabled={!record.present}
                        />
                        <label 
                          htmlFor={`morning-${record.staff_id}`}
                          className={cn(
                            "text-sm",
                            !record.present && "text-muted-foreground"
                          )}
                        >
                          AM
                        </label>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Checkbox 
                          id={`afternoon-${record.staff_id}`}
                          checked={record.afternoon_break_taken} 
                          onCheckedChange={() => toggleAfternoonBreak(record.staff_id)}
                          disabled={!record.present}
                        />
                        <label 
                          htmlFor={`afternoon-${record.staff_id}`}
                          className={cn(
                            "text-sm",
                            !record.present && "text-muted-foreground"
                          )}
                        >
                          PM
                        </label>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Textarea 
                      value={record.notes || ''} 
                      onChange={(e) => updateNotes(record.staff_id, e.target.value)}
                      placeholder="Add notes..."
                      className="min-h-[60px] resize-none"
                      disabled={!record.present}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <div>
          {lastSaved && (
            <p className="text-sm text-muted-foreground">
              Last saved: {format(lastSaved, 'h:mm:ss a')}
            </p>
          )}
        </div>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            onClick={markAllPresent}
            disabled={isSaving}
          >
            Mark All Present
          </Button>
          <Button 
            onClick={saveAttendance}
            disabled={isSaving}
            className={cn(
              lastSaved && Date.now() - lastSaved.getTime() < 3000 ? 
              "bg-green-600 hover:bg-green-700 transition-colors" : "",
              isSaving ? "bg-blue-600 hover:bg-blue-700" : ""
            )}
            size="lg"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                <span className="animate-pulse">Saving Attendance...</span>
              </>
            ) : lastSaved && Date.now() - lastSaved.getTime() < 5000 ? (
              <>
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className="mr-2 h-5 w-5 animate-bounce" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M5 13l4 4L19 7" 
                  />
                </svg>
                Saved Successfully
              </>
            ) : (
              <>
                <Save className="mr-2 h-5 w-5" />
                Save Attendance
              </>
            )}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
} 