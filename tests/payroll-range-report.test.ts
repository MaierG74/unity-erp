import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollRangeReport } from '../lib/payroll-range-report';

test('monthly payroll report rolls up each payroll week before totaling overtime', () => {
  const [row] = buildPayrollRangeReport({
    staff: [
      {
        staff_id: 87,
        first_name: 'Tolkin',
        last_name: 'Venter',
        hourly_rate: 0,
      },
    ],
    selectedStaffIds: [87],
    weekStartDay: 5,
    standardWeekHours: 44,
    segments: [
      {
        staff_id: 87,
        date_worked: '2026-05-04',
        start_time: '2026-05-04T05:00:00.000Z',
        end_time: '2026-05-04T15:05:00.000Z',
        segment_type: 'work',
        duration_minutes: 605,
        break_type: null,
      },
    ],
    summaries: [
      ['2026-05-04', 540, 65, 0],
      ['2026-05-05', 540, 115, 0],
      ['2026-05-06', 540, 45, 0],
      ['2026-05-07', 540, 50, 0],
      ['2026-05-08', 460, 0, 0],
      ['2026-05-11', 450, 0, 0],
      ['2026-05-12', 540, 50, 0],
      ['2026-05-13', 540, 65, 0],
      ['2026-05-14', 540, 40, 0],
      ['2026-05-15', 420, 0, 0],
      ['2026-05-18', 540, 60, 0],
      ['2026-05-19', 540, 50, 0],
      ['2026-05-20', 540, 65, 0],
      ['2026-05-21', 540, 30, 0],
      ['2026-05-22', 445, 0, 0],
      ['2026-05-23', 135, 0, 0],
      ['2026-05-25', 540, 60, 0],
      ['2026-05-26', 540, 110, 0],
      ['2026-05-27', 540, 160, 0],
      ['2026-05-28', 540, 55, 0],
    ].map(([date_worked, regular_minutes, ot_minutes, dt_minutes]) => ({
      staff_id: 87,
      date_worked: String(date_worked),
      regular_minutes: Number(regular_minutes),
      ot_minutes: Number(ot_minutes),
      dt_minutes: Number(dt_minutes),
    })),
  });

  assert.equal(row.total_hours, 183.83);
  assert.equal(row.regular_hours, 172.58);
  assert.equal(row.overtime_hours, 11.25);
  assert.equal(row.doubletime_hours, 0);
  assert.deepEqual(
    row.weeks.map((week) => ({
      week_start: week.week_start,
      total_hours: week.total_hours,
      regular_hours: week.regular_hours,
      overtime_hours: week.overtime_hours,
    })),
    [
      { week_start: '2026-05-01', total_hours: 40.58, regular_hours: 40.58, overtime_hours: 0 },
      { week_start: '2026-05-08', total_hours: 44.75, regular_hours: 44, overtime_hours: 0.75 },
      { week_start: '2026-05-15', total_hours: 46.42, regular_hours: 44, overtime_hours: 2.42 },
      { week_start: '2026-05-22', total_hours: 52.08, regular_hours: 44, overtime_hours: 8.08 },
    ],
  );
  assert.deepEqual(
    row.weeks[0].days.map((day) => ({
      day_label: day.day_label,
      total_hours: day.total_hours,
      regular_hours: day.regular_hours,
      overtime_hours: day.overtime_hours,
    })),
    [
      { day_label: 'Mon 4 May', total_hours: 10.08, regular_hours: 9, overtime_hours: 1.08 },
      { day_label: 'Tue 5 May', total_hours: 10.92, regular_hours: 9, overtime_hours: 1.92 },
      { day_label: 'Wed 6 May', total_hours: 9.75, regular_hours: 9, overtime_hours: 0.75 },
      { day_label: 'Thu 7 May', total_hours: 9.83, regular_hours: 9, overtime_hours: 0.83 },
    ],
  );
  assert.deepEqual(row.weeks[0].days[0].segments, [
    {
      start_time: '2026-05-04T05:00:00.000Z',
      end_time: '2026-05-04T15:05:00.000Z',
      segment_type: 'work',
      duration_minutes: 605,
      break_type: null,
    },
  ]);
});
