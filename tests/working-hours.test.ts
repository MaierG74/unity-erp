/**
 * Working Hours Calculation Tests
 *
 * Tests for calculateWorkingMinutes which computes net working minutes
 * between two timestamps, accounting for schedules, breaks, pauses, and overrides.
 *
 * Run with: npx tsx --test tests/working-hours.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const importModule = async () => {
  const mod = await import('../lib/working-hours.js');
  return mod;
};

interface DaySchedule {
  dayGroup: string;
  startMinutes: number;
  endMinutes: number;
  breaks: { label: string; startMinutes: number; endMinutes: number }[];
  isActive: boolean;
}

interface PauseEvent {
  pausedAt: Date;
  resumedAt: Date | null;
}

interface ShiftOverride {
  overrideDate: string;
  extendedEndMinutes: number;
}

// Standard Mon-Fri schedule: 7:00-17:00 with 30min lunch at 12:00, Friday 7:00-14:00
const STANDARD_SCHEDULES: DaySchedule[] = [
  { dayGroup: 'mon-thu', startMinutes: 420, endMinutes: 1020, breaks: [{ label: 'Lunch', startMinutes: 720, endMinutes: 750 }], isActive: true },
  { dayGroup: 'fri', startMinutes: 420, endMinutes: 840, breaks: [{ label: 'Lunch', startMinutes: 720, endMinutes: 750 }], isActive: true },
  { dayGroup: 'sat-sun', startMinutes: 420, endMinutes: 720, breaks: [], isActive: false },
];

test('same-day job: 8:00-12:00 Mon = 4h = 240 min (no breaks hit)', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'), // Monday
    new Date('2026-03-02T12:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 240);
  assert.equal(result.workingDays, 1);
  assert.equal(result.pauseMinutes, 0);
});

test('same-day job spanning lunch: 8:00-14:00 Mon = 5h30m = 330 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'),
    new Date('2026-03-02T14:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 330);
  assert.equal(result.workingDays, 1);
});

test('full working day Mon = 570 min (10h - 30min lunch)', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T07:00:00'),
    new Date('2026-03-02T17:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 570);
});

test('Friday-to-Monday: Fri 12:00 to Mon 12:30', async () => {
  const { calculateWorkingMinutes } = await importModule();
  // Fri schedule: 7:00-14:00 (840 min), lunch 12:00-12:30
  // Fri work: 12:00-14:00 = 120 min, minus lunch 12:00-12:30 overlap = 90 min
  // Sat: inactive = 0
  // Sun: inactive = 0
  // Mon schedule: 7:00-17:00, lunch 12:00-12:30
  // Mon work: 7:00-12:30 = 330 min, minus lunch 12:00-12:30 overlap = 300 min
  // Total: 90 + 300 = 390
  const result = calculateWorkingMinutes(
    new Date('2026-02-27T12:00:00'), // Friday
    new Date('2026-03-02T12:30:00'), // Monday
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 390);
  assert.equal(result.workingDays, 2);
});

test('start before shift clamps to shift start', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T05:00:00'),
    new Date('2026-03-02T09:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 120);
});

test('end after shift clamps to shift end', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T15:00:00'),
    new Date('2026-03-02T19:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 120);
});

test('job entirely outside working hours = 0 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T18:00:00'),
    new Date('2026-03-02T20:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.workingDays, 0);
});

test('weekend-only span = 0 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-02-28T08:00:00'), // Saturday
    new Date('2026-03-01T16:00:00'), // Sunday
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.workingDays, 0);
});

test('pause deducted from working hours', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const pauses = [
    { pausedAt: new Date('2026-03-02T09:00:00'), resumedAt: new Date('2026-03-02T10:00:00') },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'),
    new Date('2026-03-02T12:00:00'),
    STANDARD_SCHEDULES, pauses, [],
  );
  assert.equal(result.totalMinutes, 180);
  assert.equal(result.pauseMinutes, 60);
});

test('pause spanning non-working hours only counts working overlap', async () => {
  const { calculateWorkingMinutes } = await importModule();
  // Pause from Fri 13:00 to Mon 8:00
  const pauses = [
    { pausedAt: new Date('2026-02-27T13:00:00'), resumedAt: new Date('2026-03-02T08:00:00') },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-02-27T12:00:00'), // Fri 12:00
    new Date('2026-03-02T12:00:00'), // Mon 12:00
    STANDARD_SCHEDULES, pauses, [],
  );
  // Without pause: Fri 90 + Mon 300 = 390
  // Pause eats: Fri 13:00-14:00 = 60, Mon 7:00-8:00 = 60 → total pause = 120
  // Net: 390 - 120 = 270
  assert.equal(result.totalMinutes, 270);
  assert.equal(result.pauseMinutes, 120);
});

test('shift override extends end time', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const overrides = [
    { overrideDate: '2026-03-02', extendedEndMinutes: 1140 },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T16:00:00'),
    new Date('2026-03-02T19:00:00'),
    STANDARD_SCHEDULES, [], overrides,
  );
  assert.equal(result.totalMinutes, 180);
});

test('multi-day: Mon-Wed full days = 3 × 570 = 1710 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T07:00:00'),
    new Date('2026-03-04T17:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 1710);
  assert.equal(result.workingDays, 3);
});

test('active weekends are counted', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const schedules = [
    ...STANDARD_SCHEDULES.filter(s => s.dayGroup !== 'sat-sun'),
    { dayGroup: 'sat-sun', startMinutes: 420, endMinutes: 720, breaks: [], isActive: true },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-02-28T07:00:00'),
    new Date('2026-02-28T12:00:00'),
    schedules, [], [],
  );
  assert.equal(result.totalMinutes, 300);
  assert.equal(result.workingDays, 1);
});

test('open pause (no resumedAt) treated as paused until end', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const pauses = [
    { pausedAt: new Date('2026-03-02T10:00:00'), resumedAt: null },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'),
    new Date('2026-03-02T12:00:00'),
    STANDARD_SCHEDULES, pauses, [],
  );
  assert.equal(result.totalMinutes, 120);
  assert.equal(result.pauseMinutes, 120);
});
