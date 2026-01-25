'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import {
    format,
    addDays,
    subDays,
    parseISO
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
    CardHeader,
    CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
    ChevronLeft,
    ChevronRight,
    Loader2,
    RefreshCw,
    Search,
    X,
    Clock,
    LogIn,
    LogOut,
    Trash2
} from 'lucide-react';
import { addManualClockEvent, processClockEventsIntoSegments } from '@/lib/utils/attendance';

// Types
type StaffRow = {
    staff_id: number;
    staff_name: string;
    job_description: string | null;
    clockIn: string | null;
    clockOut: string | null;
    totalHours: number;
};

type FilterType = 'all' | 'not_clocked_in' | 'not_clocked_out' | 'incomplete';

// Stable empty arrays to prevent infinite useEffect loops
const EMPTY_STAFF_ARRAY: { staff_id: number; first_name: string; last_name: string; job_description: string | null; is_active: boolean; current_staff: boolean }[] = [];
const EMPTY_EVENTS_ARRAY: { staff_id: number; event_time: string; event_type: string }[] = [];

export function WagesGrid() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [staffData, setStaffData] = useState<StaffRow[]>([]);
    const [filteredData, setFilteredData] = useState<StaffRow[]>([]);
    const [filterText, setFilterText] = useState('');
    const [statusFilter, setStatusFilter] = useState<FilterType>('all');
    const [selectedStaff, setSelectedStaff] = useState<Set<number>>(new Set());
    const [bulkClockIn, setBulkClockIn] = useState('');
    const [bulkClockOut, setBulkClockOut] = useState('');
    const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
    const [editClockIn, setEditClockIn] = useState('');
    const [editClockOut, setEditClockOut] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const { toast } = useToast();

    const dateStr = format(selectedDate, 'yyyy-MM-dd');

    // Fetch active staff
    const { data: activeStaff = EMPTY_STAFF_ARRAY, isLoading: isLoadingStaff } = useQuery({
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

    // Fetch clock events for selected date
    const { data: clockEvents = EMPTY_EVENTS_ARRAY, isLoading: isLoadingEvents, refetch: refetchEvents } = useQuery({
        queryKey: ['time_clock_events', 'quick_entry', dateStr],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('time_clock_events')
                .select('staff_id, event_time, event_type')
                .gte('event_time', `${dateStr}T00:00:00`)
                .lte('event_time', `${dateStr}T23:59:59`)
                .order('event_time', { ascending: true });
            if (error) throw error;
            return data || [];
        },
    });

    // Process staff data
    useEffect(() => {
        if (!activeStaff || activeStaff.length === 0) return;

        const processed = activeStaff.map(staff => {
            const staffEvents = clockEvents.filter(e => e.staff_id === staff.staff_id);
            const clockInEvent = staffEvents.find(e => e.event_type === 'clock_in');
            const clockOutEvent = staffEvents.find(e => e.event_type === 'clock_out');

            const clockIn = clockInEvent ? format(parseISO(clockInEvent.event_time), 'HH:mm') : null;
            const clockOut = clockOutEvent ? format(parseISO(clockOutEvent.event_time), 'HH:mm') : null;

            let totalHours = 0;
            if (clockIn && clockOut) {
                const [inH, inM] = clockIn.split(':').map(Number);
                const [outH, outM] = clockOut.split(':').map(Number);
                totalHours = (outH + outM / 60) - (inH + inM / 60);
                totalHours = Math.max(0, Math.round(totalHours * 100) / 100);
            }

            return {
                staff_id: staff.staff_id,
                staff_name: `${staff.first_name} ${staff.last_name}`,
                job_description: staff.job_description,
                clockIn,
                clockOut,
                totalHours
            };
        });
        setStaffData(processed);
    }, [activeStaff, clockEvents]);

    // Apply filters
    useEffect(() => {
        let filtered = staffData;

        // Text filter
        if (filterText) {
            const searchTerm = filterText.toLowerCase();
            filtered = filtered.filter(row =>
                row.staff_name.toLowerCase().includes(searchTerm) ||
                (row.job_description && row.job_description.toLowerCase().includes(searchTerm))
            );
        }

        // Status filter
        switch (statusFilter) {
            case 'not_clocked_in':
                filtered = filtered.filter(row => !row.clockIn);
                break;
            case 'not_clocked_out':
                filtered = filtered.filter(row => row.clockIn && !row.clockOut);
                break;
            case 'incomplete':
                filtered = filtered.filter(row => !row.clockIn || !row.clockOut);
                break;
        }

        setFilteredData(filtered);
    }, [staffData, filterText, statusFilter]);

    // Navigation
    const goToPreviousDay = () => setSelectedDate(prev => subDays(prev, 1));
    const goToNextDay = () => setSelectedDate(prev => addDays(prev, 1));
    const goToToday = () => setSelectedDate(new Date());

    // Selection
    const toggleStaffSelection = (staffId: number) => {
        const newSelected = new Set(selectedStaff);
        if (newSelected.has(staffId)) {
            newSelected.delete(staffId);
        } else {
            newSelected.add(staffId);
        }
        setSelectedStaff(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedStaff.size === filteredData.length) {
            setSelectedStaff(new Set());
        } else {
            setSelectedStaff(new Set(filteredData.map(s => s.staff_id)));
        }
    };

    // Bulk apply times
    const handleBulkApply = async (type: 'in' | 'out' | 'both') => {
        if (selectedStaff.size === 0) {
            toast({ title: 'No staff selected', variant: 'destructive' });
            return;
        }

        const timeIn = bulkClockIn;
        const timeOut = bulkClockOut;

        if (type === 'in' && !timeIn) {
            toast({ title: 'Enter clock in time', variant: 'destructive' });
            return;
        }
        if (type === 'out' && !timeOut) {
            toast({ title: 'Enter clock out time', variant: 'destructive' });
            return;
        }
        if (type === 'both' && (!timeIn || !timeOut)) {
            toast({ title: 'Enter both times', variant: 'destructive' });
            return;
        }

        setIsProcessing(true);
        try {
            const selectedIds = Array.from(selectedStaff);
            const BATCH_SIZE = 5; // To prevent overwhelming the server/browser

            for (let i = 0; i < selectedIds.length; i += BATCH_SIZE) {
                const batch = selectedIds.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (staffId) => {
                    if (type === 'in' || type === 'both') {
                        // Delete existing clock in
                        await supabase
                            .from('time_clock_events')
                            .delete()
                            .eq('staff_id', staffId)
                            .eq('event_type', 'clock_in')
                            .gte('event_time', `${dateStr}T00:00:00`)
                            .lte('event_time', `${dateStr}T23:59:59`);

                        await addManualClockEvent(staffId, 'clock_in', dateStr, timeIn, null, 'Bulk Quick Entry');
                    }

                    if (type === 'out' || type === 'both') {
                        // Delete existing clock out
                        await supabase
                            .from('time_clock_events')
                            .delete()
                            .eq('staff_id', staffId)
                            .eq('event_type', 'clock_out')
                            .gte('event_time', `${dateStr}T00:00:00`)
                            .lte('event_time', `${dateStr}T23:59:59`);

                        await addManualClockEvent(staffId, 'clock_out', dateStr, timeOut, null, 'Bulk Quick Entry');
                    }

                    await processClockEventsIntoSegments(dateStr, staffId);
                }));
            }

            await refetchEvents();
            setSelectedStaff(new Set());
            toast({ title: 'Times applied', description: `Updated ${selectedStaff.size} staff members` });

        } catch (error: any) {
            console.error('Error applying bulk times:', error);
            toast({ title: 'Error', description: 'Failed to apply times', variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    // Clear times for a staff member
    const handleClear = async (staffId: number) => {
        setIsProcessing(true);
        try {
            const { error } = await supabase
                .from('time_clock_events')
                .delete()
                .eq('staff_id', staffId)
                .gte('event_time', `${dateStr}T00:00:00`)
                .lte('event_time', `${dateStr}T23:59:59`);

            if (error) throw error;

            await processClockEventsIntoSegments(dateStr, staffId);
            await refetchEvents();

            toast({ title: 'Times cleared', description: 'Deleted all events for this day' });
        } catch (error: any) {
            console.error('Error clearing times:', error);
            toast({ title: 'Error', description: 'Failed to clear times', variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    // Individual edit
    const startEditing = (staff: StaffRow) => {
        setEditingStaffId(staff.staff_id);
        setEditClockIn(staff.clockIn || '');
        setEditClockOut(staff.clockOut || '');
    };

    const saveEdit = async () => {
        if (!editingStaffId) return;

        setIsProcessing(true);
        try {
            // Delete existing events
            await supabase
                .from('time_clock_events')
                .delete()
                .eq('staff_id', editingStaffId)
                .gte('event_time', `${dateStr}T00:00:00`)
                .lte('event_time', `${dateStr}T23:59:59`);

            if (editClockIn) {
                await addManualClockEvent(editingStaffId, 'clock_in', dateStr, editClockIn, null, 'Quick Entry');
            }
            if (editClockOut) {
                await addManualClockEvent(editingStaffId, 'clock_out', dateStr, editClockOut, null, 'Quick Entry');
            }

            await processClockEventsIntoSegments(dateStr, editingStaffId);
            await refetchEvents();

            setEditingStaffId(null);
            toast({ title: 'Times saved' });

        } catch (error: any) {
            console.error('Error saving times:', error);
            toast({ title: 'Error', description: 'Failed to save times', variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    const cancelEdit = () => {
        setEditingStaffId(null);
    };

    // Stats
    const stats = useMemo(() => {
        const total = staffData.length;
        const clockedIn = staffData.filter(s => s.clockIn).length;
        const clockedOut = staffData.filter(s => s.clockOut).length;
        const incomplete = staffData.filter(s => !s.clockIn || !s.clockOut).length;
        return { total, clockedIn, clockedOut, incomplete };
    }, [staffData]);

    if (isLoadingStaff || isLoadingEvents) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Loading...</p>
            </div>
        );
    }

    const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Quick Entry
                        </CardTitle>
                        <CardDescription>
                            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                            {isToday && <Badge variant="secondary" className="ml-2">Today</Badge>}
                        </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button variant="outline" size="icon" onClick={goToPreviousDay}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" onClick={goToToday}>Today</Button>
                        <Button variant="outline" size="icon" onClick={goToNextDay}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => refetchEvents()}>
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Stats */}
                <div className="flex gap-2 mt-4">
                    <Badge variant="outline" className="cursor-pointer" onClick={() => setStatusFilter('all')}>
                        All: {stats.total}
                    </Badge>
                    <Badge variant="default" className="cursor-pointer bg-green-600" onClick={() => setStatusFilter('all')}>
                        Clocked In: {stats.clockedIn}
                    </Badge>
                    <Badge variant="default" className="cursor-pointer bg-red-600" onClick={() => setStatusFilter('not_clocked_in')}>
                        Not Clocked In: {stats.total - stats.clockedIn}
                    </Badge>
                    <Badge variant="default" className="cursor-pointer bg-orange-500" onClick={() => setStatusFilter('not_clocked_out')}>
                        Not Clocked Out: {stats.clockedIn - stats.clockedOut}
                    </Badge>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-4 mt-4">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter by name or job..."
                            value={filterText}
                            onChange={(e) => setFilterText(e.target.value)}
                            className="pl-8"
                        />
                        {filterText && (
                            <Button variant="ghost" size="sm" className="absolute right-1 top-1 h-6 w-6 p-0" onClick={() => setFilterText('')}>
                                <X className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant={statusFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('all')}>All</Button>
                        <Button variant={statusFilter === 'not_clocked_in' ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('not_clocked_in')}>Not In</Button>
                        <Button variant={statusFilter === 'not_clocked_out' ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('not_clocked_out')}>Not Out</Button>
                        <Button variant={statusFilter === 'incomplete' ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter('incomplete')}>Incomplete</Button>
                    </div>
                </div>

                {/* Bulk Entry */}
                {selectedStaff.size > 0 && (
                    <div className="flex items-center gap-4 mt-4 p-4 bg-muted rounded-lg">
                        <span className="font-medium">{selectedStaff.size} selected</span>
                        <div className="flex items-center gap-2">
                            <Input
                                type="time"
                                className="w-28"
                                value={bulkClockIn}
                                onChange={(e) => setBulkClockIn(e.target.value)}
                                placeholder="Clock In"
                            />
                            <Button size="sm" onClick={() => handleBulkApply('in')} disabled={isProcessing}>
                                <LogIn className="h-4 w-4 mr-1" /> Apply In
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <Input
                                type="time"
                                className="w-28"
                                value={bulkClockOut}
                                onChange={(e) => setBulkClockOut(e.target.value)}
                                placeholder="Clock Out"
                            />
                            <Button size="sm" onClick={() => handleBulkApply('out')} disabled={isProcessing}>
                                <LogOut className="h-4 w-4 mr-1" /> Apply Out
                            </Button>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => handleBulkApply('both')} disabled={isProcessing || !bulkClockIn || !bulkClockOut}>
                            Apply Both
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedStaff(new Set())}>
                            Clear Selection
                        </Button>
                    </div>
                )}
            </CardHeader>

            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">
                                    <Checkbox
                                        checked={selectedStaff.size === filteredData.length && filteredData.length > 0}
                                        onCheckedChange={toggleSelectAll}
                                    />
                                </TableHead>
                                <TableHead className="w-[200px]">Staff</TableHead>
                                <TableHead className="w-[150px]">Job</TableHead>
                                <TableHead className="w-[120px] text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        <LogIn className="h-4 w-4 text-green-600" /> Clock In
                                    </div>
                                </TableHead>
                                <TableHead className="w-[120px] text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        <LogOut className="h-4 w-4 text-red-600" /> Clock Out
                                    </div>
                                </TableHead>
                                <TableHead className="w-[100px] text-center">Hours</TableHead>
                                <TableHead className="w-[140px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredData.map((row) => {
                                const isEditing = editingStaffId === row.staff_id;
                                const isSelected = selectedStaff.has(row.staff_id);

                                return (
                                    <TableRow key={row.staff_id} className={isSelected ? 'bg-muted/50' : ''}>
                                        <TableCell>
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => toggleStaffSelection(row.staff_id)}
                                            />
                                        </TableCell>
                                        <TableCell className="font-medium">{row.staff_name}</TableCell>
                                        <TableCell className="text-muted-foreground">{row.job_description || 'N/A'}</TableCell>
                                        <TableCell className="text-center">
                                            {isEditing ? (
                                                <Input
                                                    type="time"
                                                    className="w-24 mx-auto"
                                                    value={editClockIn}
                                                    onChange={(e) => setEditClockIn(e.target.value)}
                                                />
                                            ) : (
                                                <span className={row.clockIn ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
                                                    {row.clockIn || '-'}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {isEditing ? (
                                                <Input
                                                    type="time"
                                                    className="w-24 mx-auto"
                                                    value={editClockOut}
                                                    onChange={(e) => setEditClockOut(e.target.value)}
                                                />
                                            ) : (
                                                <span className={row.clockOut ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                                                    {row.clockOut || '-'}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center font-medium">
                                            {row.totalHours > 0 ? `${row.totalHours}h` : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {isEditing ? (
                                                <div className="flex gap-1">
                                                    <Button size="sm" variant="default" onClick={saveEdit} disabled={isProcessing}>
                                                        Save
                                                    </Button>
                                                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                                        ✕
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1">
                                                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => startEditing(row)}>
                                                        Edit
                                                    </Button>
                                                    {(row.clockIn || row.clockOut) && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                                            onClick={() => handleClear(row.staff_id)}
                                                            disabled={isProcessing}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
