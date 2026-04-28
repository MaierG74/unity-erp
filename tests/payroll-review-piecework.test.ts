import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayrollRows, recalcRowWithOverride, type PayrollRow } from '../lib/payroll-calc';

const staff = [
  {
    staff_id: 10,
    first_name: 'Mixed',
    last_name: 'Worker',
    job_description: 'Assembly',
    hourly_rate: 100,
  },
];

const settings = {
  standardWeekHours: 44,
  otThresholdMinutes: 60,
};

function getSingleRow(piecework: Parameters<typeof calculatePayrollRows>[2], hours: Parameters<typeof calculatePayrollRows>[1] = []): PayrollRow {
  const rows = calculatePayrollRows(staff, hours, piecework, [], [], settings);
  assert.equal(rows.length, 1);
  return rows[0];
}

test('mixed legacy null-activity and cut/edge activity rows keep the legacy piecework total unchanged', () => {
  const legacyOnly = getSingleRow([
    { staff_id: 10, earned_amount: '125.50' },
    { staff_id: 10, earned_amount: 74.5, piecework_activity_id: null, piecework_activity_label: null },
  ]);

  const mixed = getSingleRow([
    { staff_id: 10, earned_amount: '125.50' },
    { staff_id: 10, earned_amount: 74.5, piecework_activity_id: null, piecework_activity_label: null },
    { staff_id: 10, earned_amount: 30, piecework_activity_id: 'cut', piecework_activity_label: 'Cut pieces' },
    { staff_id: 10, earned_amount: '20.25', piecework_activity_id: 'edge', piecework_activity_label: 'Edge bundles' },
  ]);

  const preFeatureTotal = 125.5 + 74.5 + 30 + 20.25;

  assert.equal(legacyOnly.pieceworkGross, 200);
  assert.equal(legacyOnly.pieceworkNet, 200);
  assert.deepEqual(legacyOnly.pieceworkBreakdown, []);
  assert.equal(mixed.pieceworkGross, preFeatureTotal);
  assert.equal(mixed.pieceworkNet, preFeatureTotal);
  assert.deepEqual(mixed.pieceworkBreakdown, [
    { activityId: 'cut', label: 'Cut pieces', gross: 30 },
    { activityId: 'edge', label: 'Edge bundles', gross: 20.25 },
  ]);
});

test('legacy payroll final pay formula remains max(hourlyTotal, pieceworkNet)', () => {
  const row = getSingleRow(
    [{ staff_id: 10, earned_amount: 75, piecework_activity_id: null }],
    [
      {
        staff_id: 10,
        date_worked: '2026-04-20',
        regular_minutes: 120,
        ot_minutes: 0,
        dt_minutes: 0,
      },
    ],
  );

  assert.equal(row.hourlyTotal, 200);
  assert.equal(row.pieceworkNet, 75);
  assert.equal(row.finalPay, 200);

  const recalculated = recalcRowWithOverride(row, false);
  assert.equal(recalculated.finalPay, Math.max(recalculated.hourlyTotal, recalculated.pieceworkNet));
});
