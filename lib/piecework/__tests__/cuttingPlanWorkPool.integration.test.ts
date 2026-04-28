import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { NextRequest } from 'next/server';

import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';

const RUN_LABEL = `TEST-POL-68-${Date.now()}`;
const MATERIAL_LABELS = {
  plain: `${RUN_LABEL}-plain`,
  full: `${RUN_LABEL}-full-banding`,
  mixed: `${RUN_LABEL}-mixed-banding`,
};
const VIEW_SHAPE_SELECT =
  'pool_id, piecework_activity_id, material_color_label, expected_count, required_qty, issued_qty, status';

type ActivityRow = {
  id: string;
  code: string;
  label: string;
  default_rate: number | string | null;
  target_role_id: number | null;
};

type Fixture = {
  orgId: string;
  emptyOrgId: string;
  orderId: number;
  emptyOrgOrderId: number;
  activities: ActivityRow[];
  jobCardIds: number[];
  userIds: string[];
  accessTokenByOrgId: Map<string, string>;
};

let supabase: SupabaseClient;
let fixture: Fixture | null = null;
let putCuttingPlan: ((request: NextRequest, context: { params: Promise<{ orderId: string }> }) => Promise<Response>) | null = null;

function loadEnv() {
  for (const path of [
    process.env.UNITY_ERP_ENV_FILE,
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
  ]) {
    if (path && existsSync(path)) {
      dotenv.config({ path });
      return;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  assert.ok(value, `Missing ${name}; run this integration test with the Supabase test DB env loaded.`);
  return value;
}

function assertDb<T>(
  result: { data: T; error: { code?: string; message?: string } | null },
  context: string,
): NonNullable<T> {
  if (result.error) {
    const detail = `${result.error.code ?? 'unknown'} ${result.error.message ?? ''}`.trim();
    assert.fail(`${context} failed (${detail}). Did the POL-60/POL-62 migrations apply to this database?`);
  }
  return result.data as NonNullable<T>;
}

function placement(partId: string, bandEdges: { top: boolean; right: boolean; bottom: boolean; left: boolean }) {
  return {
    part_id: partId,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rot: 0 as const,
    band_edges: bandEdges,
    lamination_type: 'none' as const,
  };
}

function plan(groupParts: Array<{ label: string; placements: ReturnType<typeof placement>[] }>): CuttingPlan {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    optimization_quality: 'balanced',
    stale: false,
    source_revision: computeSourceRevision([], null),
    total_nested_cost: 0,
    line_allocations: [],
    component_overrides: [],
    material_groups: groupParts.map((group, index) => ({
      board_type: '16mm',
      primary_material_id: null,
      primary_material_name: group.label,
      backer_material_id: null,
      backer_material_name: null,
      sheets_required: 1,
      backer_sheets_required: 0,
      edging_by_material: [],
      total_parts: group.placements.length,
      waste_percent: 0,
      bom_estimate_sheets: 1,
      bom_estimate_backer_sheets: 0,
      stock_sheet_spec: { length_mm: 2750, width_mm: 1830 },
      layouts: [{ sheet_id: `${RUN_LABEL}-${index}`, placements: group.placements }],
    })),
  };
}

function threeBatchPlan(extraPlainPart = false): CuttingPlan {
  return plan([
    {
      label: MATERIAL_LABELS.plain,
      placements: [
        placement('plain-a', { top: false, right: false, bottom: false, left: false }),
        ...(extraPlainPart ? [placement('plain-b', { top: false, right: false, bottom: false, left: false })] : []),
      ],
    },
    {
      label: MATERIAL_LABELS.full,
      placements: [placement('full-a', { top: true, right: true, bottom: true, left: true })],
    },
    {
      label: MATERIAL_LABELS.mixed,
      placements: [
        placement('mixed-a', { top: true, right: false, bottom: false, left: false }),
        placement('mixed-b', { top: false, right: false, bottom: false, left: false }),
      ],
    },
  ]);
}

async function finalizeViaRoute(orderId: number, orgId: string, cuttingPlan: CuttingPlan) {
  assert.ok(putCuttingPlan, 'cutting-plan route handler was not loaded');
  assert.ok(fixture, 'fixture is not initialized');
  const accessToken = fixture.accessTokenByOrgId.get(orgId);
  assert.ok(accessToken, `missing test access token for org ${orgId}`);

  const request = new NextRequest(`http://localhost/api/orders/${orderId}/cutting-plan`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuttingPlan),
  });
  const response = await putCuttingPlan(request, { params: Promise.resolve({ orderId: String(orderId) }) });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `route finalize failed with ${response.status}: ${JSON.stringify(body)}`);
}

async function workPoolRows(orderId: number, orgId: string) {
  return assertDb(
    await supabase
      .from('job_work_pool_status')
      .select(`${VIEW_SHAPE_SELECT}, piece_rate`)
      .eq('org_id', orgId)
      .eq('order_id', orderId)
      .eq('source', 'cutting_plan')
      .eq('cutting_plan_run_id', orderId)
      .order('material_color_label')
      .order('piecework_activity_id'),
    'select cutting-plan work-pool rows',
  );
}

function rowSummary(rows: any[]) {
  return rows
    .map((row) => ({
      label: row.material_color_label,
      expected_count: row.expected_count,
      required_qty: row.required_qty,
      piece_rate: Number(row.piece_rate),
      issued_qty: Number(row.issued_qty),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.piece_rate - b.piece_rate);
}

async function cleanupFixture() {
  if (!fixture) return;

  const poolRows = assertDb(
    await supabase
      .from('job_work_pool')
      .select('pool_id')
      .in('order_id', [fixture.orderId, fixture.emptyOrgOrderId])
      .eq('source', 'cutting_plan'),
    'load fixture work-pool ids for cleanup',
  );
  const poolIds = (poolRows ?? []).map((row: { pool_id: number }) => row.pool_id);

  if (poolIds.length > 0) {
    assertDb(await supabase.from('job_work_pool_exceptions').delete().in('work_pool_id', poolIds), 'cleanup exceptions');
    assertDb(await supabase.from('job_card_items').delete().in('work_pool_id', poolIds), 'cleanup job-card items');
    assertDb(await supabase.from('job_work_pool').delete().in('pool_id', poolIds), 'cleanup work-pool rows');
  }

  if (fixture.jobCardIds.length > 0) {
    assertDb(await supabase.from('job_cards').delete().in('job_card_id', fixture.jobCardIds), 'cleanup job cards');
    fixture.jobCardIds = [];
  }

  if (fixture.userIds.length > 0) {
    assertDb(await supabase.from('organization_members').delete().in('user_id', fixture.userIds), 'cleanup organization members');
  }
  assertDb(
    await supabase
      .from('organization_module_entitlements')
      .delete()
      .in('org_id', [fixture.orgId, fixture.emptyOrgId])
      .eq('module_key', 'orders_fulfillment'),
    'cleanup module entitlements',
  );
  assertDb(await supabase.from('piecework_activities').delete().eq('org_id', fixture.orgId), 'cleanup activities');
  assertDb(await supabase.from('orders').delete().in('order_id', [fixture.orderId, fixture.emptyOrgOrderId]), 'cleanup orders');
  assertDb(await supabase.from('organizations').delete().in('id', [fixture.orgId, fixture.emptyOrgId]), 'cleanup organizations');
  for (const userId of fixture.userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) assert.fail(`cleanup auth user ${userId} failed: ${error.message}`);
  }
  fixture = null;
}

before(async () => {
  loadEnv();
  supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonClient = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  putCuttingPlan = (await import('@/app/api/orders/[orderId]/cutting-plan/route')).PUT;

  const org = assertDb(
    await supabase.from('organizations').insert({ name: `${RUN_LABEL}-org` }).select('id').single(),
    'create fixture org',
  );
  const emptyOrg = assertDb(
    await supabase.from('organizations').insert({ name: `${RUN_LABEL}-empty-org` }).select('id').single(),
    'create empty fixture org',
  );
  const order = assertDb(
    await supabase
      .from('orders')
      .insert({ org_id: org.id, order_number: RUN_LABEL, total_amount: 0 })
      .select('order_id')
      .single(),
    'create fixture order',
  );
  const emptyOrgOrder = assertDb(
    await supabase
      .from('orders')
      .insert({ org_id: emptyOrg.id, order_number: `${RUN_LABEL}-empty`, total_amount: 0 })
      .select('order_id')
      .single(),
    'create empty-org fixture order',
  );
  const activities = assertDb(
    await supabase
      .from('piecework_activities')
      .insert([
        { org_id: org.id, code: 'cut_pieces', label: `${RUN_LABEL} Cutting`, default_rate: 6.5, unit_label: 'piece' },
        { org_id: org.id, code: 'edge_bundles', label: `${RUN_LABEL} Edging`, default_rate: 4, unit_label: 'bundle' },
      ])
      .select('id, code, label, default_rate, target_role_id'),
    'create fixture piecework activities',
  );
  assertDb(
    await supabase.from('organization_module_entitlements').insert([
      { org_id: org.id, module_key: 'orders_fulfillment', enabled: true, status: 'active', source: 'test' },
      { org_id: emptyOrg.id, module_key: 'orders_fulfillment', enabled: true, status: 'active', source: 'test' },
    ]),
    'create fixture module entitlements',
  );

  const password = `${RUN_LABEL}-Password-1!`;
  const userRows = await Promise.all(
    [org.id, emptyOrg.id].map(async (orgId, index) => {
      const email = `${RUN_LABEL.toLowerCase()}-${index}@example.test`;
      const createdUser = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { org_id: orgId },
      });
      if (createdUser.error || !createdUser.data.user) {
        assert.fail(`create auth user failed: ${createdUser.error?.message ?? 'missing user'}`);
      }
      assertDb(
        await supabase.from('organization_members').insert({
          user_id: createdUser.data.user.id,
          org_id: orgId,
          role: 'admin',
          is_active: true,
        }),
        'create fixture organization member',
      );
      const session = await anonClient.auth.signInWithPassword({ email, password });
      if (session.error || !session.data.session?.access_token) {
        assert.fail(`sign in fixture user failed: ${session.error?.message ?? 'missing access token'}`);
      }
      return { orgId, userId: createdUser.data.user.id, accessToken: session.data.session.access_token };
    }),
  );

  fixture = {
    orgId: org.id,
    emptyOrgId: emptyOrg.id,
    orderId: order.order_id,
    emptyOrgOrderId: emptyOrgOrder.order_id,
    activities,
    jobCardIds: [],
    userIds: userRows.map((row) => row.userId),
    accessTokenByOrgId: new Map(userRows.map((row) => [row.orgId, row.accessToken])),
  };
});

afterEach(cleanupFixture);
after(cleanupFixture);

test('cutting-plan finalize writes batch rows, remains idempotent, handles issued changes, gates empty orgs, and preserves status-view shape', async () => {
  assert.ok(fixture);

  // Three-batch fixture: unbanded rows create cutting only, while fully banded
  // and mixed batches create both cutting and edge-bundle rows with exact counts.
  await finalizeViaRoute(fixture.orderId, fixture.orgId, threeBatchPlan());

  const initialRows = await workPoolRows(fixture.orderId, fixture.orgId);
  assert.equal(initialRows.length, 5);
  assert.deepEqual(
    rowSummary(initialRows),
    [
      { label: `${MATERIAL_LABELS.full} / 16mm`, expected_count: 1, required_qty: 1, piece_rate: 4, issued_qty: 0 },
      { label: `${MATERIAL_LABELS.full} / 16mm`, expected_count: 1, required_qty: 1, piece_rate: 6.5, issued_qty: 0 },
      { label: `${MATERIAL_LABELS.mixed} / 16mm`, expected_count: 1, required_qty: 1, piece_rate: 4, issued_qty: 0 },
      { label: `${MATERIAL_LABELS.mixed} / 16mm`, expected_count: 2, required_qty: 2, piece_rate: 6.5, issued_qty: 0 },
      { label: `${MATERIAL_LABELS.plain} / 16mm`, expected_count: 1, required_qty: 1, piece_rate: 6.5, issued_qty: 0 },
    ],
  );

  // No-change re-finalize must be a database no-op: row count and updated_at stay unchanged.
  const beforeNoop = await workPoolRows(fixture.orderId, fixture.orgId);
  await finalizeViaRoute(fixture.orderId, fixture.orgId, threeBatchPlan());
  const afterNoop = await workPoolRows(fixture.orderId, fixture.orgId);
  assert.equal(afterNoop.length, beforeNoop.length);
  assert.deepEqual(
    afterNoop.map((row: any) => [row.pool_id, row.updated_at]),
    beforeNoop.map((row: any) => [row.pool_id, row.updated_at]),
  );

  // Part-change-on-unissued updates the matching active row in place.
  await finalizeViaRoute(fixture.orderId, fixture.orgId, threeBatchPlan(true));
  const afterUnissuedChange = await workPoolRows(fixture.orderId, fixture.orgId);
  const plainCut = afterUnissuedChange.find((row: any) => row.material_color_label === `${MATERIAL_LABELS.plain} / 16mm`);
  assert.ok(plainCut);
  assert.equal(plainCut.expected_count, 2);
  assert.equal(plainCut.required_qty, 2);
  assert.equal(plainCut.pool_id, beforeNoop.find((row: any) => row.material_color_label === `${MATERIAL_LABELS.plain} / 16mm`)?.pool_id);

  const issuedMixedCut = afterUnissuedChange.find(
    (row: any) => row.material_color_label === `${MATERIAL_LABELS.mixed} / 16mm` && Number(row.piece_rate) === 6.5,
  );
  assert.ok(issuedMixedCut);
  const jobCard = assertDb(
    await supabase
      .from('job_cards')
      .insert({ order_id: fixture.orderId, status: 'pending', material_color_label: MATERIAL_LABELS.mixed })
      .select('job_card_id')
      .single(),
    'create issued fixture job card',
  );
  fixture.jobCardIds.push(jobCard.job_card_id);
  assertDb(
    await supabase.from('job_card_items').insert({
      job_card_id: jobCard.job_card_id,
      quantity: 1,
      completed_quantity: 0,
      status: 'pending',
      work_pool_id: issuedMixedCut.pool_id,
    }),
    'create issued fixture job-card item',
  );

  const mixedChangedPlan = plan([
    {
      label: MATERIAL_LABELS.plain,
      placements: [
        placement('plain-a', { top: false, right: false, bottom: false, left: false }),
        placement('plain-b', { top: false, right: false, bottom: false, left: false }),
      ],
    },
    {
      label: MATERIAL_LABELS.full,
      placements: [placement('full-a', { top: true, right: true, bottom: true, left: true })],
    },
    {
      label: MATERIAL_LABELS.mixed,
      placements: [
        placement('mixed-a', { top: true, right: false, bottom: false, left: false }),
        placement('mixed-b', { top: false, right: false, bottom: false, left: false }),
        placement('mixed-c', { top: false, right: false, bottom: false, left: false }),
      ],
    },
  ]);

  // Part-change-on-issued creates an exception and does not silently mutate the issued pool row.
  await finalizeViaRoute(fixture.orderId, fixture.orgId, mixedChangedPlan);
  const afterIssuedChange = await workPoolRows(fixture.orderId, fixture.orgId);
  const issuedMixedCutAfter = afterIssuedChange.find((row: any) => row.pool_id === issuedMixedCut.pool_id);
  assert.ok(issuedMixedCutAfter);
  assert.equal(issuedMixedCutAfter.required_qty, 2);
  assert.equal(issuedMixedCutAfter.expected_count, 2);
  assert.equal(Number(issuedMixedCutAfter.issued_qty), 1);

  const exceptions = assertDb(
    await supabase
      .from('job_work_pool_exceptions')
      .select('work_pool_id, exception_type, status, required_qty_snapshot, issued_qty_snapshot, variance_qty, trigger_context')
      .eq('work_pool_id', issuedMixedCut.pool_id),
    'select issued-change exception',
  );
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].exception_type, 'cutting_plan_issued_count_changed');
  assert.equal(exceptions[0].status, 'open');
  assert.equal(exceptions[0].required_qty_snapshot, 3);
  assert.equal(exceptions[0].issued_qty_snapshot, 1);
  assert.equal(exceptions[0].variance_qty, 2);
  assert.equal(exceptions[0].trigger_context.material_color_label, `${MATERIAL_LABELS.mixed} / 16mm`);

  // Org-empty gate: the same saved plan in an org without activities creates no pool rows.
  await finalizeViaRoute(fixture.emptyOrgOrderId, fixture.emptyOrgId, threeBatchPlan());
  assert.deepEqual(await workPoolRows(fixture.emptyOrgOrderId, fixture.emptyOrgId), []);

  // View-shape regression: this is the same column list used by the route/helper boundary.
  const viewShapeRows = assertDb(
    await supabase.from('job_work_pool_status').select(VIEW_SHAPE_SELECT).eq('pool_id', issuedMixedCut.pool_id),
    'select route work-pool status view shape',
  );
  assert.equal(viewShapeRows.length, 1);
  for (const column of VIEW_SHAPE_SELECT.split(',').map((part) => part.trim())) {
    assert.ok(column in viewShapeRows[0], `Expected job_work_pool_status.${column} to be selectable`);
  }
});
