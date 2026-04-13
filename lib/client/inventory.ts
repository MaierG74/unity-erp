'use client';

import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { InventorySnapshotResponse } from '@/lib/inventory/snapshot';

export type UpdateComponentStockPayload = {
  new_quantity: number;
  reason?: string;
  notes?: string;
  transaction_type?: 'ADJUSTMENT' | 'OPENING_BALANCE';
  transaction_date?: string;
};

export type UpdateComponentStockResponse = {
  component_id: number;
  transaction_id: number | null;
  previous_quantity: number;
  new_quantity: number;
  delta: number;
  transaction_type_name: 'ADJUSTMENT' | 'OPENING_BALANCE';
};

function buildExclusiveAfterIso(asOfDate: string) {
  const localMidnight = new Date(`${asOfDate}T00:00:00`);
  localMidnight.setDate(localMidnight.getDate() + 1);
  return localMidnight.toISOString();
}

async function parseError(res: Response) {
  const text = await res.text();
  return text || `Request failed (${res.status})`;
}

export async function fetchInventorySnapshot(
  asOfDate: string,
  options: { includeEstimatedValues?: boolean } = {}
): Promise<InventorySnapshotResponse> {
  const params = new URLSearchParams({
    as_of: asOfDate,
    exclusive_after: buildExclusiveAfterIso(asOfDate),
  });

  if (options.includeEstimatedValues) {
    params.set('include_estimated_values', 'true');
  }

  const res = await authorizedFetch(`/api/inventory/snapshot?${params.toString()}`, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as InventorySnapshotResponse;
}

export async function updateComponentStockLevel(
  componentId: number,
  payload: UpdateComponentStockPayload
): Promise<UpdateComponentStockResponse> {
  const res = await authorizedFetch(`/api/inventory/components/${componentId}/stock`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as UpdateComponentStockResponse;
}
