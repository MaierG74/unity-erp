'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClockEvent, Staff } from '@/lib/types/attendance';

export type MassAction = 'clock_in' | 'clock_out';

interface MassClockActionDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  staff: Pick<Staff, 'staff_id' | 'first_name' | 'last_name'>[];
  clockEvents: ClockEvent[];
  onApply: (params: {
    action: MassAction;
    time: string; // HH:mm (24h)
    staffIds: number[];
    force?: boolean;
    note?: string;
  }) => Promise<void>;
}

type StatusKind = 'in' | 'out' | 'on_break' | 'missing_out';

function hhmmNowSAST(): string {
  try {
    // Render current time in SAST
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-ZA', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Johannesburg',
    });
    // "07:03:00" or "07:03" depending on browser; normalize to HH:mm
    const [h, m] = hhmm.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    // Fallback
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

export function MassClockActionDialog({
  isOpen,
  onOpenChange,
  date,
  staff,
  clockEvents,
  onApply,
}: MassClockActionDialogProps) {
  const dateStr = useMemo(() => format(date, 'yyyy-MM-dd'), [date]);

  const [action, setAction] = useState<MassAction>('clock_in');
  const [time, setTime] = useState<string>(hhmmNowSAST());
  const [force, setForce] = useState<boolean>(false);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Derive per-staff status from this day's events
  const statusByStaff = useMemo(() => {
    const map = new Map<number, { status: StatusKind; last?: ClockEvent }>();
    for (const s of staff) {
      const events = clockEvents
        .filter((e) => e.staff_id === s.staff_id)
        .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
      if (events.length === 0) {
        map.set(s.staff_id, { status: 'out' });
        continue;
      }
      const last = events[events.length - 1];
      let status: StatusKind = 'out';
      switch (last.event_type) {
        case 'clock_in':
          status = 'missing_out';
          break;
        case 'clock_out':
          status = 'out';
          break;
        case 'break_start':
          status = 'on_break';
          break;
        case 'break_end':
          status = 'in';
          break;
        default:
          status = 'out';
      }
      map.set(s.staff_id, { status, last });
    }
    return map;
  }, [staff, clockEvents]);

  const counts = useMemo(() => {
    const c = { in: 0, out: 0, on_break: 0, missing_out: 0 } as Record<StatusKind, number>;
    statusByStaff.forEach((v) => c[v.status]++);
    return c;
  }, [statusByStaff]);

  // Reset defaults when opening/closing or changing action
  useEffect(() => {
    if (!isOpen) return;
    // Default time: Now (SAST)
    setTime(hhmmNowSAST());
    setForce(false);
    setNote('');

    // Default selection heuristic depending on action
    const next = new Set<number>();
    statusByStaff.forEach((v, id) => {
      if (action === 'clock_in') {
        if (v.status === 'out') next.add(id);
      } else {
        if (v.status === 'in' || v.status === 'on_break' || v.status === 'missing_out') next.add(id);
      }
    });
    setSelected(next);
  }, [isOpen, action, statusByStaff]);

  const toggleId = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelected(new Set(staff.map((s) => s.staff_id)));
  const clearAll = () => setSelected(new Set());
  const selectByStatus = (k: StatusKind) => {
    const n = new Set<number>();
    statusByStaff.forEach((v, id) => {
      if (v.status === k) n.add(id);
    });
    setSelected(n);
  };

  const apply = async () => {
    if (selected.size === 0) return;
    // Skip conflicts unless force is enabled
    const filteredIds = Array.from(selected).filter((id) => {
      if (force) return true;
      const st = statusByStaff.get(id)?.status;
      if (action === 'clock_in') return st === 'out';
      if (action === 'clock_out') return st === 'in' || st === 'on_break' || st === 'missing_out';
      return true;
    });
    if (filteredIds.length === 0) return;
    setIsSubmitting(true);
    try {
      await onApply({ action, time, staffIds: filteredIds, force, note });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Mass Clock Action</DialogTitle>
          <DialogDescription>
            Apply a clock event to multiple staff for {format(date, 'EEEE, MMMM d, yyyy')}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Controls */}
          {/* Use 4 columns on md+ and give Time two columns to avoid crowding */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-sm text-muted-foreground">Action</label>
              <Select value={action} onValueChange={(v) => setAction(v as MassAction)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clock_in">Clock In</SelectItem>
                  <SelectItem value="clock_out">Clock Out</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 min-w-0">
              <label className="text-sm text-muted-foreground">Time (SAST)</label>
              <div className="flex gap-2 mt-1 flex-wrap">
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  step={60}
                />
                <Button variant="secondary" className="whitespace-nowrap" onClick={() => setTime('07:00')}>07:00</Button>
                <Button variant="secondary" className="whitespace-nowrap" onClick={() => setTime('17:00')}>17:00</Button>
                <Button variant="secondary" className="whitespace-nowrap" onClick={() => setTime(hhmmNowSAST())}>Now</Button>
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Options</label>
              <div className="flex items-center gap-2 mt-2">
                <Checkbox id="force" checked={force} onCheckedChange={(v) => setForce(Boolean(v))} />
                <label htmlFor="force" className="text-sm">Force even if status conflicts</label>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground">Note (optional)</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Mass check-in at site"
              className="mt-1"
            />
          </div>

          {/* Selection helpers */}
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>Status counts:</span>
            <span className="px-2 py-1 rounded bg-muted">In: {counts.in}</span>
            <span className="px-2 py-1 rounded bg-muted">On Break: {counts.on_break}</span>
            <span className="px-2 py-1 rounded bg-muted">Missing Out: {counts.missing_out}</span>
            <span className="px-2 py-1 rounded bg-muted">Out: {counts.out}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={selectAll}>Select all</Button>
            <Button variant="secondary" onClick={clearAll}>Clear</Button>
            <Button variant="secondary" onClick={() => selectByStatus('out')}>Select Out</Button>
            <Button variant="secondary" onClick={() => selectByStatus('in')}>Select In</Button>
            <Button variant="secondary" onClick={() => selectByStatus('missing_out')}>Select Missing clock-out</Button>
          </div>

          {/* Staff list */}
          <div className="max-h-[360px] overflow-auto border rounded-md divide-y">
            {staff.map((s) => {
              const info = statusByStaff.get(s.staff_id);
              const last = info?.last;
              const lastLabel = last ? `${last.event_type.replace('_', ' ')} ${new Date(last.event_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg' })}` : 'no events';
              const statusText =
                info?.status === 'in' ? 'In' :
                info?.status === 'on_break' ? 'On Break' :
                info?.status === 'missing_out' ? 'Missing clock-out' : 'Out';
              const statusColor =
                info?.status === 'in' ? 'bg-green-600' :
                info?.status === 'on_break' ? 'bg-yellow-600' :
                info?.status === 'missing_out' ? 'bg-yellow-700' : 'bg-gray-600';
              const checked = selected.has(s.staff_id);

              // Conflict rule: if action is clock_in and status is in/on_break/missing_out, warn; if clock_out and status is out, warn.
              const conflict = (action === 'clock_in' && (info?.status === 'in' || info?.status === 'on_break' || info?.status === 'missing_out')) ||
                               (action === 'clock_out' && info?.status === 'out');

              return (
                <div key={s.staff_id} className={`flex items-center justify-between p-3 ${conflict && !force ? 'opacity-70' : ''}`}>
                  <div className="flex items-center gap-3">
                    <Checkbox checked={checked} onCheckedChange={() => toggleId(s.staff_id)} />
                    <div>
                      <div className="font-medium">{s.first_name} {s.last_name}</div>
                      <div className="text-xs text-muted-foreground">{lastLabel}</div>
                    </div>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded ${statusColor} text-white`}>{statusText}</div>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="flex justify-between gap-2">
          <div className="text-sm text-muted-foreground">Selected: {selected.size}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={apply} disabled={isSubmitting || selected.size === 0}>
              {isSubmitting ? 'Applying...' : `Apply to ${selected.size} staff`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
