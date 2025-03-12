'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  addWeeks, 
  subWeeks,
  isSunday,
  isSaturday,
  parseISO,
  isWithinInterval
} from 'date-fns';
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
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { 
  CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Printer,
  Loader2,
  Columns
} from 'lucide-react';
import React from 'react';

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

type WeeklySummaryRow = {
  staff_id: number;
  staff_name: string;
  job_description: string | null;
  dailyHours: {
    [date: string]: {
      hours: number;
      isHoliday: boolean;
      isWeekend: boolean;
      isSunday: boolean;
    }
  };
  totalRegularHours: number;
  totalDoubleTimeHours: number; // Combined Sunday and Holiday hours
  totalOvertimeHours: number;
  totalHours: number;
};

export function WeeklySummary() {
  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());
  const [summaryData, setSummaryData] = useState<WeeklySummaryRow[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [compactView, setCompactView] = useState(false);
  const { toast } = useToast();

  // Calculate week range (start on Saturday)
  const weekStart = React.useMemo(() => startOfWeek(selectedWeek, { weekStartsOn: 6 }), [selectedWeek]); // Start on Saturday
  const weekEnd = React.useMemo(() => endOfWeek(selectedWeek, { weekStartsOn: 6 }), [selectedWeek]); // End on Friday
  
  // Memoize the days of week calculation to prevent infinite updates
  const daysOfWeek = React.useMemo(() => {
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  }, [weekStart, weekEnd]);

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

  // Fetch hours for the selected week
  const { data: weeklyHours = [], isLoading: isLoadingHours } = useQuery({
    queryKey: ['staff_hours_weekly', format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd')],
    queryFn: async () => {
      const startDateStr = format(weekStart, 'yyyy-MM-dd');
      const endDateStr = format(weekEnd, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('staff_hours')
        .select('*')
        .gte('date_worked', startDateStr)
        .lte('date_worked', endDateStr);

      if (error) throw error;
      return data || [];
    },
  });

  // Process data for weekly summary
  useEffect(() => {
    // Skip if data isn't loaded yet
    if (!activeStaff || activeStaff.length === 0) {
      return;
    }

    // Create a stable reference to the days of week
    const currentDaysOfWeek = [...daysOfWeek];
    
    // Process hours data into summary format
    const processedSummary = activeStaff.map(staff => {
      // Find hours records for this staff member
      const staffHours = weeklyHours?.filter(h => h.staff_id === staff.staff_id) || [];
      
      // Initialize hours tracking objects
      const dailyHours: { [date: string]: { hours: number; isHoliday: boolean; isWeekend: boolean; isSunday: boolean } } = {};
      let totalRegularHours = 0;
      let totalDoubleTimeHours = 0; // Combined Sunday and Holiday hours
      let totalOvertimeHours = 0;
      let weeklyTotalHours = 0;
      
      // Process each day of the week
      currentDaysOfWeek.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const isSat = isSaturday(day);
        const isSun = isSunday(day);
        const isWeekend = isSat || isSun;
        const holiday = publicHolidays?.find(h => h.holiday_date === dateStr);
        const isHoliday = !!holiday;
        
        // Find hours for this day
        const dayHours = staffHours.find(h => h.date_worked === dateStr);
        const hoursWorked = dayHours?.hours_worked || 0;
        
        // Store hours data for this day
        dailyHours[dateStr] = {
          hours: hoursWorked,
          isHoliday,
          isWeekend,
          isSunday: isSun
        };
        
        // Add to weekly total
        weeklyTotalHours += hoursWorked;
        
        // Categorize hours based on day type
        if (hoursWorked > 0) {
          if (isHoliday || isSun) {
            // Double time hours (Sundays and public holidays)
            totalDoubleTimeHours += hoursWorked;
          } else {
            // Regular weekday hours (including Saturday)
            totalRegularHours += hoursWorked;
          }
          
          // Add any explicitly marked overtime hours
          if (dayHours?.overtime_hours) {
            totalOvertimeHours += dayHours.overtime_hours;
          }
        }
      });
      
      // Calculate overtime for hours exceeding 44 in a week
      // Note: We don't count double time hours toward the 44-hour limit since they're already at higher rates
      if (totalRegularHours > 44) {
        const overtimeFromRegularHours = totalRegularHours - 44;
        totalOvertimeHours += overtimeFromRegularHours;
        totalRegularHours = 44; // Cap regular hours at 44
      }
      
      // Calculate total hours (includes all categories)
      const totalHours = totalRegularHours + totalDoubleTimeHours + totalOvertimeHours;
      
      // Return the processed summary row
      return {
        staff_id: staff.staff_id,
        staff_name: `${staff.first_name} ${staff.last_name}`,
        job_description: staff.job_description,
        dailyHours,
        totalRegularHours,
        totalDoubleTimeHours,
        totalOvertimeHours,
        totalHours
      };
    });
    
    // Only update state if the data has actually changed
    setSummaryData(processedSummary);
    
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStaff, weeklyHours, publicHolidays, weekStart.toISOString()]);

  // Navigate to previous week
  const goToPreviousWeek = React.useCallback(() => {
    setSelectedWeek(prev => subWeeks(prev, 1));
  }, []);

  // Navigate to next week
  const goToNextWeek = React.useCallback(() => {
    setSelectedWeek(prev => addWeeks(prev, 1));
  }, []);

  // Export to CSV
  const exportToCSV = () => {
    setIsExporting(true);
    
    try {
      // Create CSV header
      let csvContent = "Staff Name,Job Description";
      
      // Add days as columns
      daysOfWeek.forEach(day => {
        csvContent += `,${format(day, 'EEE dd/MM')}`;
      });
      
      // Add total columns
      csvContent += ",Regular Hours,D/Time Hours,Overtime Hours,Total Hours\n";
      
      // Add data rows
      summaryData.forEach(row => {
        csvContent += `"${row.staff_name}","${row.job_description || 'N/A'}"`;
        
        // Add hours for each day
        daysOfWeek.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          csvContent += `,${row.dailyHours[dateStr]?.hours || 0}`;
        });
        
        // Add totals
        csvContent += `,${row.totalRegularHours},${row.totalDoubleTimeHours},${row.totalOvertimeHours},${row.totalHours}\n`;
      });
      
      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `staff_hours_${format(weekStart, 'yyyy-MM-dd')}_to_${format(weekEnd, 'yyyy-MM-dd')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: 'Export Successful',
        children: <p>Weekly summary has been exported to CSV</p>,
      });
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      toast({
        title: 'Export Failed',
        children: <p>Failed to export weekly summary</p>,
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Print weekly summary
  const printSummary = () => {
    window.print();
  };

  // Calculate daily totals
  const getDailyTotal = React.useCallback((dateStr: string) => {
    return summaryData.reduce((total, staff) => {
      return total + (staff.dailyHours[dateStr]?.hours || 0);
    }, 0);
  }, [summaryData]);

  // Loading state
  if (isLoadingStaff || isLoadingHours) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Loading weekly summary...</p>
      </div>
    );
  }

  return (
    <Card className="print:shadow-none">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Weekly Hours Summary</CardTitle>
            <CardDescription>
              Week of {format(weekStart, 'MMMM d, yyyy')} to {format(weekEnd, 'MMMM d, yyyy')}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex items-center mr-4 space-x-2">
              <Switch 
                id="compact-view" 
                checked={compactView} 
                onCheckedChange={setCompactView}
              />
              <label htmlFor="compact-view" className="text-sm cursor-pointer flex items-center">
                <Columns className="h-4 w-4 mr-1" />
                Compact View
              </label>
            </div>
            <Button variant="outline" size="icon" onClick={goToPreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setSelectedWeek(new Date())}>
              Current Week
            </Button>
            <Button variant="outline" size="icon" onClick={goToNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border print:border-none overflow-x-auto max-w-[calc(100vw-3rem)] relative">
          <div className="sticky left-0 z-10 bg-background shadow-sm">
            {/* Shadow indicator for horizontal scroll */}
            <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-black/5 pointer-events-none"></div>
          </div>
          <Table className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px] sticky left-0 z-10 bg-background">Staff Member</TableHead>
                {!compactView && <TableHead className="w-[120px]">Job</TableHead>}
                {daysOfWeek.map(day => {
                  // In compact view, only show weekend days and current day
                  const isWeekend = isSaturday(day) || isSunday(day);
                  const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                  
                  if (compactView && !isWeekend && !isToday) {
                    return null;
                  }
                  
                  return (
                    <TableHead 
                      key={format(day, 'yyyy-MM-dd')}
                      className={`w-[60px] text-center ${isWeekend ? 'bg-muted' : ''} ${isToday ? 'bg-primary/10' : ''}`}
                    >
                      <div>{format(day, 'EEE')}</div>
                      <div className="text-xs">{format(day, 'dd/MM')}</div>
                    </TableHead>
                  );
                })}
                <TableHead className="w-[80px] text-center">Regular</TableHead>
                <TableHead className="w-[80px] text-center">D/Time</TableHead>
                {!compactView && <TableHead className="w-[80px] text-center">Overtime</TableHead>}
                <TableHead className="w-[80px] text-center">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryData.map((row) => (
                <TableRow key={row.staff_id}>
                  <TableCell className="font-medium sticky left-0 z-10 bg-background">{row.staff_name}</TableCell>
                  {!compactView && <TableCell>{row.job_description || 'N/A'}</TableCell>}
                  
                  {daysOfWeek.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayData = row.dailyHours[dateStr];
                    const isWeekend = dayData?.isWeekend;
                    const isHoliday = dayData?.isHoliday;
                    const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                    
                    // Skip non-weekend, non-today days in compact view
                    if (compactView && !isWeekend && !isToday) {
                      return null;
                    }
                    
                    return (
                      <TableCell 
                        key={dateStr} 
                        className={`text-center ${isWeekend ? 'bg-muted' : ''} ${isHoliday ? 'bg-muted-foreground/10' : ''} ${dayData?.isSunday ? 'text-red-500 font-semibold' : ''} ${isToday ? 'bg-primary/10' : ''}`}
                      >
                        {dayData?.hours > 0 ? dayData.hours : '-'}
                      </TableCell>
                    );
                  })}
                  
                  <TableCell className="text-center">{row.totalRegularHours > 0 ? row.totalRegularHours : '-'}</TableCell>
                  <TableCell className="text-center text-red-500 font-semibold">{row.totalDoubleTimeHours > 0 ? row.totalDoubleTimeHours : '-'}</TableCell>
                  {!compactView && <TableCell className="text-center">{row.totalOvertimeHours > 0 ? row.totalOvertimeHours : '-'}</TableCell>}
                  <TableCell className="text-center font-bold">{row.totalHours > 0 ? row.totalHours : '-'}</TableCell>
                </TableRow>
              ))}
              
              {/* Daily totals row */}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={compactView ? 1 : 2} className="font-bold sticky left-0 z-10 bg-muted/50">Daily Totals</TableCell>
                
                {daysOfWeek.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const dailyTotal = getDailyTotal(dateStr);
                  const isWeekend = isSaturday(day) || isSunday(day);
                  const holiday = publicHolidays?.find(h => h.holiday_date === dateStr);
                  const isHoliday = !!holiday;
                  const isSun = isSunday(day);
                  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                  
                  // Skip non-weekend, non-today days in compact view
                  if (compactView && !isWeekend && !isToday) {
                    return null;
                  }
                  
                  return (
                    <TableCell 
                      key={`total-${dateStr}`} 
                      className={`text-center font-bold ${isWeekend ? 'bg-muted' : ''} ${isHoliday ? 'bg-muted-foreground/10' : ''} ${isSun ? 'text-red-500' : ''} ${isToday ? 'bg-primary/10' : ''}`}
                    >
                      {dailyTotal > 0 ? dailyTotal : '-'}
                    </TableCell>
                  );
                })}
                
                <TableCell className="text-center font-bold">
                  {summaryData.reduce((total, row) => total + row.totalRegularHours, 0)}
                </TableCell>
                <TableCell className="text-center font-bold text-red-500">
                  {summaryData.reduce((total, row) => total + row.totalDoubleTimeHours, 0)}
                </TableCell>
                {!compactView && <TableCell className="text-center font-bold">
                  {summaryData.reduce((total, row) => total + row.totalOvertimeHours, 0)}
                </TableCell>}
                <TableCell className="text-center font-bold">
                  {summaryData.reduce((total, row) => total + row.totalHours, 0)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between print:hidden">
        <div>
          <p className="text-sm text-muted-foreground">
            {summaryData.length} staff members | Week {format(weekStart, 'w, yyyy')}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            onClick={exportToCSV}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </>
            )}
          </Button>
          <Button variant="outline" onClick={printSummary}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
} 