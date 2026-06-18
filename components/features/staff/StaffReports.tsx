'use client';

import { Fragment, useState, useEffect, useMemo } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { formatDate as formatDateSA } from '@/lib/date-utils';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { CalendarIcon, ChevronDown, ChevronRight, Download, Loader2, Printer, DollarSign, ClipboardList, UserX, BarChart4 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getOrgId } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { pdf } from '@react-pdf/renderer';
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
import { useAuth } from '@/components/common/auth-provider';
import { EMPLOYMENT_TYPES, type EmploymentType } from '@/lib/constants/employment-types';
import { StaffPayrollPDF as StaffPayrollPDFNamed } from './StaffPayrollPDF';
import type { AbsenceReportRow } from './StaffAbsencePDF';

// Types
type Staff = {
  staff_id: number;
  first_name: string;
  last_name: string;
  current_staff: boolean;
  is_active?: boolean | null;
  hourly_rate: number | null;
};

export type DailySummary = {
  staff_id: number;
  date_worked: string;
  total_hours_worked: number; // total worked including DT
  dt_minutes: number; // double-time minutes (Sundays/holidays)
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

type StaffScope = 'active' | 'all' | 'inactive';
type EmploymentTypeFilter = EmploymentType | 'all';

// Stable empty arrays to prevent infinite useEffect loops
const EMPTY_STAFF_ARRAY: Staff[] = [];
const EMPTY_SUMMARIES_ARRAY: DailySummary[] = [];
const HIGH_BRADFORD_THRESHOLD = 100;

const STAFF_SCOPE_LABELS: Record<StaffScope, string> = {
  active: 'Active staff only',
  all: 'All staff',
  inactive: 'Inactive staff',
};

const employmentTypeLabel = (value: string | null) => {
  if (!value) return 'Employment type not set';
  return EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? value;
};

const asNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
};

const normalizeAbsenceRows = (rows: AbsenceReportRow[]): AbsenceReportRow[] =>
  rows.map((row) => ({
    ...row,
    working_days: asNumber(row.working_days),
    days_present: asNumber(row.days_present),
    days_absent: asNumber(row.days_absent),
    absence_rate: asNumber(row.absence_rate),
    total_hours: asNumber(row.total_hours),
    public_holidays_count: asNumber(row.public_holidays_count),
    closure_days_count: asNumber(row.closure_days_count),
    worked_holiday_dates: asStringArray(row.worked_holiday_dates),
    incomplete_timecard_dates: asStringArray(row.incomplete_timecard_dates),
    absent_dates: asStringArray(row.absent_dates),
    bradford_factor: asNumber(row.bradford_factor),
    has_missing_hire_date: Boolean(row.has_missing_hire_date),
  }));

const formatAbsenceCount = (row: AbsenceReportRow, value: number) =>
  row.has_missing_hire_date ? '' : String(Math.round(value || 0));

const formatAbsenceRate = (row: AbsenceReportRow) =>
  row.has_missing_hire_date ? '' : `${asNumber(row.absence_rate).toFixed(1)}%`;

const hasAbsenceDetails = (row: AbsenceReportRow) =>
  row.absent_dates.length > 0 ||
  row.worked_holiday_dates.length > 0 ||
  row.incomplete_timecard_dates.length > 0;

const ABSENCE_DETAIL_TONES = {
  absent: { dot: 'bg-rose-500', label: 'text-rose-600 dark:text-rose-400' },
  holiday: { dot: 'bg-sky-500', label: 'text-sky-600 dark:text-sky-400' },
  exception: { dot: 'bg-amber-500', label: 'text-amber-600 dark:text-amber-400' },
} as const;

const formatAbsenceDay = (iso: string) => {
  try {
    return format(parseISO(iso), 'EEE d MMM');
  } catch {
    return iso;
  }
};

function AbsenceDateGroup({
  tone,
  label,
  dates,
}: {
  tone: keyof typeof ABSENCE_DETAIL_TONES;
  label: string;
  dates: string[];
}) {
  if (dates.length === 0) return null;
  const t = ABSENCE_DETAIL_TONES[tone];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', t.dot)} aria-hidden />
        <span className={cn('text-xs font-medium uppercase tracking-wide', t.label)}>{label}</span>
        <span className="text-xs text-muted-foreground">· {dates.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {dates.map((d) => (
          <span
            key={d}
            className="rounded-md border bg-background px-2 py-1 text-xs tabular-nums text-foreground/80"
          >
            {formatAbsenceDay(d)}
          </span>
        ))}
      </div>
    </div>
  );
}

const readableErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Unable to generate the report. Please try again.';
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

// Simplified Hours Table (Total, Normal, Overtime) used for summary view and print export
const HoursTable = ({ data }: { data: PayrollReport[] }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Total Hours</TableHead>
          <TableHead>Normal Hours</TableHead>
          <TableHead>Overtime Hours</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => {
          const overtimeTotal = row.overtime_hours + row.doubletime_hours;
          return (
            <TableRow key={i}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{row.total_hours.toFixed(1)}</TableCell>
              <TableCell>{row.regular_hours.toFixed(1)}</TableCell>
              <TableCell>{overtimeTotal.toFixed(1)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export function StaffReports() {
  const { weekStartDay } = useOrgSettings();
  const { user } = useAuth();
  const orgId = getOrgId(user);
  const [activeTab, setActiveTab] = useState<string>('payroll');
  const [reportType, setReportType] = useState<string>('weekly');

  // Calculate the current pay week based on org settings
  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const currentWeekEnd = endOfWeek(today, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  
  const [startDate, setStartDate] = useState<Date | undefined>(currentWeekStart);
  const [endDate, setEndDate] = useState<Date | undefined>(currentWeekEnd);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedStaffType, setSelectedStaffType] = useState<StaffScope>('active');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [selectedAbsenceStaffIds, setSelectedAbsenceStaffIds] = useState<number[]>([]);
  const [selectedEmploymentType, setSelectedEmploymentType] = useState<EmploymentTypeFilter>('all');
  const [expandedAbsenceRows, setExpandedAbsenceRows] = useState<Set<number>>(new Set());
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<PayrollReport[] | AbsenceReportRow[] | null>(null);

  const { data: organizationName } = useQuery({
    queryKey: ['current-organization-name', orgId],
    queryFn: async () => {
      if (!orgId) return null;

      const { data, error } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle();

      if (error) return null;
      return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
  
  // Fetch staff data
  const { data: staffData = EMPTY_STAFF_ARRAY, isLoading: isLoadingStaff } = useQuery({
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
    const isActive = (staff: Staff) => staff.current_staff && staff.is_active !== false;

    if (selectedStaffType === 'active') {
      return staffData.filter(isActive);
    } else if (selectedStaffType === 'inactive') {
      return staffData.filter(s => !isActive(s));
    } else {
      return staffData;
    }
  }, [staffData, selectedStaffType]);

  const absenceRows = activeTab === 'absence' && reportData ? reportData as AbsenceReportRow[] : [];
  const companyName = organizationName ?? 'Qbutton';
  const periodLabel = startDate && endDate
    ? `${formatDateSA(startDate)} to ${formatDateSA(endDate)}`
    : 'No date range selected';
  const employmentScopeLabel = selectedEmploymentType === 'all'
    ? 'All types'
    : employmentTypeLabel(selectedEmploymentType);
  const staffScopeLabel = selectedAbsenceStaffIds.length > 0
    ? `${selectedAbsenceStaffIds.length} selected staff`
    : STAFF_SCOPE_LABELS[selectedStaffType];
  const absenceScopeLabel = `${staffScopeLabel}; ${employmentScopeLabel}`;
  const showMonthlyUntaggedBanner =
    activeTab === 'absence' &&
    selectedEmploymentType === 'monthly' &&
    reportData !== null &&
    absenceRows.every((row) => !row.employment_type);
  
  // Fetch daily summaries (hours data) for the selected date range
  const { data: hoursData = EMPTY_SUMMARIES_ARRAY, isLoading: isLoadingHours } = useQuery({
    queryKey: ['time_daily_summary', startDate, endDate],
    queryFn: async () => {
      if (!startDate || !endDate) return [];

      const formatDate = (date: Date) => format(date, 'yyyy-MM-dd');
      const start = formatDate(startDate);
      const end = formatDate(endDate);

      // Note: avoid select('*') to prevent Supabase 500 error
      const { data, error } = await supabase
        .from('time_daily_summary')
        .select('staff_id, date_worked, total_hours_worked, dt_minutes')
        .gte('date_worked', start)
        .lte('date_worked', end);

      if (error) throw error;
      return (data || []) as DailySummary[];
    },
    enabled: !!startDate && !!endDate
  });

  // Debug: log fetched data counts
  useEffect(() => {
    if (!isLoadingStaff) {
      console.log('[StaffReports] staffData loaded:', staffData.length, staffData);
    }
    if (!isLoadingHours) {
      console.log('[StaffReports] hoursData loaded:', hoursData.length, hoursData.slice(0, 10));
    }
  }, [staffData, hoursData, isLoadingStaff, isLoadingHours]);

  // Re-run generation automatically once loading completes if user already clicked Generate
  useEffect(() => {
    if (isGenerating && activeTab === 'payroll' && !isLoadingHours && !isLoadingStaff) {
      const data = generatePayrollReport();
      setReportData(data);
      setIsGenerating(false);
    }
  }, [isGenerating, isLoadingHours, isLoadingStaff, activeTab]);

  // Generate Payroll Report
  const generatePayrollReport = (): PayrollReport[] => {
    if (!startDate || !endDate || !hoursData.length) return [];

    // Derive staff list from summaries if main list empty (handles RLS)
    const effectiveStaff: Staff[] = filteredStaff.length ? filteredStaff : Array.from(
      new Map(
        hoursData.map(h => [h.staff_id, {
          staff_id: h.staff_id,
          first_name: '',
          last_name: '',
          hourly_rate: 0,
          current_staff: true
        }])
      ).values()
    );

    return effectiveStaff
      .filter(s => !selectedStaffId || s.staff_id === selectedStaffId)
      .sort((a, b) => a.first_name.localeCompare(b.first_name))
      .map(staff => {
        // Summaries for this staff
        const summaries = hoursData.filter(h => h.staff_id === staff.staff_id);
        if (!summaries.length) {
          return {
            staff_id: staff.staff_id,
            name: `${staff.first_name} ${staff.last_name}`.trim() || `${staff.staff_id}`,
            hourly_rate: staff.hourly_rate || 0,
            regular_hours: 0,
            overtime_hours: 0,
            doubletime_hours: 0,
            total_hours: 0,
            regular_earnings: 0,
            overtime_earnings: 0,
            doubletime_earnings: 0,
            total_earnings: 0
          } as PayrollReport;
        }

        const totalDoubleTimeHours = summaries.reduce((acc, s) => acc + (s.dt_minutes || 0) / 60, 0);
        const totalWorkedHours = summaries.reduce((acc, s) => acc + (s.total_hours_worked || 0), 0);
        const regPlusOt = totalWorkedHours - totalDoubleTimeHours;
        const totalRegularHours = Math.min(regPlusOt, 44);
        const totalOvertimeHours = Math.max(regPlusOt - 44, 0);

        const rate = staff.hourly_rate || 0;
        const regularEarnings = totalRegularHours * rate;
        const overtimeEarnings = totalOvertimeHours * (rate * 1.5);
        const doubletimeEarnings = totalDoubleTimeHours * (rate * 2.0);
        const totalEarnings = regularEarnings + overtimeEarnings + doubletimeEarnings;

        return {
          staff_id: staff.staff_id,
          name: `${staff.first_name} ${staff.last_name}`.trim() || `${staff.staff_id}`,
          hourly_rate: rate,
          regular_hours: totalRegularHours,
          overtime_hours: totalOvertimeHours,
          doubletime_hours: totalDoubleTimeHours,
          total_hours: totalWorkedHours,
          regular_earnings: regularEarnings,
          overtime_earnings: overtimeEarnings,
          doubletime_earnings: doubletimeEarnings,
          total_earnings: totalEarnings
        } as PayrollReport;
      });
  };

  // Generate Absence Report
  const generateAttendanceReport = async (): Promise<AbsenceReportRow[]> => {
    if (!startDate || !endDate) return [];

    const { data, error } = await supabase.rpc('staff_absence_report', {
      p_start: format(startDate, 'yyyy-MM-dd'),
      p_end: format(endDate, 'yyyy-MM-dd'),
      p_staff_ids: selectedAbsenceStaffIds.length > 0 ? selectedAbsenceStaffIds : null,
      p_staff_scope: selectedStaffType,
      p_employment_type: selectedEmploymentType === 'all' ? null : selectedEmploymentType,
    });

    if (error) throw error;
    return normalizeAbsenceRows((data || []) as AbsenceReportRow[]);
  };
  
  // Handle generate report
  const handleGenerateReport = async () => {
    setReportData(null);
    setReportError(null);
    setExpandedAbsenceRows(new Set());

    if (!startDate || !endDate) {
      setReportError('Select a start and end date before generating this report.');
      return;
    }

    if (activeTab === 'payroll') {
      setIsGenerating(true);
      return;
    }

    setIsGenerating(true);
    try {
      const data = await generateAttendanceReport();
      setReportData(data);
    } catch (error) {
      setReportError(readableErrorMessage(error));
      setReportData(null);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Export report data
  const exportReport = () => {
    if (!reportData) return;
    
    const filename = `${activeTab}-report-${format(startDate || new Date(), 'yyyy-MM-dd')}-to-${format(endDate || new Date(), 'yyyy-MM-dd')}`;
    if (activeTab === 'absence') {
      exportToCSV(
        (reportData as AbsenceReportRow[]).map((row) => ({
          Employee: row.name,
          'Employment type': employmentTypeLabel(row.employment_type),
          'Working days': formatAbsenceCount(row, row.working_days),
          Present: formatAbsenceCount(row, row.days_present),
          'Unclassified non-attendance': formatAbsenceCount(row, row.days_absent),
          'Absence rate': formatAbsenceRate(row),
          'Public holidays': formatAbsenceCount(row, row.public_holidays_count),
          Bradford: formatAbsenceCount(row, row.bradford_factor),
          'Worked public holidays': row.worked_holiday_dates.join('; '),
          'Timecard exceptions': row.incomplete_timecard_dates.join('; '),
          'Absent dates': row.absent_dates.join('; '),
          Notes: row.has_missing_hire_date ? 'needs hire date' : '',
        })),
        filename,
      );
      return;
    }

    exportToCSV(reportData, filename);
  };

  // Print Payroll report as a formatted PDF
  const printPayrollPdf = async () => {
    if (!reportData || activeTab !== 'payroll') return;
    const periodText = `${formatDateSA(startDate || new Date())} – ${formatDateSA(endDate || new Date())}`;
    const doc = (
      <StaffPayrollPDFNamed
        periodText={periodText}
        data={(reportData as PayrollReport[]).map(r => ({
          staff_id: r.staff_id,
          name: r.name,
          hourly_rate: r.hourly_rate,
          regular_hours: r.regular_hours,
          overtime_hours: r.overtime_hours,
          doubletime_hours: r.doubletime_hours,
          total_hours: r.total_hours,
          regular_earnings: r.regular_earnings,
          overtime_earnings: r.overtime_earnings,
          doubletime_earnings: r.doubletime_earnings,
          total_earnings: r.total_earnings,
        }))}
        generatedAt={`${format(new Date(), 'PPpp')}`}
      />
    );

    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url);
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${format(startDate || new Date(), 'yyyy-MM-dd')}-to-${format(endDate || new Date(), 'yyyy-MM-dd')}.pdf`;
      a.click();
    }
  };

  const printAbsencePdf = async () => {
    if (!reportData || activeTab !== 'absence') return;

    setReportError(null);

    try {
      const [{ pdf: renderPdf }, { default: StaffAbsencePDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/features/staff/StaffAbsencePDF'),
      ]);

      const blob = await renderPdf(
        <StaffAbsencePDF
          companyName={companyName}
          periodLabel={periodLabel}
          scopeLabel={absenceScopeLabel}
          generatedAt={format(new Date(), 'PPpp')}
          rows={reportData as AbsenceReportRow[]}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url);
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `absence-${format(startDate || new Date(), 'yyyy-MM-dd')}-to-${format(endDate || new Date(), 'yyyy-MM-dd')}.pdf`;
        a.click();
      }
    } catch (error) {
      setReportError(`Could not generate the PDF: ${readableErrorMessage(error)}`);
    }
  };

  const toggleAbsenceStaffSelection = (staffId: number, checked: boolean) => {
    setSelectedAbsenceStaffIds((current) => {
      if (checked) {
        return current.includes(staffId) ? current : [...current, staffId];
      }

      return current.filter((id) => id !== staffId);
    });
  };

  const toggleAbsenceRow = (staffId: number) => {
    setExpandedAbsenceRows((current) => {
      const next = new Set(current);
      if (next.has(staffId)) {
        next.delete(staffId);
      } else {
        next.add(staffId);
      }
      return next;
    });
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
                        {startDate ? formatDateSA(startDate) : <span>Pick a date</span>}
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
                        {endDate ? formatDateSA(endDate) : <span>Pick a date</span>}
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
                  <Select value={selectedStaffType} onValueChange={(value) => setSelectedStaffType(value as StaffScope)}>
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
                    <HoursTable data={reportData as PayrollReport[]} />
                  </div>
                  
                  {/* Export Actions */}
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={exportReport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export to CSV
                    </Button>
                    <Button variant="outline" onClick={printPayrollPdf}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print PDF
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
                        {startDate ? formatDateSA(startDate) : <span>Pick a date</span>}
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
                        {endDate ? formatDateSA(endDate) : <span>Pick a date</span>}
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Staff Type</Label>
                  <Select value={selectedStaffType} onValueChange={(value) => setSelectedStaffType(value as StaffScope)}>
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
                  <Label>Employment type</Label>
                  <Select 
                    value={selectedEmploymentType}
                    onValueChange={(value) => setSelectedEmploymentType(value as EmploymentTypeFilter)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {EMPLOYMENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 lg:col-span-1">
                  <div className="flex items-center justify-between gap-3">
                    <Label>Specific staff (optional)</Label>
                    {selectedAbsenceStaffIds.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSelectedAbsenceStaffIds([])}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-md border p-3">
                    {isLoadingStaff ? (
                      <p className="text-sm text-muted-foreground">Loading staff...</p>
                    ) : staffData.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No staff found.</p>
                    ) : (
                      <div className="space-y-2">
                        {staffData.map((staff) => {
                          const staffName = `${staff.first_name} ${staff.last_name}`.trim() || String(staff.staff_id);
                          const checked = selectedAbsenceStaffIds.includes(staff.staff_id);

                          return (
                            <label
                              key={staff.staff_id}
                              htmlFor={`absence-staff-${staff.staff_id}`}
                              className="flex cursor-pointer items-center gap-2 text-sm"
                            >
                              <Checkbox
                                id={`absence-staff-${staff.staff_id}`}
                                checked={checked}
                                onCheckedChange={(value) => toggleAbsenceStaffSelection(staff.staff_id, Boolean(value))}
                              />
                              <span>{staffName}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedAbsenceStaffIds.length > 0
                      ? `${selectedAbsenceStaffIds.length} selected`
                      : 'Leave empty to use the staff type scope.'}
                  </p>
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

              {reportError && (
                <Alert variant="destructive">
                  <AlertDescription>{reportError}</AlertDescription>
                </Alert>
              )}

              {showMonthlyUntaggedBanner && (
                <Alert>
                  <AlertDescription>
                    No staff are tagged as Monthly yet - set Employment type on the staff record.
                  </AlertDescription>
                </Alert>
              )}
              
              {/* Report Results */}
              {activeTab === 'absence' && reportData && reportData.length > 0 && (
                <>
                  <div className="space-y-3 rounded-md border bg-muted/20 px-4 py-3 text-sm">
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">How to read this:</span> counts working days only — weekends, public holidays and company closures are excluded. Company policy: 15 leave days/year.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-hidden />
                        <p className="text-muted-foreground"><span className="font-medium text-foreground">Unclassified non-attendance</span> — a working day with no completed timecard. Not yet split into approved leave vs an unexplained no-show; reconcile before any payroll or disciplinary action.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                        <p className="text-muted-foreground"><span className="font-medium text-foreground">Timecard exception</span> — an incomplete clock record (e.g. clocked in, never clocked out). A data issue, not an absence — excluded from the count until it's fixed.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden />
                        <p className="text-muted-foreground"><span className="font-medium text-foreground">Worked a public holiday</span> — clocked in on a public holiday. Not an absence — flagged so payroll can apply double-time.</p>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead className="text-right">Working days</TableHead>
                          <TableHead className="text-right">Present</TableHead>
                          <TableHead className="text-right">Unclassified non-attendance</TableHead>
                          <TableHead className="text-right">Absence rate</TableHead>
                          <TableHead className="text-right">Public holidays</TableHead>
                          <TableHead className="text-right">Bradford</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(reportData as AbsenceReportRow[]).map((row) => {
                          const expanded = expandedAbsenceRows.has(row.staff_id);
                          const hasDetails = hasAbsenceDetails(row);
                          const bradford = asNumber(row.bradford_factor);

                          return (
                            <Fragment key={row.staff_id}>
                              <TableRow>
                                <TableCell className="min-w-[240px]">
                                  <div className="flex items-start gap-2">
                                    {hasDetails ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="mt-0.5 h-6 w-6 shrink-0"
                                        onClick={() => toggleAbsenceRow(row.staff_id)}
                                        aria-expanded={expanded}
                                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name} absence details`}
                                      >
                                        {expanded ? (
                                          <ChevronDown className="h-4 w-4" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4" />
                                        )}
                                      </Button>
                                    ) : (
                                      <span className="mt-0.5 h-6 w-6 shrink-0" />
                                    )}
                                    <div className="space-y-1">
                                      <div className="font-medium">{row.name}</div>
                                      <div className="text-xs text-muted-foreground">
                                        {employmentTypeLabel(row.employment_type)}
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {row.has_missing_hire_date && (
                                          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                                            needs hire date
                                          </span>
                                        )}
                                        {row.worked_holiday_dates.length > 0 && (
                                          <span className="rounded-sm bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                                            worked public holiday
                                          </span>
                                        )}
                                        {!row.has_missing_hire_date && bradford > 0 && (
                                          <span
                                            className={cn(
                                              'rounded-sm px-1.5 py-0.5 text-xs font-medium',
                                              bradford >= HIGH_BRADFORD_THRESHOLD
                                                ? 'bg-red-100 text-red-800'
                                                : 'bg-muted text-muted-foreground',
                                            )}
                                          >
                                            {bradford >= HIGH_BRADFORD_THRESHOLD ? 'high Bradford pattern' : 'Bradford pattern'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatAbsenceCount(row, row.working_days)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatAbsenceCount(row, row.days_present)}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {formatAbsenceCount(row, row.days_absent)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatAbsenceRate(row)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatAbsenceCount(row, row.public_holidays_count)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'text-right tabular-nums',
                                    !row.has_missing_hire_date && bradford >= HIGH_BRADFORD_THRESHOLD && 'font-medium text-destructive',
                                  )}
                                >
                                  {formatAbsenceCount(row, bradford)}
                                </TableCell>
                              </TableRow>
                              {expanded && hasDetails && (
                                <TableRow>
                                  <TableCell colSpan={7} className="bg-muted/30">
                                    <div className="space-y-4 px-4 py-4">
                                      <AbsenceDateGroup
                                        tone="absent"
                                        label="Unclassified non-attendance"
                                        dates={row.absent_dates}
                                      />
                                      <AbsenceDateGroup
                                        tone="holiday"
                                        label="Worked a public holiday — review for double-time"
                                        dates={row.worked_holiday_dates}
                                      />
                                      <AbsenceDateGroup
                                        tone="exception"
                                        label="Timecard exception — excluded"
                                        dates={row.incomplete_timecard_dates}
                                      />
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {/* Export Actions */}
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={exportReport}>
                      <Download className="mr-2 h-4 w-4" />
                      Export to CSV
                    </Button>
                    <Button variant="outline" onClick={printAbsencePdf}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print / PDF
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
