'use client';

import { type FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, isBefore } from 'date-fns';
import {
  ArrowLeft,
  CalendarIcon,
  Clock,
  Factory,
  Info,
  Loader2,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/components/common/auth-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatDate as formatDateSA } from '@/lib/date-utils';
import { cn, getOrgId } from '@/lib/utils';
import {
  type ShortTimeEntry,
  type ShortTimeStaff,
  useCreateShortTimeEntry,
  useDeleteShortTimeEntry,
  useShortTimeAdminStatus,
  useShortTimeEntries,
  useShortTimeStaffOptions,
} from '@/hooks/useShortTime';

type ScopeMode = 'factory' | 'staff';

function staffName(staff: Pick<ShortTimeStaff, 'first_name' | 'last_name' | 'staff_id'>) {
  return [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() ||
    `Staff #${staff.staff_id}`;
}

function entryScopeLabel(entry: ShortTimeEntry) {
  if (entry.staff_id === null) return 'Whole factory';
  return entry.staff ? staffName(entry.staff) : `Staff #${entry.staff_id}`;
}

function DatePickerField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'w-full justify-start text-left font-normal',
              !value && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? formatDateSA(value) : <span>Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={onChange} initialFocus />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function StaffMultiSelector({
  staffOptions,
  selectedStaffIds,
  isLoading,
  disabled,
  onToggle,
  onSelectAll,
  onClear,
}: {
  staffOptions: ShortTimeStaff[];
  selectedStaffIds: number[];
  isLoading: boolean;
  disabled?: boolean;
  onToggle: (staffId: number, checked: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const allSelected =
    staffOptions.length > 0 &&
    selectedStaffIds.length === staffOptions.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>Staff</Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={allSelected ? onClear : onSelectAll}
            disabled={disabled || isLoading || staffOptions.length === 0}
          >
            {allSelected ? 'Clear' : 'Select all'}
          </Button>
          {selectedStaffIds.length > 0 && !allSelected ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onClear}
              disabled={disabled}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        ) : staffOptions.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No active staff found.</p>
        ) : (
          <div>
            {staffOptions.map((staff) => {
              const checked = selectedStaffIds.includes(staff.staff_id);
              return (
                <label
                  key={staff.staff_id}
                  htmlFor={`short-time-staff-${staff.staff_id}`}
                  className={cn(
                    'flex items-center gap-3 border-b px-3 py-2 text-sm last:border-0',
                    disabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:bg-muted/40',
                  )}
                >
                  <Checkbox
                    id={`short-time-staff-${staff.staff_id}`}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(value) =>
                      onToggle(staff.staff_id, Boolean(value))
                    }
                  />
                  <span>{staffName(staff)}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedStaffIds.length > 0
          ? `${selectedStaffIds.length} selected`
          : 'Select one or more staff members.'}
      </p>
    </div>
  );
}

function ShortTimeTable({
  entries,
  canWrite,
  isLoading,
  isError,
  deletingId,
  onDelete,
}: {
  entries: ShortTimeEntry[];
  canWrite: boolean;
  isLoading: boolean;
  isError: boolean;
  deletingId: number | null;
  onDelete: (entryId: number) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load short time</AlertTitle>
        <AlertDescription>
          Refresh the page and try again. RLS may also hide rows for users outside the
          organization.
        </AlertDescription>
      </Alert>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
        No short time entries recorded.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scope</TableHead>
            <TableHead>Date range</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="w-[120px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const isFactoryScope = entry.staff_id === null;
            return (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={isFactoryScope ? 'secondary' : 'outline'}>
                      {isFactoryScope ? (
                        <Factory className="mr-1 h-3 w-3" />
                      ) : (
                        <Users className="mr-1 h-3 w-3" />
                      )}
                      {entryScopeLabel(entry)}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatDateSA(entry.start_date)} to {formatDateSA(entry.end_date)}
                </TableCell>
                <TableCell className="max-w-[420px]">
                  {entry.note?.trim() ? (
                    <span className="line-clamp-2">{entry.note}</span>
                  ) : (
                    <span className="text-muted-foreground">No note</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={deletingId === entry.id}
                        >
                          {deletingId === entry.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete short time entry?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the entry for {entryScopeLabel(entry)} from{' '}
                            {formatDateSA(entry.start_date)} to{' '}
                            {formatDateSA(entry.end_date)}.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => onDelete(entry.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <span className="text-sm text-muted-foreground">View only</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ShortTimePage() {
  const { user, loading: authLoading } = useAuth();
  const orgId = getOrgId(user);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('factory');
  const [selectedStaffIds, setSelectedStaffIds] = useState<number[]>([]);
  const [startDate, setStartDate] = useState<Date | undefined>(() => new Date());
  const [endDate, setEndDate] = useState<Date | undefined>(() => new Date());
  const [note, setNote] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const entriesQuery = useShortTimeEntries(orgId);
  const staffQuery = useShortTimeStaffOptions(orgId);
  const adminQuery = useShortTimeAdminStatus(user, orgId);
  const createMutation = useCreateShortTimeEntry(orgId);
  const deleteMutation = useDeleteShortTimeEntry(orgId);

  const canWrite = Boolean(orgId && adminQuery.data);
  const isReadOnly = !authLoading && !adminQuery.isLoading && !canWrite;
  const submitDisabled =
    !canWrite ||
    createMutation.isPending ||
    !startDate ||
    !endDate ||
    (scopeMode === 'staff' && selectedStaffIds.length === 0);

  const selectedStaffNames = useMemo(() => {
    const optionsById = new Map(
      (staffQuery.data ?? []).map((staff) => [staff.staff_id, staffName(staff)]),
    );
    return selectedStaffIds.map((staffId) => optionsById.get(staffId) ?? `Staff #${staffId}`);
  }, [selectedStaffIds, staffQuery.data]);

  function toggleStaffSelection(staffId: number, checked: boolean) {
    setSelectedStaffIds((current) => {
      if (checked) {
        return current.includes(staffId) ? current : [...current, staffId];
      }
      return current.filter((id) => id !== staffId);
    });
  }

  function selectAllStaff() {
    setSelectedStaffIds((staffQuery.data ?? []).map((staff) => staff.staff_id));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canWrite) {
      toast.error('Only organization admins can manage short time.');
      return;
    }
    if (!startDate || !endDate) {
      toast.error('Select a start and end date.');
      return;
    }
    if (isBefore(endDate, startDate)) {
      toast.error('End date must be on or after the start date.');
      return;
    }
    if (scopeMode === 'staff' && selectedStaffIds.length === 0) {
      toast.error('Select at least one staff member.');
      return;
    }

    try {
      await createMutation.mutateAsync({
        staffIds: scopeMode === 'factory' ? null : selectedStaffIds,
        startDate: format(startDate, 'yyyy-MM-dd'),
        endDate: format(endDate, 'yyyy-MM-dd'),
        note,
      });

      toast.success(
        scopeMode === 'factory'
          ? 'Short time recorded for the whole factory.'
          : `Short time recorded for ${selectedStaffIds.length} staff.`,
      );
      setNote('');
      if (scopeMode === 'factory') setSelectedStaffIds([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save short time.';
      toast.error(message);
    }
  }

  async function handleDelete(entryId: number) {
    setDeletingId(entryId);
    try {
      await deleteMutation.mutateAsync(entryId);
      toast.success('Short time entry deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete entry.';
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/staff">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Staff
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff/hours">
                <Clock className="mr-2 h-4 w-4" />
                Hours Tracking
              </Link>
            </Button>
          </div>
          <div>
            <h1 className="text-3xl font-bold">Short Time</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Record approved reduced-work date ranges for the whole factory or
              selected staff.
            </p>
          </div>
        </div>
      </div>

      {isReadOnly ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            You can see short time entries for your organization. Creating and deleting
            entries requires an organization admin role.
          </AlertDescription>
        </Alert>
      ) : null}

      {!orgId && !authLoading ? (
        <Alert variant="destructive">
          <AlertTitle>No organization context</AlertTitle>
          <AlertDescription>
            This session does not include an organization id, so short time entries
            cannot be loaded or changed.
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add short time</CardTitle>
            <CardDescription>
              Whole-factory rows apply to every staff member in the selected date range.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-3">
                <Label>Scope</Label>
                <RadioGroup
                  value={scopeMode}
                  onValueChange={(value) => setScopeMode(value as ScopeMode)}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <label
                    htmlFor="short-time-scope-factory"
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                      scopeMode === 'factory' && 'border-primary bg-primary/5',
                    )}
                  >
                    <RadioGroupItem
                      id="short-time-scope-factory"
                      value="factory"
                      className="mt-0.5"
                    />
                    <span>
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Factory className="h-4 w-4 text-muted-foreground" />
                        Whole factory
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        One entry with no staff member assigned.
                      </span>
                    </span>
                  </label>
                  <label
                    htmlFor="short-time-scope-staff"
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                      scopeMode === 'staff' && 'border-primary bg-primary/5',
                    )}
                  >
                    <RadioGroupItem
                      id="short-time-scope-staff"
                      value="staff"
                      className="mt-0.5"
                    />
                    <span>
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Specific staff
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Creates one entry per selected staff member.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </div>

              {scopeMode === 'staff' ? (
                <StaffMultiSelector
                  staffOptions={staffQuery.data ?? []}
                  selectedStaffIds={selectedStaffIds}
                  isLoading={staffQuery.isLoading}
                  disabled={!canWrite || createMutation.isPending}
                  onToggle={toggleStaffSelection}
                  onSelectAll={selectAllStaff}
                  onClear={() => setSelectedStaffIds([])}
                />
              ) : null}

              {scopeMode === 'staff' && selectedStaffNames.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedStaffNames.slice(0, 8).map((name) => (
                    <Badge key={name} variant="outline">
                      {name}
                    </Badge>
                  ))}
                  {selectedStaffNames.length > 8 ? (
                    <Badge variant="secondary">
                      +{selectedStaffNames.length - 8} more
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <DatePickerField
                  id="short-time-start-date"
                  label="Start date"
                  value={startDate}
                  onChange={setStartDate}
                  disabled={!canWrite || createMutation.isPending}
                />
                <DatePickerField
                  id="short-time-end-date"
                  label="End date"
                  value={endDate}
                  onChange={setEndDate}
                  disabled={!canWrite || createMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="short-time-note">Note</Label>
                <Textarea
                  id="short-time-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional context for this short time period"
                  disabled={!canWrite || createMutation.isPending}
                  className="min-h-24"
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={submitDisabled}>
                  {createMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {createMutation.isPending ? 'Saving...' : 'Add Entry'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recorded short time</CardTitle>
          <CardDescription>
            {entriesQuery.data?.length ?? 0} entries visible under current RLS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShortTimeTable
            entries={entriesQuery.data ?? []}
            canWrite={canWrite}
            isLoading={entriesQuery.isLoading}
            isError={entriesQuery.isError}
            deletingId={deletingId}
            onDelete={(entryId) => {
              void handleDelete(entryId);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
