import type { DisplayUnit } from '../types/room';

const CONVERSIONS: Record<DisplayUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
};

export function mmToDisplay(mm: number, unit: DisplayUnit): number {
  return mm / CONVERSIONS[unit];
}

export function displayToMm(value: number, unit: DisplayUnit): number {
  return value * CONVERSIONS[unit];
}

export function formatDisplay(mm: number, unit: DisplayUnit): string {
  const value = mmToDisplay(mm, unit);
  switch (unit) {
    case 'mm':
      return Math.round(value).toString();
    case 'cm':
      return value.toFixed(1);
    case 'm':
      return value.toFixed(3);
  }
}
