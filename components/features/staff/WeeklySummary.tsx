'use client';

import { useState, useEffect } from 'react';
import { pdf } from '@react-pdf/renderer';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
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
  Columns,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X
} from 'lucide-react';
import { DailyHoursDetailDialog } from '@/components/features/staff/DailyHoursDetailDialog';
import React from 'react';
import { WeeklySummaryPDF, WeeklySummaryDay } from '@/components/features/staff/WeeklySummaryPDF';

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

type SortField = 'name' | 'job' | 'regular' | 'doubletime' | 'overtime' | 'total';
type SortDirection = 'asc' | 'desc';

export function WeeklySummary() {
  const queryClient = useQueryClient();
  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());
  const [summaryData, setSummaryData] = useState<WeeklySummaryRow[]>([]);
  const [filteredData, setFilteredData] = useState<WeeklySummaryRow[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [compactView, setCompactView] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterText, setFilterText] = useState('');
  const [selectedDayDetail, setSelectedDayDetail] = useState<{
    staffId: number;
    staffName: string;
    date: string;
    hours: number;
  } | null>(null);
  const { toast } = useToast();

  // Calculate week range (start on Friday)
  const weekStart = React.useMemo(() => startOfWeek(selectedWeek, { weekStartsOn: 5 }), [selectedWeek]); // Start on Friday
  const weekEnd = React.useMemo(() => endOfWeek(selectedWeek, { weekStartsOn: 5 }), [selectedWeek]); // End on Thursday
  
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

  // Fetch daily summaries for the selected week
  const { data: weeklySummaries = [], isLoading: isLoadingSummaries } = useQuery({
    queryKey: ['time_daily_summary', 'weekly', format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd')],
    queryFn: async () => {
      const startDateStr = format(weekStart, 'yyyy-MM-dd');
      const endDateStr = format(weekEnd, 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('time_daily_summary')
        .select('staff_id, date_worked, total_hours_worked, dt_minutes')
        .gte('date_worked', startDateStr)
        .lte('date_worked', endDateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // Process data for weekly summary
  useEffect(() => {
    if (!activeStaff || activeStaff.length === 0) return;
    const processed = activeStaff.map(staff => {
      const staffSummaries = weeklySummaries.filter(s => s.staff_id === staff.staff_id);
      const dailyHours: Record<string, { hours: number; isHoliday: boolean; isWeekend: boolean; isSunday: boolean }> = {};
      let weekWorkMin = 0, weekDoubleMin = 0;
      daysOfWeek.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const summary = staffSummaries.find(s => s.date_worked === dateStr);
        const workMin = summary ? Math.round((summary.total_hours_worked || 0) * 60) : 0;
        const dtMin = summary?.dt_minutes || 0;
        const isSat = isSaturday(day);
        const isSun = isSunday(day);
        const isHoliday = !!publicHolidays.find(h => h.holiday_date === dateStr);
        dailyHours[dateStr] = { hours: Math.round((workMin / 60) * 100) / 100, isHoliday, isWeekend: isSat || isSun, isSunday: isSun };
        if (isSun) {
          weekDoubleMin += workMin;
        } else {
          weekWorkMin += workMin;
        }
      });
      const thresholdMin = 44 * 60;
      const regMin = Math.min(weekWorkMin, thresholdMin);
      const otMin = Math.max(weekWorkMin - thresholdMin, 0);
      const regH = Math.round((regMin / 60) * 100) / 100;
      const otH = Math.round((otMin / 60) * 100) / 100;
      const dtH = Math.round((weekDoubleMin / 60) * 100) / 100;
      const totalH = Math.round(((weekWorkMin + weekDoubleMin) / 60) * 100) / 100;
      return {
        staff_id: staff.staff_id,
        staff_name: `${staff.first_name} ${staff.last_name}`,
        job_description: staff.job_description,
        dailyHours,
        totalRegularHours: regH,
        totalDoubleTimeHours: dtH,
        totalOvertimeHours: otH,
        totalHours: totalH,
      };
    });
    setSummaryData(processed);

  }, [activeStaff, weeklySummaries, publicHolidays, daysOfWeek]);

  // Sort and filter data
  useEffect(() => {
    let filtered = summaryData.filter(row => {
      if (!filterText) return true;
      const searchTerm = filterText.toLowerCase();
      return (
        row.staff_name.toLowerCase().includes(searchTerm) ||
        (row.job_description && row.job_description.toLowerCase().includes(searchTerm))
      );
    });

    // Sort the filtered data
    filtered.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case 'name':
          aValue = a.staff_name;
          bValue = b.staff_name;
          break;
        case 'job':
          aValue = a.job_description || '';
          bValue = b.job_description || '';
          break;
        case 'regular':
          aValue = a.totalRegularHours;
          bValue = b.totalRegularHours;
          break;
        case 'doubletime':
          aValue = a.totalDoubleTimeHours;
          bValue = b.totalDoubleTimeHours;
          break;
        case 'overtime':
          aValue = a.totalOvertimeHours;
          bValue = b.totalOvertimeHours;
          break;
        case 'total':
          aValue = a.totalHours;
          bValue = b.totalHours;
          break;
        default:
          aValue = a.staff_name;
          bValue = b.staff_name;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      } else {
        return sortDirection === 'asc'
          ? (aValue as number) - (bValue as number)
          : (bValue as number) - (aValue as number);
      }
    });

    setFilteredData(filtered);
  }, [summaryData, filterText, sortField, sortDirection]);

  // Handle column sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Clear filter
  const clearFilter = () => {
    setFilterText('');
  };

  // Handle daily hours cell click
  const handleDayClick = (staffId: number, staffName: string, dateStr: string, hours: number) => {
    if (hours > 0) {
      setSelectedDayDetail({
        staffId,
        staffName,
        date: dateStr,
        hours
      });
    }
  };

  // Close daily detail dialog
  const closeDayDetail = () => {
    setSelectedDayDetail(null);
  };



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
      filteredData.forEach(row => {
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
        description: 'Weekly summary has been exported to CSV',
      });
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      toast({
        title: 'Error',
        description: 'Failed to export data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Print weekly summary as PDF
  const printSummary = async () => {
    try {
      // Days metadata for PDF
      const days: WeeklySummaryDay[] = daysOfWeek.map((day) => ({
        key: format(day, 'yyyy-MM-dd'),
        label: `${format(day, 'EEE')} ${format(day, 'dd/MM')}`,
      }));

      // Rows from current filtered data
      const rows = filteredData.map((row) => {
        const daily: Record<string, number> = {};
        days.forEach((d) => {
          daily[d.key] = row.dailyHours[d.key]?.hours ?? 0;
        });
        return {
          staff_name: row.staff_name,
          job_description: row.job_description,
          dailyHours: daily,
          totalRegularHours: row.totalRegularHours,
          totalDoubleTimeHours: row.totalDoubleTimeHours,
          totalOvertimeHours: row.totalOvertimeHours,
          totalHours: row.totalHours,
        };
      });

      const component = (
        <WeeklySummaryPDF
          weekStart={format(weekStart, 'yyyy-MM-dd')}
          weekEnd={format(weekEnd, 'yyyy-MM-dd')}
          days={days}
          rows={rows}
          includeJob={!compactView}
          generatedAt={new Date().toLocaleString()}
        />
      );

      const blob = await pdf(component).toBlob();
      const filename = `weekly_summary_${format(weekStart, 'yyyy-MM-dd')}_to_${format(weekEnd, 'yyyy-MM-dd')}.pdf`;

      // Prefer native Save dialog when supported (Chromium-based browsers)
      const savePicker: any = (window as any).showSaveFilePicker;
      if (typeof savePicker === 'function') {
        try {
          const handle = await savePicker({
            suggestedName: filename,
            types: [
              {
                description: 'PDF document',
                accept: { 'application/pdf': ['.pdf'] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          toast({ title: 'Saved', description: `Saved as ${handle.name || filename}` });
          return;
        } catch (err) {
          // User may have canceled; fall through to download
        }
      }

      // Fallback: trigger a normal download with a proper .pdf extension
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to generate weekly summary PDF', e);
      toast({ title: 'Error', description: 'Failed to generate PDF. Please try again.', variant: 'destructive' });
    }
  };

  // Calculate daily totals
  const getDailyTotal = React.useCallback((dateStr: string) => {
    return filteredData.reduce((total, staff) => {
      return total + (staff.dailyHours[dateStr]?.hours || 0);
    }, 0);
  }, [filteredData]);

  // Loading state
  if (isLoadingStaff || isLoadingSummaries) {
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
            <Button 
              variant="outline" 
              size="icon" 
              onClick={() => queryClient.invalidateQueries({ queryKey: ['time_daily_summary', 'weekly', format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd')] })}
              aria-label="Refresh data"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Filter input */}
        <div className="flex items-center space-x-2 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by name or job..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="pl-8"
            />
            {filterText && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-6 w-6 p-0"
                onClick={clearFilter}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {filterText && (
            <Badge variant="secondary">
              {filteredData.length} of {summaryData.length} staff
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border print:border-none overflow-x-auto max-w-[calc(100vw-3rem)] relative">
          <div className="sticky left-0 z-10 bg-background shadow-sm">
            {/* Shadow indicator for horizontal scroll */}
            <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-black/5 pointer-events-none"></div>
          </div>
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px] sticky left-0 z-10 bg-background">
                  <Button
                    variant="ghost"
                    className="h-auto p-0 font-semibold text-left justify-start hover:bg-transparent"
                    onClick={() => handleSort('name')}
                  >
                    Staff Member
                    {sortField === 'name' && (
                      sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                    )}
                    {sortField !== 'name' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
                  </Button>
                </TableHead>
                {!compactView && (
                  <TableHead className="w-[120px]">
                    <Button
                      variant="ghost"
                      className="h-auto p-0 font-semibold text-left justify-start hover:bg-transparent"
                      onClick={() => handleSort('job')}
                    >
                      Job
                      {sortField === 'job' && (
                        sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                      )}
                      {sortField !== 'job' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
                    </Button>
                  </TableHead>
                )}
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
                <TableHead className="w-[80px] text-center">
                  <Button
                    variant="ghost"
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                    onClick={() => handleSort('regular')}
                  >
                    Regular
                    {sortField === 'regular' && (
                      sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                    )}
                    {sortField !== 'regular' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
                  </Button>
                </TableHead>
                <TableHead className="w-[80px] text-center">
                  <Button
                    variant="ghost"
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                    onClick={() => handleSort('doubletime')}
                  >
                    D/Time
                    {sortField === 'doubletime' && (
                      sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                    )}
                    {sortField !== 'doubletime' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
                  </Button>
                </TableHead>
                {!compactView && (
                  <TableHead className="w-[80px] text-center">
                    <Button
                      variant="ghost"
                      className="h-auto p-0 font-semibold hover:bg-transparent"
                      onClick={() => handleSort('overtime')}
                    >
                      Overtime
                      {sortField === 'overtime' && (
                        sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                      )}
                      {sortField !== 'overtime' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
                    </Button>
                  </TableHead>
                )}
                <TableHead className="w-[80px] text-center">
                  <Button
                    variant="ghost"
                    className="h-auto p-0 font-semibold hover:bg-transparent"
                    onClick={() => handleSort('total')}
                  >
                    Total
                    {sortField === 'total' && (
                      sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                    )}
                    {sortField !== 'total' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((row) => (
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
                        className={`text-center ${isWeekend ? 'bg-muted' : ''} ${isHoliday ? 'bg-muted-foreground/10' : ''} ${dayData?.isSunday ? 'text-red-500 font-semibold' : ''} ${isToday ? 'bg-primary/10' : ''} ${dayData?.hours > 0 ? 'cursor-pointer hover:bg-primary/20 transition-colors' : ''}`}
                        onClick={() => handleDayClick(row.staff_id, row.staff_name, dateStr, dayData?.hours || 0)}
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
                      {dailyTotal > 0 ? dailyTotal.toFixed(2) : '-'}
                    </TableCell>
                  );
                })}
                
                <TableCell className="text-center font-bold">
                  {filteredData.reduce((total, row) => total + row.totalRegularHours, 0).toFixed(2)}
                </TableCell>
                <TableCell className="text-center font-bold text-red-500">
                  {filteredData.reduce((total, row) => total + row.totalDoubleTimeHours, 0).toFixed(2)}
                </TableCell>
                {!compactView && <TableCell className="text-center font-bold">
                  {filteredData.reduce((total, row) => total + row.totalOvertimeHours, 0).toFixed(2)}
                </TableCell>}
                <TableCell className="text-center font-bold">
                  {filteredData.reduce((total, row) => total + row.totalHours, 0).toFixed(2)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between print:hidden">
        <div>
          <p className="text-sm text-muted-foreground">
            {filteredData.length} {filterText ? `of ${summaryData.length}` : ''} staff members | Week {format(weekStart, 'w, yyyy')}
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

      {/* Daily Hours Detail Dialog */}
      {selectedDayDetail && (
        <DailyHoursDetailDialog
          isOpen={!!selectedDayDetail}
          onClose={closeDayDetail}
          staffId={selectedDayDetail.staffId}
          staffName={selectedDayDetail.staffName}
          date={selectedDayDetail.date}
          initialHours={selectedDayDetail.hours}
        />
      )}
    </Card>
  );
} 