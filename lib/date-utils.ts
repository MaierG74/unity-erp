/**
 * Date formatting utilities for Unity ERP
 *
 * South African locale conventions:
 * - Date format: dd/MM/yyyy (e.g., 07/10/2025)
 * - Date with time: dd/MM/yyyy HH:mm (e.g., 07/10/2025 14:30)
 * - Use relative times for recent activity (e.g., "2 hours ago")
 */

import { format as dateFnsFormat, formatDistanceToNow, parseISO } from 'date-fns';

/**
 * Format a date string or Date object to South African date format (dd/MM/yyyy)
 * @param date - ISO string, Date object, or timestamp
 * @returns Formatted date string (e.g., "07/10/2025")
 */
export function formatDate(date: string | Date | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    return dateFnsFormat(dateObj, 'dd/MM/yyyy');
  } catch {
    return String(date);
  }
}

/**
 * Format a date with time to South African format (dd/MM/yyyy HH:mm)
 * @param date - ISO string, Date object, or timestamp
 * @returns Formatted date-time string (e.g., "07/10/2025 14:30")
 */
export function formatDateTime(date: string | Date | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    return dateFnsFormat(dateObj, 'dd/MM/yyyy HH:mm');
  } catch {
    return String(date);
  }
}

/**
 * Format a date with time including seconds (dd/MM/yyyy HH:mm:ss)
 * @param date - ISO string, Date object, or timestamp
 * @returns Formatted date-time string (e.g., "07/10/2025 14:30:45")
 */
export function formatDateTimeWithSeconds(date: string | Date | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    return dateFnsFormat(dateObj, 'dd/MM/yyyy HH:mm:ss');
  } catch {
    return String(date);
  }
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "in 3 days")
 * Use this for activity feeds and recent updates
 * @param date - ISO string, Date object, or timestamp
 * @returns Relative time string
 */
export function formatRelativeTime(date: string | Date | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    return formatDistanceToNow(dateObj, { addSuffix: true });
  } catch {
    return String(date);
  }
}

/**
 * Format date for use in date inputs (yyyy-MM-dd)
 * @param date - ISO string, Date object, or timestamp
 * @returns ISO date string for input fields
 */
export function formatInputDate(date: string | Date | number): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date);
    return dateFnsFormat(dateObj, 'yyyy-MM-dd');
  } catch {
    return '';
  }
}
