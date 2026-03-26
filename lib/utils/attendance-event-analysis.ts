type ClockInOutEvent = {
  id?: string | number | null;
  event_time: string;
  event_type: string;
};

type StaffClockInOutEvent = ClockInOutEvent & {
  staff_id: number;
};

export type ClockInOutAnalysis = {
  clockInCount: number;
  clockOutCount: number;
  hasMultipleClockIns: boolean;
  hasMultipleClockOuts: boolean;
  sessionCount: number;
  hasValidMultipleSessions: boolean;
  missingClockIn: boolean;
  missingClockOut: boolean;
  hasPotentialDuplicateClockIns: boolean;
  hasPotentialDuplicateClockOuts: boolean;
  hasPotentialDuplicates: boolean;
  hasAnyAnomaly: boolean;
  suspiciousClockInIds: string[];
  suspiciousClockOutIds: string[];
  flaggedEventIds: string[];
};

const CLOCK_EVENT_SORT_ORDER: Record<string, number> = {
  clock_in: 0,
  clock_out: 1,
};

const getEventIdentifier = (event: ClockInOutEvent, fallbackIndex: number) =>
  String(event.id ?? `${event.event_type}-${event.event_time}-${fallbackIndex}`);

const sortClockEvents = <T extends ClockInOutEvent>(events: T[]) =>
  [...events].sort((left, right) => {
    const timeDiff = new Date(left.event_time).getTime() - new Date(right.event_time).getTime();
    if (timeDiff !== 0) return timeDiff;

    return (CLOCK_EVENT_SORT_ORDER[left.event_type] ?? 99) - (CLOCK_EVENT_SORT_ORDER[right.event_type] ?? 99);
  });

const getDateStringInTimeZone = (eventTime: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(eventTime));

  const year = parts.find(part => part.type === 'year')?.value ?? '0000';
  const month = parts.find(part => part.type === 'month')?.value ?? '01';
  const day = parts.find(part => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
};

export const analyzeClockInOutEvents = <T extends ClockInOutEvent>(events: T[]): ClockInOutAnalysis => {
  const clockEvents = sortClockEvents(
    events.filter(event => event.event_type === 'clock_in' || event.event_type === 'clock_out')
  );

  const clockInCount = clockEvents.filter(event => event.event_type === 'clock_in').length;
  const clockOutCount = clockEvents.filter(event => event.event_type === 'clock_out').length;

  const suspiciousClockInIds: string[] = [];
  const suspiciousClockOutIds: string[] = [];

  let sessionCount = 0;
  let openClockIn: T | null = null;

  clockEvents.forEach((event, index) => {
    if (event.event_type === 'clock_in') {
      if (openClockIn) {
        suspiciousClockInIds.push(getEventIdentifier(event, index));
        return;
      }

      openClockIn = event;
      return;
    }

    if (!openClockIn || new Date(event.event_time).getTime() <= new Date(openClockIn.event_time).getTime()) {
      suspiciousClockOutIds.push(getEventIdentifier(event, index));
      return;
    }

    sessionCount += 1;
    openClockIn = null;
  });

  const missingClockOut = !!openClockIn;
  const missingClockIn = suspiciousClockOutIds.length > 0;
  const hasPotentialDuplicateClockIns = suspiciousClockInIds.length > 0;
  const hasPotentialDuplicateClockOuts = suspiciousClockOutIds.length > 0;
  const hasPotentialDuplicates = hasPotentialDuplicateClockIns || hasPotentialDuplicateClockOuts;
  const hasValidMultipleSessions = sessionCount > 1 && !hasPotentialDuplicates && !missingClockIn && !missingClockOut;

  return {
    clockInCount,
    clockOutCount,
    hasMultipleClockIns: clockInCount > 1,
    hasMultipleClockOuts: clockOutCount > 1,
    sessionCount,
    hasValidMultipleSessions,
    missingClockIn,
    missingClockOut,
    hasPotentialDuplicateClockIns,
    hasPotentialDuplicateClockOuts,
    hasPotentialDuplicates,
    hasAnyAnomaly: hasPotentialDuplicates || missingClockIn || missingClockOut,
    suspiciousClockInIds,
    suspiciousClockOutIds,
    flaggedEventIds: [...suspiciousClockInIds, ...suspiciousClockOutIds],
  };
};

export const buildDailyClockAnalysisMap = <T extends StaffClockInOutEvent>(
  events: T[],
  timeZone = 'Africa/Johannesburg'
): Record<string, ClockInOutAnalysis> => {
  const groupedEvents: Record<string, T[]> = {};

  events.forEach(event => {
    if (event.event_type !== 'clock_in' && event.event_type !== 'clock_out') {
      return;
    }

    const dateStr = getDateStringInTimeZone(event.event_time, timeZone);
    const key = `${event.staff_id}_${dateStr}`;

    if (!groupedEvents[key]) {
      groupedEvents[key] = [];
    }

    groupedEvents[key].push(event);
  });

  return Object.fromEntries(
    Object.entries(groupedEvents).map(([key, grouped]) => [key, analyzeClockInOutEvents(grouped)])
  );
};
