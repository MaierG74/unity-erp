/**
 * Timezone utility functions for South African Standard Time (SAST)
 */

/**
 * Format timestamp to SAST time string (HH:mm)
 */
export const formatTimeToSAST = (timeString: string | null): string => {
  if (!timeString) return '--:--';
  
  const date = new Date(timeString);
  return date.toLocaleTimeString('en-ZA', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg'
  });
};

/**
 * Create ISO string with SAST timezone offset (+02:00)
 */
export const createSASTTimestamp = (dateStr: string, timeStr: string): string => {
  return `${dateStr}T${timeStr}:00+02:00`;
};

/**
 * Create date range boundaries for SAST day
 */
export const getSASTDayBoundaries = (dateStr: string) => {
  const startOfDay = new Date(`${dateStr}T00:00:00+02:00`).toISOString();
  const nextDay = new Date(`${dateStr}T00:00:00+02:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const startOfNextDay = nextDay.toISOString();
  
  return { startOfDay, startOfNextDay };
};

/**
 * Convert time input value to SAST time display format
 */
export const timeInputToSAST = (timeString: string): string => {
  if (!timeString) return '';
  
  // timeString comes in as "HH:mm" format from time input
  const [hours, minutes] = timeString.split(':');
  const date = new Date();
  date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  
  return date.toLocaleTimeString('en-ZA', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg'
  });
};