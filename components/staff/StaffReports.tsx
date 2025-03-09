'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel as UIFormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, startOfWeek, endOfWeek, subDays, addDays, differenceInDays, eachDayOfInterval } from 'date-fns';
import { CalendarIcon, Download, Loader2, Printer, DollarSign, ClipboardList, UserX, BarChart4 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Types
type Staff = {
  staff_id: number;
  first_name: string;
  last_name: string;
  job_description: string | null;
  is_active: boolean;
  current_staff: boolean;
  hourly_rate: number;
};

type StaffHours = {
  staff_id: number;
  date_worked: string;
  hours_worked: number;
  start_time: string;
  end_time: string;
  break_duration: number;
  hours_id: number;
  lunch_break_taken: boolean;
  morning_break_taken: boolean;
  afternoon_break_taken: boolean;
  is_holiday: boolean;
  regular_hours: number;
  overtime_hours: number;
  notes: string | null;
};

// Function to export data to CSV
const exportToCSV = (data: any[], filename: string) => {
  if (!data || data.length === 0) return;
  
  const header = Object.keys(data[0]).join(',');
  const csv = [
    header,
    ...data.map(row => Object.values(row).map(value => {
      // Handle values that need quotes (strings with commas, etc.)
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(','))
  ].join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Create a safer FormLabel component
const FormLabel = ({ children, ...props }: React.ComponentProps<typeof UIFormLabel>) => {
  return <UIFormLabel {...props}>{children}</UIFormLabel>;
};

export function StaffReports() {
  const [activeTab, setActiveTab] = useState<string>('payroll');
  const [reportType, setReportType] = useState<string>('weekly');
  const [startDate, setStartDate] = useState<Date | undefined>(startOfWeek(new Date(), { weekStartsOn: 6 })); // Start on Saturday
  const [endDate, setEndDate] = useState<Date | undefined>(endOfWeek(subDays(new Date(), 7), { weekStartsOn: 6 })); // End on Friday
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedStaffType, setSelectedStaffType] = useState<string>('active');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [reportData, setReportData] = useState<any[] | null>(null);
  
  // Fetch staff data
  const { data: staffData = [], isLoading: isLoadingStaff } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .order('last_name', { ascending: true });
      
      if (error) throw error;
      return data as Staff[];
    }
  });
  
  // Filter staff based on selection
  const filteredStaff = useMemo(() => {
    if (selectedStaffType === 'active') {
      return staffData.filter(s => s.current_staff);
    } else if (selectedStaffType === 'inactive') {
      return staffData.filter(s => !s.current_staff);
    } else {
      return staffData;
    }
  }, [staffData, selectedStaffType]);
  
  // Fetch hours data for the selected date range
  const { data: hoursData = [], isLoading: isLoadingHours } = useQuery({
    queryKey: ['staffHours', startDate, endDate],
    queryFn: async () => {
      if (!startDate || !endDate) return [];
      
      const formatDate = (date: Date) => format(date, 'yyyy-MM-dd');
      const start = formatDate(startDate);
      const end = formatDate(endDate);
      
      const { data, error } = await supabase
        .from('staff_hours')
        .select('*')
        .gte('date_worked', start)
        .lte('date_worked', end);
      
      if (error) throw error;
      return data as StaffHours[];
    },
    enabled: !!startDate && !!endDate
  });
  
  // Generate Payroll Report
  const generatePayrollReport = () => {
    if (!startDate || !endDate || !filteredStaff.length || !hoursData.length) return [];
    
    const report = filteredStaff
      .filter(staff => {
        // If individual staff is selected, filter for that staff only
        if (selectedStaffId) {
          return staff.staff_id === selectedStaffId;
        }
        return true;
      })
      .map(staff => {
        // Get hours for this staff member
        const staffHours = hoursData.filter(h => h.staff_id === staff.staff_id);
        
        // Calculate totals
        const totalRegularHours = staffHours.reduce((sum, record) => sum + (record.regular_hours || 0), 0);
        const totalOvertimeHours = staffHours.reduce((sum, record) => sum + (record.overtime_hours || 0), 0);
        const totalHoursWorked = staffHours.reduce((sum, record) => sum + (record.hours_worked || 0), 0);
        
        // Calculate earnings
        const regularEarnings = totalRegularHours * (staff.hourly_rate || 0);
        const overtimeEarnings = totalOvertimeHours * (staff.hourly_rate ? staff.hourly_rate * 1.5 : 0);
        const totalEarnings = regularEarnings + overtimeEarnings;
        
        return {
          staff_id: staff.staff_id,
          name: `${staff.first_name} ${staff.last_name}`,
          hourly_rate: staff.hourly_rate || 0,
          regular_hours: totalRegularHours,
          overtime_hours: totalOvertimeHours,
          total_hours: totalHoursWorked,
          regular_earnings: regularEarnings,
          overtime_earnings: overtimeEarnings,
          total_earnings: totalEarnings
        };
      });
      
    return report;
  };
  
  // Generate Absence Report
  const generateAbsenceReport = () => {
    if (!startDate || !endDate || !filteredStaff.length) return [];
    
    // Calculate the date range as an array of dates
    const dateRange = eachDayOfInterval({ start: startDate, end: endDate });
    const totalWorkingDays = dateRange.length;
    
    const report = filteredStaff
      .filter(staff => {
        // If individual staff is selected, filter for that staff only
        if (selectedStaffId) {
          return staff.staff_id === selectedStaffId;
        }
        return true;
      })
      .map(staff => {
        // Get hours for this staff member
        const staffHours = hoursData.filter(h => h.staff_id === staff.staff_id);
        
        // Get unique dates the staff member worked
        const datesWorked = new Set(staffHours.map(h => h.date_worked));
        
        // Calculate days present and absent
        const daysPresent = datesWorked.size;
        const daysAbsent = totalWorkingDays - daysPresent;
        const attendanceRate = (daysPresent / totalWorkingDays) * 100;
        
        return {
          staff_id: staff.staff_id,
          name: `${staff.first_name} ${staff.last_name}`,
          total_working_days: totalWorkingDays,
          days_present: daysPresent,
          days_absent: daysAbsent,
          attendance_rate: attendanceRate.toFixed(2) + '%'
        };
      });
      
    return report;
  };
  
  // Generate report based on active tab
  const generateReport = () => {
    setIsGenerating(true);
    
    try {
      if (activeTab === 'payroll') {
        const payrollData = generatePayrollReport();
        setReportData(payrollData);
      } else if (activeTab === 'absence') {
        const absenceData = generateAbsenceReport();
        setReportData(absenceData);
      } else {
        setReportData(null);
      }
    } catch (error) {
      console.error('Error generating report:', error);
      setReportData(null);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Export current report to CSV
  const exportReport = () => {
    if (!reportData) return;
    
    const filename = `${activeTab}_report_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    exportToCSV(reportData, filename);
  };
  
  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="payroll" className="flex items-center">
            <DollarSign className="mr-2 h-4 w-4" />
            Payroll Reports
          </TabsTrigger>
          <TabsTrigger value="absence" className="flex items-center">
            <UserX className="mr-2 h-4 w-4" />
            Absence Reports
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="payroll" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Payroll Reports</CardTitle>
              <CardDescription>
                Generate detailed payroll reports including regular and overtime hours
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Date Range */}
                <div className="space-y-2">
                  <FormLabel>Report Period</FormLabel>
                  <Select value={reportType} onValueChange={setReportType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Start Date */}
                <div className="space-y-2">
                  <FormLabel>Start Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !startDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, 'PP') : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                
                {/* End Date */}
                <div className="space-y-2">
                  <FormLabel>End Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !endDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, 'PP') : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              {/* Staff Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <FormLabel>Staff Type</FormLabel>
                  <Select value={selectedStaffType} onValueChange={setSelectedStaffType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
                      <SelectItem value="active">Active Staff Only</SelectItem>
                      <SelectItem value="inactive">Inactive Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <FormLabel>Staff Member (Optional)</FormLabel>
                  <Select 
                    value={selectedStaffId ? String(selectedStaffId) : ""} 
                    onValueChange={(value) => setSelectedStaffId(value ? parseInt(value) : null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Staff</SelectItem>
                      {filteredStaff.map((staff) => (
                        <SelectItem key={staff.staff_id} value={String(staff.staff_id)}>
                          {staff.first_name} {staff.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Generate Button */}
              <div className="flex justify-end">
                <Button onClick={generateReport} disabled={isGenerating}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <BarChart4 className="mr-2 h-4 w-4" />
                      Generate Payroll Report
                    </>
                  )}
                </Button>
              </div>
              
              {/* Report Results */}
              {reportData && reportData.length > 0 && (
                <>
                  {/* Simple Summary instead of Chart */}
                  <div className="border rounded-md p-4 bg-card">
                    <h3 className="text-lg font-medium mb-4">Payroll Summary</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="border rounded-md p-4 bg-blue-50 dark:bg-blue-950">
                        <p className="text-sm text-muted-foreground">Total Regular Hours</p>
                        <p className="text-2xl font-bold">
                          {reportData.reduce((sum, item) => sum + item.regular_hours, 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="border rounded-md p-4 bg-green-50 dark:bg-green-950">
                        <p className="text-sm text-muted-foreground">Total Overtime Hours</p>
                        <p className="text-2xl font-bold">
                          {reportData.reduce((sum, item) => sum + item.overtime_hours, 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="border rounded-md p-4 bg-amber-50 dark:bg-amber-950">
                        <p className="text-sm text-muted-foreground">Total Earnings</p>
                        <p className="text-2xl font-bold">
                          ${reportData.reduce((sum, item) => sum + item.total_earnings, 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Data Table */}
                  <div className="border rounded-md overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Staff Name</TableHead>
                          <TableHead className="text-right">Hourly Rate</TableHead>
                          <TableHead className="text-right">Regular Hours</TableHead>
                          <TableHead className="text-right">Overtime Hours</TableHead>
                          <TableHead className="text-right">Total Hours</TableHead>
                          <TableHead className="text-right">Regular Earnings</TableHead>
                          <TableHead className="text-right">Overtime Earnings</TableHead>
                          <TableHead className="text-right">Total Earnings</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportData.map((row: any, index) => (
                          <TableRow key={index}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell className="text-right">${row.hourly_rate.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{row.regular_hours.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{row.overtime_hours.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{row.total_hours.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${row.regular_earnings.toFixed(2)}</TableCell>
                            <TableCell className="text-right">${row.overtime_earnings.toFixed(2)}</TableCell>
                            <TableCell className="font-medium text-right">${row.total_earnings.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {/* Export Actions */}
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={exportReport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export to CSV
                    </Button>
                    <Button variant="outline" onClick={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print Report
                    </Button>
                  </div>
                </>
              )}
              
              {reportData && reportData.length === 0 && (
                <Alert>
                  <AlertDescription>
                    No data found for the selected criteria. Try adjusting your filters.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="absence" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Absence Reports</CardTitle>
              <CardDescription>
                Track staff attendance and absences over time
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Controls (similar to payroll but customized for absence) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Date Range */}
                <div className="space-y-2">
                  <FormLabel>Report Period</FormLabel>
                  <Select value={reportType} onValueChange={setReportType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Start Date */}
                <div className="space-y-2">
                  <FormLabel>Start Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !startDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, 'PP') : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                
                {/* End Date */}
                <div className="space-y-2">
                  <FormLabel>End Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !endDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, 'PP') : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              {/* Staff Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <FormLabel>Staff Type</FormLabel>
                  <Select value={selectedStaffType} onValueChange={setSelectedStaffType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
                      <SelectItem value="active">Active Staff Only</SelectItem>
                      <SelectItem value="inactive">Inactive Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <FormLabel>Staff Member (Optional)</FormLabel>
                  <Select 
                    value={selectedStaffId ? String(selectedStaffId) : ""} 
                    onValueChange={(value) => setSelectedStaffId(value ? parseInt(value) : null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Staff</SelectItem>
                      {filteredStaff.map((staff) => (
                        <SelectItem key={staff.staff_id} value={String(staff.staff_id)}>
                          {staff.first_name} {staff.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Generate Button */}
              <div className="flex justify-end">
                <Button onClick={generateReport} disabled={isGenerating}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <ClipboardList className="mr-2 h-4 w-4" />
                      Generate Absence Report
                    </>
                  )}
                </Button>
              </div>
              
              {/* Report Results */}
              {reportData && reportData.length > 0 && (
                <>
                  {/* Simple Summary instead of Chart */}
                  <div className="border rounded-md p-4 bg-card">
                    <h3 className="text-lg font-medium mb-4">Attendance Summary</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="border rounded-md p-4 bg-green-50 dark:bg-green-950">
                        <p className="text-sm text-muted-foreground">Total Present Days</p>
                        <p className="text-2xl font-bold">
                          {reportData.reduce((sum, item) => sum + item.days_present, 0)}
                        </p>
                      </div>
                      <div className="border rounded-md p-4 bg-red-50 dark:bg-red-950">
                        <p className="text-sm text-muted-foreground">Total Absent Days</p>
                        <p className="text-2xl font-bold">
                          {reportData.reduce((sum, item) => sum + item.days_absent, 0)}
                        </p>
                      </div>
                      <div className="border rounded-md p-4 bg-blue-50 dark:bg-blue-950">
                        <p className="text-sm text-muted-foreground">Average Attendance Rate</p>
                        <p className="text-2xl font-bold">
                          {(reportData.reduce((sum, item) => sum + parseFloat(item.attendance_rate), 0) / reportData.length).toFixed(2)}%
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Data Table */}
                  <div className="border rounded-md overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Staff Name</TableHead>
                          <TableHead className="text-right">Working Days</TableHead>
                          <TableHead className="text-right">Days Present</TableHead>
                          <TableHead className="text-right">Days Absent</TableHead>
                          <TableHead className="text-right">Attendance Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportData.map((row: any, index) => (
                          <TableRow key={index}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell className="text-right">{row.total_working_days}</TableCell>
                            <TableCell className="text-right">{row.days_present}</TableCell>
                            <TableCell className="text-right">{row.days_absent}</TableCell>
                            <TableCell 
                              className={`text-right font-medium ${
                                parseFloat(row.attendance_rate) < 70 ? 'text-destructive' :
                                parseFloat(row.attendance_rate) < 90 ? 'text-amber-500' :
                                'text-green-600'
                              }`}
                            >
                              {row.attendance_rate}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {/* Export Actions */}
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={exportReport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export to CSV
                    </Button>
                    <Button variant="outline" onClick={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print Report
                    </Button>
                  </div>
                </>
              )}
              
              {reportData && reportData.length === 0 && (
                <Alert>
                  <AlertDescription>
                    No data found for the selected criteria. Try adjusting your filters.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 