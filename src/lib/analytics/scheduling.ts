type SchedulingEventType =
  | 'drop_attempt'
  | 'drop_blocked'
  | 'assigned'
  | 'updated'
  | 'unassigned'
  | 'missing_staff'
  | 'mutation_failed';

export interface SchedulingEvent {
  type: SchedulingEventType;
  jobKey?: string;
  jobLabel?: string;
  staffId?: number | string | null;
  staffName?: string | null;
  date?: string;
  startMinutes?: number | null;
  endMinutes?: number | null;
  reason?: string;
  detail?: string;
}

type Listener = (event: SchedulingEvent & { at: string }) => void;

const listeners = new Set<Listener>();

export function logSchedulingEvent(event: SchedulingEvent) {
  const enriched = { ...event, at: new Date().toISOString() };

  if (typeof window !== 'undefined') {
    const history = (window as any).__laborSchedulingEvents;
    if (Array.isArray(history)) {
      history.push(enriched);
    } else {
      (window as any).__laborSchedulingEvents = [enriched];
    }
  }

  listeners.forEach((listener) => {
    try {
      listener(enriched);
    } catch {
      // Ignore listener errors to keep telemetry non-blocking.
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    // Surface events in the console to help troubleshoot scheduling actions locally.
    console.info('[labor-planning]', enriched);
  }
}

export function onSchedulingEvent(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
