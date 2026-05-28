'use client';

import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
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
import { addDays, differenceInDays, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { formatDate as formatDateSA } from '@/lib/date-utils';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { BarChart4, CalendarIcon, ChevronDown, ChevronRight, Download, Loader2, Printer, DollarSign, ClipboardList, UserX, Search, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { pdf } from '@react-pdf/renderer';
import { useReactToPrint } from 'react-to-print';
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
import StaffPayrollPDF, { StaffPayrollPDF as StaffPayrollPDFNamed, type PayrollRow as PayrollRowPDF } from './StaffPayrollPDF';
import { buildPayrollRangeReport, type PayrollRangeReportRow } from '@/lib/payroll-range-report';

// Types
type Staff = {
  staff_id: number;
  first_name: string;
  last_name: string;
  current_staff: boolean;
  hourly_rate: number | null;
};

export type DailySummary = {
  staff_id: number;
  date_worked: string;
  total_hours_worked: number; // total worked including DT
  regular_minutes: number | null;
  ot_minutes: number | null;
  dt_minutes: number; // double-time minutes (Sundays/holidays)
};

type TimeSegment = {
  staff_id: number;
  date_worked: string;
  start_time: string;
  end_time: string | null;
  segment_type: 'work' | 'break';
  duration_minutes: number | null;
  break_type: string | null;
};

type PayrollReport = PayrollRangeReportRow;

type AttendanceReport = {
  staff_id: number;
  name: string;
  days_present: number;
  days_absent: number;
  days_late: number;
  total_hours: number;
  attendance_rate: string;
};

// Stable empty arrays to prevent infinite useEffect loops
const EMPTY_STAFF_ARRAY: Staff[] = [];
const EMPTY_SUMMARIES_ARRAY: DailySummary[] = [];
const EMPTY_SEGMENTS_ARRAY: TimeSegment[] = [];

const getStaffDisplayName = (staff: Pick<Staff, 'staff_id' | 'first_name' | 'last_name'>) =>
  `${staff.first_name} ${staff.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || `${staff.staff_id}`;

const sortStaffByName = (staff: Staff[]) =>
  [...staff].sort((a, b) => getStaffDisplayName(a).localeCompare(getStaffDisplayName(b), undefined, { sensitivity: 'base' }));

const formatSegmentTime = (value: string | null) => {
  if (!value) return 'Open';
  return format(new Date(value), 'HH:mm');
};

const formatSegmentDuration = (minutes: number | null) => {
  if (minutes == null) return '';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
};

const getStaffTypeLabel = (staffType: string) => {
  if (staffType === 'active') return 'active staff';
  if (staffType === 'inactive') return 'inactive staff';
  return 'staff';
};

type StaffSelectorProps = {
  staff: Staff[];
  selectedStaffIds: Set<number>;
  selectedVisibleStaffCount: number;
  selectedStaffType: string;
  onToggleStaff: (staffId: number, checked: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
};

const StaffSelector = ({
  staff,
  selectedStaffIds,
  selectedVisibleStaffCount,
  selectedStaffType,
  onToggleStaff,
  onSelectAll,
  onClear,
}: StaffSelectorProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const staffTypeLabel = getStaffTypeLabel(selectedStaffType);
  const selectedStaff = staff.filter((person) => selectedStaffIds.has(person.staff_id));
  const selectedNames = selectedStaff.map(getStaffDisplayName);
  const selectionSummary =
    staff.length > 0 && selectedVisibleStaffCount === staff.length
      ? `All ${staffTypeLabel}`
      : selectedVisibleStaffCount === 0
        ? 'No staff selected'
        : selectedStaff.length === 1
          ? selectedNames[0]
          : `${selectedNames[0]} + ${selectedVisibleStaffCount - 1} more`;
  const search = searchTerm.trim().toLowerCase();
  const visibleStaff = search
    ? staff.filter((person) => getStaffDisplayName(person).toLowerCase().includes(search))
    : staff;

  return (
    <div className="space-y-2">
      <Label>Staff to include</Label>
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background/60 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{selectionSummary}</div>
            <div className="text-xs text-muted-foreground">
              {selectedVisibleStaffCount} of {staff.length} {staffTypeLabel} selected
            </div>
          </div>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              Change
            </Button>
          </SheetTrigger>
          <SheetContent className="flex w-full flex-col p-0 sm:max-w-md">
            <SheetHeader className="border-b px-6 py-5">
              <SheetTitle>Choose staff</SheetTitle>
              <SheetDescription>
                Select the staff members to include in this report.
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-3 border-b px-6 py-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search staff"
                    className="pl-9"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{selectedVisibleStaffCount} selected</span>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={onSelectAll}>
                      Select all
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                      Clear
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {visibleStaff.length > 0 ? (
                  <div className="space-y-1">
                    {visibleStaff.map((person) => {
                      const inputId = `staff-sheet-${person.staff_id}`;
                      const isSelected = selectedStaffIds.has(person.staff_id);
                      return (
                        <label
                          key={person.staff_id}
                          htmlFor={inputId}
                          className={cn(
                            'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted',
                            isSelected && 'bg-muted/70',
                          )}
                        >
                          <Checkbox
                            id={inputId}
                            checked={isSelected}
                            onCheckedChange={(checked) => onToggleStaff(person.staff_id, checked === true)}
                          />
                          <span className="min-w-0 flex-1 truncate">{getStaffDisplayName(person)}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No staff match that search.
                  </div>
                )}
              </div>
            </div>

            <SheetFooter className="border-t px-6 py-4">
              <div className="flex w-full items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{selectedVisibleStaffCount} selected</span>
                <SheetClose asChild>
                  <Button type="button">Apply</Button>
                </SheetClose>
              </div>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
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
  const [expandedStaffIds, setExpandedStaffIds] = useState<Set<number>>(new Set());
  const [expandedWeekKeys, setExpandedWeekKeys] = useState<Set<string>>(new Set());
  const [expandedDayKeys, setExpandedDayKeys] = useState<Set<string>>(new Set());
  const totals = data.reduce(
    (acc, row) => {
      acc.total += row.total_hours;
      acc.regular += row.regular_hours;
      acc.overtime += row.overtime_hours + row.doubletime_hours;
      return acc;
    },
    { total: 0, regular: 0, overtime: 0 },
  );
  const allExpanded = data.length > 0 && data.every((row) => expandedStaffIds.has(row.staff_id));

  useEffect(() => {
    setExpandedStaffIds(data.length === 1 ? new Set(data.map((row) => row.staff_id)) : new Set());
    setExpandedWeekKeys(new Set());
    setExpandedDayKeys(new Set());
  }, [data]);

  const toggleStaffExpanded = (staffId: number) => {
    setExpandedStaffIds((current) => {
      const next = new Set(current);
      if (next.has(staffId)) {
        next.delete(staffId);
      } else {
        next.add(staffId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedStaffIds(new Set(data.map((row) => row.staff_id)));
  };

  const collapseAll = () => {
    setExpandedStaffIds(new Set());
    setExpandedWeekKeys(new Set());
    setExpandedDayKeys(new Set());
  };

  const toggleWeekExpanded = (weekKey: string) => {
    setExpandedWeekKeys((current) => {
      const next = new Set(current);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      return next;
    });
  };

  const toggleDayExpanded = (dayKey: string) => {
    setExpandedDayKeys((current) => {
      const next = new Set(current);
      if (next.has(dayKey)) {
        next.delete(dayKey);
      } else {
        next.add(dayKey);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total hours</div>
          <div className="text-lg font-semibold">{totals.total.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Normal hours</div>
          <div className="text-lg font-semibold">{totals.regular.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overtime hours</div>
          <div className="text-lg font-semibold">{totals.overtime.toFixed(1)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {data.length === 1
            ? (expandedStaffIds.size === 1 ? 'Weekly detail is open for review.' : 'Weekly detail is collapsed.')
            : `${expandedStaffIds.size} of ${data.length} staff expanded.`}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={expandAll} disabled={allExpanded}>
            Expand all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={collapseAll} disabled={expandedStaffIds.size === 0}>
            Collapse all
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Staff</TableHead>
            <TableHead>Week</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Normal</TableHead>
            <TableHead className="text-right">OT</TableHead>
            <TableHead className="text-right">DT</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const isExpanded = expandedStaffIds.has(row.staff_id);
            return (
              <Fragment key={row.staff_id}>
              <TableRow
                key={`${row.staff_id}-total`}
                className="cursor-pointer bg-muted/40 hover:bg-muted/60"
                onClick={() => toggleStaffExpanded(row.staff_id)}
              >
                <TableCell className="font-semibold">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} weekly detail for ${row.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleStaffExpanded(row.staff_id);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>{row.name}</span>
                  </button>
                </TableCell>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right font-semibold">{row.total_hours.toFixed(1)}</TableCell>
                <TableCell className="text-right font-semibold">{row.regular_hours.toFixed(1)}</TableCell>
                <TableCell className="text-right font-semibold">{row.overtime_hours.toFixed(1)}</TableCell>
                <TableCell className="text-right font-semibold">{row.doubletime_hours.toFixed(1)}</TableCell>
              </TableRow>
              {isExpanded && (row.weeks ?? []).map((week) => {
                const weekKey = `${row.staff_id}-${week.week_start}`;
                const isWeekExpanded = expandedWeekKeys.has(weekKey);

                return (
                  <Fragment key={weekKey}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggleWeekExpanded(weekKey)}>
                      <TableCell />
                      <TableCell>
                        <button
                          type="button"
                          className="flex items-start gap-2 text-left"
                          aria-expanded={isWeekExpanded}
                          aria-label={`${isWeekExpanded ? 'Collapse' : 'Expand'} day detail for ${week.week_label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleWeekExpanded(weekKey);
                          }}
                        >
                          {isWeekExpanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          )}
                          <span>
                            <span className="block font-medium">{week.week_label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {week.day_count} work day{week.day_count === 1 ? '' : 's'}
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-right">{week.total_hours.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{week.regular_hours.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{week.overtime_hours.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{week.doubletime_hours.toFixed(1)}</TableCell>
                    </TableRow>
                    {isWeekExpanded && week.days.map((day) => {
                      const dayKey = `${weekKey}-${day.date_worked}`;
                      const isDayExpanded = expandedDayKeys.has(dayKey);

                      return (
                        <Fragment key={dayKey}>
                          <TableRow className="cursor-pointer bg-muted/20 hover:bg-muted/30" onClick={() => toggleDayExpanded(dayKey)}>
                            <TableCell />
                            <TableCell>
                              <button
                                type="button"
                                className="flex items-start gap-2 pl-8 text-left text-sm text-muted-foreground"
                                aria-expanded={isDayExpanded}
                                aria-label={`${isDayExpanded ? 'Collapse' : 'Expand'} clock segments for ${day.day_label}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleDayExpanded(dayKey);
                                }}
                              >
                                {isDayExpanded ? (
                                  <ChevronDown className="mt-0.5 h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="mt-0.5 h-3.5 w-3.5" />
                                )}
                                <span>{day.day_label}</span>
                              </button>
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">{day.total_hours.toFixed(1)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{day.regular_hours.toFixed(1)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{day.overtime_hours.toFixed(1)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{day.doubletime_hours.toFixed(1)}</TableCell>
                          </TableRow>
                          {isDayExpanded && (
                            <TableRow className="bg-muted/10">
                              <TableCell />
                              <TableCell colSpan={5}>
                                <div className="flex flex-wrap items-center gap-2 py-2 pl-14 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground/80">Clock segments</span>
                                  {day.segments.length > 0 ? (
                                    day.segments.map((segment, index) => (
                                      <span
                                        key={`${dayKey}-${segment.start_time}-${index}`}
                                        className="inline-flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1"
                                      >
                                        <span className="font-medium capitalize text-foreground/80">
                                          {segment.segment_type}
                                          {segment.segment_type === 'break' && segment.break_type ? ` (${segment.break_type})` : ''}
                                        </span>
                                        <span>{formatSegmentTime(segment.start_time)} - {formatSegmentTime(segment.end_time)}</span>
                                        {segment.duration_minutes != null && (
                                          <span className="text-muted-foreground/80">({formatSegmentDuration(segment.duration_minutes)})</span>
                                        )}
                                      </span>
                                    ))
                                  ) : (
                                    <span>No clock segments found for this day.</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export function StaffReports() {
  const { weekStartDay, standardWeekHours } = useOrgSettings();
  const [activeTab, setActiveTab] = useState<string>('payroll');
  const [reportType, setReportType] = useState<string>('weekly');

  // Calculate the current pay week based on org settings
  const today = new Date();
  const currentWeekStart = startOfWeek(today, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
  const currentWeekEnd = endOfWeek(today, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 })

  const [startDate, setStartDate] = useState<Date | undefined>(currentWeekStart);
  const [endDate, setEndDate] = useState<Date | undefined>(currentWeekEnd);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedStaffType, setSelectedStaffType] = useState<string>('active');
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<number>>(new Set());
  const [staffSelectionTouched, setStaffSelectionTouched] = useState(false);
  const [reportData, setReportData] = useState<PayrollReport[] | AttendanceReport[] | null>(null);

  // Setup print ref and handler
  const reportRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: reportRef,
    documentTitle: 'Payroll Report',
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
    let staff: Staff[];
    if (selectedStaffType === 'active') {
      staff = staffData.filter(s => s.current_staff);
    } else if (selectedStaffType === 'inactive') {
      staff = staffData.filter(s => !s.current_staff);
    } else {
      staff = staffData;
    }
    return sortStaffByName(staff);
  }, [staffData, selectedStaffType]);

  const visibleStaffIds = useMemo(() => filteredStaff.map((staff) => staff.staff_id), [filteredStaff]);
  const selectedVisibleStaffCount = visibleStaffIds.filter((id) => selectedStaffIds.has(id)).length;

  useEffect(() => {
    setSelectedStaffIds((current) => {
      if (!visibleStaffIds.length) return new Set();
      if (!staffSelectionTouched) {
        return new Set(visibleStaffIds);
      }
      return new Set(Array.from(current).filter((id) => visibleStaffIds.includes(id)));
    });
  }, [staffSelectionTouched, visibleStaffIds]);

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
        .select('staff_id, date_worked, total_hours_worked, regular_minutes, ot_minutes, dt_minutes')
        .gte('date_worked', start)
        .lte('date_worked', end);

      if (error) throw error;
      return (data || []) as DailySummary[];
    },
    enabled: !!startDate && !!endDate
  });

  const { data: timeSegments = EMPTY_SEGMENTS_ARRAY, isLoading: isLoadingSegments } = useQuery({
    queryKey: ['time_segments', 'reports', startDate, endDate],
    queryFn: async () => {
      if (!startDate || !endDate) return [];

      const formatDate = (date: Date) => format(date, 'yyyy-MM-dd');
      const start = formatDate(startDate);
      const end = formatDate(endDate);

      const { data, error } = await supabase
        .from('time_segments')
        .select('staff_id, date_worked, start_time, end_time, segment_type, duration_minutes, break_type')
        .gte('date_worked', start)
        .lte('date_worked', end)
        .order('start_time', { ascending: true });

      if (error) throw error;
      return (data || []) as TimeSegment[];
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
    if (isGenerating && !isLoadingHours && !isLoadingSegments && !isLoadingStaff) {
      let data: any[] = [];
      if (activeTab === 'payroll') {
        data = generatePayrollReport();
      } else if (activeTab === 'absence') {
        data = generateAttendanceReport();
      }
      setReportData(data);
      setIsGenerating(false);
    }
  }, [isGenerating, isLoadingHours, isLoadingSegments, isLoadingStaff, activeTab]);

  const handleReportTypeChange = (value: string) => {
    setReportType(value);
    const anchorDate = startDate || new Date();
    if (value === 'weekly') {
      setStartDate(startOfWeek(anchorDate, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }));
      setEndDate(endOfWeek(anchorDate, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }));
      return;
    }
    if (value === 'biweekly') {
      const firstWeekStart = startOfWeek(anchorDate, { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 });
      setStartDate(firstWeekStart);
      setEndDate(addDays(firstWeekStart, 13));
      return;
    }
    if (value === 'monthly') {
      const monthStart = startOfMonth(anchorDate);
      setStartDate(monthStart);
      setEndDate(isSameMonth(monthStart, new Date()) ? new Date() : endOfMonth(monthStart));
    }
  };

  const toggleStaffSelection = (staffId: number, checked: boolean) => {
    setStaffSelectionTouched(true);
    setSelectedStaffIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(staffId);
      } else {
        next.delete(staffId);
      }
      return next;
    });
  };

  const selectAllVisibleStaff = () => {
    setStaffSelectionTouched(true);
    setSelectedStaffIds(new Set(visibleStaffIds));
  };

  const clearVisibleStaff = () => {
    setStaffSelectionTouched(true);
    setSelectedStaffIds(new Set());
  };

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

    return buildPayrollRangeReport({
      staff: effectiveStaff,
      summaries: hoursData,
      segments: timeSegments,
      selectedStaffIds: Array.from(selectedStaffIds),
      weekStartDay,
      standardWeekHours,
    });
  };

  // Generate Attendance Report
  const generateAttendanceReport = (): AttendanceReport[] => {
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

    // Calculate the total number of working days in the date range
    const totalDays = differenceInDays(endDate, startDate) + 1;

    return effectiveStaff
      .filter(staff => selectedStaffIds.has(staff.staff_id))
      .map(staff => {
        // Get summaries for this staff member
        const staffSummaries = hoursData.filter(h => h.staff_id === staff.staff_id);

        // Days present = days with total_hours_worked > 0
        const daysPresent = staffSummaries.filter(s => (s.total_hours_worked || 0) > 0).length;
        const daysAbsent = totalDays - daysPresent;
        const daysLate = 0; // Placeholder
        const totalHours = staffSummaries.reduce((sum, s) => sum + (s.total_hours_worked || 0), 0);
        const attendanceRate = ((daysPresent / totalDays) * 100).toFixed(1) + '%';

        return {
          staff_id: staff.staff_id,
          name: `${staff.first_name} ${staff.last_name}`.trim() || `${staff.staff_id}`,
          days_present: daysPresent,
          days_absent: daysAbsent,
          days_late: daysLate,
          total_hours: totalHours,
          attendance_rate: attendanceRate
        };
      });
  };

  // Handle generate report
  const handleGenerateReport = () => {
    // Clear previous data and kick off generation
    setReportData(null);
    setIsGenerating(true);
  }

  // Export report data
  const exportReport = () => {
    if (!reportData) return;

    const filename = `${activeTab}-report-${format(startDate || new Date(), 'yyyy-MM-dd')}-to-${format(endDate || new Date(), 'yyyy-MM-dd')}`;
    if (activeTab === 'payroll') {
      const csvRows = (reportData as PayrollReport[]).flatMap((row) => [
        {
          staff: row.name,
          week: 'Total',
          total_hours: row.total_hours,
          normal_hours: row.regular_hours,
          overtime_hours: row.overtime_hours,
          doubletime_hours: row.doubletime_hours,
        },
        ...(row.weeks ?? []).map((week) => ({
          staff: row.name,
          week: week.week_label,
          total_hours: week.total_hours,
          normal_hours: week.regular_hours,
          overtime_hours: week.overtime_hours,
          doubletime_hours: week.doubletime_hours,
        })),
      ]);
      exportToCSV(csvRows, filename);
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
                  <Select value={reportType} onValueChange={handleReportTypeChange}>
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
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
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

                <StaffSelector
                  staff={filteredStaff}
                  selectedStaffIds={selectedStaffIds}
                  selectedVisibleStaffCount={selectedVisibleStaffCount}
                  selectedStaffType={selectedStaffType}
                  onToggleStaff={toggleStaffSelection}
                  onSelectAll={selectAllVisibleStaff}
                  onClear={clearVisibleStaff}
                />
              </div>

              {/* Generate Button */}
              <div className="flex justify-end">
                <Button onClick={handleGenerateReport} disabled={isGenerating || selectedVisibleStaffCount === 0}>
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
                  <Select value={reportType} onValueChange={handleReportTypeChange}>
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
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
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

                <StaffSelector
                  staff={filteredStaff}
                  selectedStaffIds={selectedStaffIds}
                  selectedVisibleStaffCount={selectedVisibleStaffCount}
                  selectedStaffType={selectedStaffType}
                  onToggleStaff={toggleStaffSelection}
                  onSelectAll={selectAllVisibleStaff}
                  onClear={clearVisibleStaff}
                />
              </div>

              {/* Generate Button */}
              <div className="flex justify-end">
                <Button onClick={handleGenerateReport} disabled={isGenerating || selectedVisibleStaffCount === 0}>
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
