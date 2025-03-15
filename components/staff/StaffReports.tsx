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
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, startOfWeek, endOfWeek, subDays, addDays, differenceInDays, eachDayOfInterval, isSunday } from 'date-fns';
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
import { Label } from '@/components/ui/label';

// Types
type Staff = {
  staff_id: number;
  first_name: string;
  last_name: string;
  current_staff: boolean;
  hourly_rate: number | null;
};

type StaffHours = {
  id: number;
  staff_id: number;
  date_worked: string;
  hours_worked: number;
  regular_hours: number;
  overtime_hours: number;
  break_time: number;
  is_holiday: boolean;
};

type PayrollReport = {
  staff_id: number;
  name: string;
  hourly_rate: number;
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  total_hours: number;
  regular_earnings: number;
  overtime_earnings: number;
  doubletime_earnings: number;
  total_earnings: number;
};

type AttendanceReport = {
  staff_id: number;
  name: string;
  days_present: number;
  days_absent: number;
  days_late: number;
  total_hours: number;
  attendance_rate: string;
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

const PayrollTable = ({ data }: { data: PayrollReport[] }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Rate</TableHead>
          <TableHead>Regular Hrs</TableHead>
          <TableHead>Overtime Hrs</TableHead>
          <TableHead>Double Time Hrs</TableHead>
          <TableHead>Regular Pay</TableHead>
          <TableHead>Overtime Pay</TableHead>
          <TableHead>Double Time Pay</TableHead>
          <TableHead className="text-right">Total Pay</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => (
          <TableRow key={i}>
            <TableCell>{row.name}</TableCell>
            <TableCell>R{row.hourly_rate.toFixed(2)}</TableCell>
            <TableCell>{row.regular_hours.toFixed(1)}</TableCell>
            <TableCell>{row.overtime_hours.toFixed(1)}</TableCell>
            <TableCell>{row.doubletime_hours.toFixed(1)}</TableCell>
            <TableCell>R{row.regular_earnings.toFixed(2)}</TableCell>
            <TableCell>R{row.overtime_earnings.toFixed(2)}</TableCell>
            <TableCell>R{row.doubletime_earnings.toFixed(2)}</TableCell>
            <TableCell className="text-right font-semibold">
              R{row.total_earnings.toFixed(2)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export function StaffReports() {
  const [activeTab, setActiveTab] = useState<string>('payroll');
  const [reportType, setReportType] = useState<string>('weekly');
  
  // Calculate the current pay week (Saturday to Friday)
  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 6 }); // Start on Saturday
  const currentWeekEnd = endOfWeek(today, { weekStartsOn: 6 }); // End on Friday
  
  const [startDate, setStartDate] = useState<Date | undefined>(currentWeekStart);
  const [endDate, setEndDate] = useState<Date | undefined>(currentWeekEnd);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedStaffType, setSelectedStaffType] = useState<string>('active');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [reportData, setReportData] = useState<PayrollReport[] | AttendanceReport[] | null>(null);
  
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
  const generatePayrollReport = (): PayrollReport[] => {
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
        let totalRegularHours = 0;
        let totalOvertimeHours = 0;
        let totalDoubleTimeHours = 0;
        
        staffHours.forEach(record => {
          const isDoubleTime = record.is_holiday || isSunday(new Date(record.date_worked));
          if (isDoubleTime) {
            totalDoubleTimeHours += record.hours_worked || 0;
          } else {
            totalRegularHours += record.regular_hours || 0;
            totalOvertimeHours += record.overtime_hours || 0;
          }
        });
        
        // Calculate earnings
        const hourlyRate = staff.hourly_rate || 0;
        const regularEarnings = totalRegularHours * hourlyRate;
        const overtimeEarnings = totalOvertimeHours * (hourlyRate * 1.5);
        const doubletimeEarnings = totalDoubleTimeHours * (hourlyRate * 2.0);
        const totalEarnings = regularEarnings + overtimeEarnings + doubletimeEarnings;
        
        return {
          staff_id: staff.staff_id,
          name: `${staff.first_name} ${staff.last_name}`,
          hourly_rate: hourlyRate,
          regular_hours: totalRegularHours,
          overtime_hours: totalOvertimeHours,
          doubletime_hours: totalDoubleTimeHours,
          total_hours: totalRegularHours + totalOvertimeHours + totalDoubleTimeHours,
          regular_earnings: regularEarnings,
          overtime_earnings: overtimeEarnings,
          doubletime_earnings: doubletimeEarnings,
          total_earnings: totalEarnings
        };
      });
    
    return report;
  };
  
  // Generate Attendance Report
  const generateAttendanceReport = (): AttendanceReport[] => {
    if (!startDate || !endDate || !filteredStaff.length) return [];
    
    // Calculate the total number of working days in the date range
    const totalDays = differenceInDays(endDate, startDate) + 1;
    
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
        
        // Calculate days present (days with hours > 0)
        const daysPresent = new Set(staffHours.map(h => h.date_worked)).size;
        
        // Calculate days absent
        const daysAbsent = totalDays - daysPresent;
        
        // Calculate days late (placeholder - would need actual late data)
        const daysLate = 0;
        
        // Calculate total hours
        const totalHours = staffHours.reduce((sum, record) => sum + (record.hours_worked || 0), 0);
        
        // Calculate attendance rate
        const attendanceRate = ((daysPresent / totalDays) * 100).toFixed(1) + '%';
        
        return {
          staff_id: staff.staff_id,
          name: `${staff.first_name} ${staff.last_name}`,
          days_present: daysPresent,
          days_absent: daysAbsent,
          days_late: daysLate,
          total_hours: totalHours,
          attendance_rate: attendanceRate
        };
      });
    
    return report;
  };
  
  // Handle generate report
  const handleGenerateReport = () => {
    setIsGenerating(true);
    setReportData(null);
    
    // Simulate API call delay
    setTimeout(() => {
      if (activeTab === 'payroll') {
        const payrollData = generatePayrollReport();
        setReportData(payrollData);
      } else if (activeTab === 'absence') {
        const absenceData = generateAttendanceReport();
        setReportData(absenceData);
      } else {
        // Other report types would go here
        setReportData([]);
      }
      setIsGenerating(false);
    }, 1000);
  };
  
  // Export report data
  const exportReport = () => {
    if (!reportData) return;
    
    const filename = `${activeTab}-report-${format(startDate || new Date(), 'yyyy-MM-dd')}-to-${format(endDate || new Date(), 'yyyy-MM-dd')}`;
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
                  <Label>Report Period</Label>
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
                  <Label>Start Date</Label>
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
                  <Label>End Date</Label>
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
                  <Label>Staff Type</Label>
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
                  <Label>Staff Member (Optional)</Label>
                  <Select 
                    value={selectedStaffId ? String(selectedStaffId) : "all"} 
                    onValueChange={(value) => setSelectedStaffId(value === "all" ? null : parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
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
                <Button onClick={handleGenerateReport} disabled={isGenerating}>
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
              {activeTab === 'payroll' && reportData && reportData.length > 0 && (
                <>
                  <div className="overflow-auto">
                    <PayrollTable data={reportData as PayrollReport[]} />
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
                  <Label>Report Period</Label>
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
                  <Label>Start Date</Label>
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
                  <Label>End Date</Label>
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
                  <Label>Staff Type</Label>
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
                  <Label>Staff Member (Optional)</Label>
                  <Select 
                    value={selectedStaffId ? String(selectedStaffId) : "all"} 
                    onValueChange={(value) => setSelectedStaffId(value === "all" ? null : parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
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
                <Button onClick={handleGenerateReport} disabled={isGenerating}>
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
              {activeTab === 'absence' && reportData && reportData.length > 0 && (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Staff Name</TableHead>
                          <TableHead>Days Present</TableHead>
                          <TableHead>Days Absent</TableHead>
                          <TableHead>Days Late</TableHead>
                          <TableHead>Total Hours</TableHead>
                          <TableHead className="text-right">Attendance Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(reportData as AttendanceReport[]).map((row) => (
                          <TableRow key={row.staff_id}>
                            <TableCell className="font-medium">{row.name}</TableCell>
                            <TableCell>{row.days_present}</TableCell>
                            <TableCell 
                              className={`font-medium ${row.days_absent > 3 ? 'text-destructive' : ''}`}
                            >
                              {row.days_absent}
                            </TableCell>
                            <TableCell>{row.days_late}</TableCell>
                            <TableCell>{row.total_hours.toFixed(1)}</TableCell>
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