import { describe, expect, it } from 'vitest';

import {
  computeAvailableQuantity,
  toStockSelectableItems,
  type InventoryComponentRow,
} from '../lib/db/inventory-mapping';

// Builds a minimal raw component row (as returned by the stock picker query)
// with a single optional embedded inventory row, so we can drive the full row
// mapping, not just the math.
function row(
  quantity_on_hand: number | null,
  quantity_reserved: number | null,
  overrides: Partial<InventoryComponentRow> = {},
): InventoryComponentRow {
  return {
    component_id: 101,
    internal_code: 'CMP-101',
    description: 'Test Component',
    is_active: true,
    inventory: { component_id: 101, quantity_on_hand, quantity_reserved },
    ...overrides,
  };
}

describe('computeAvailableQuantity', () => {
  it('reserved = 0 → available equals on-hand', () => {
    expect(computeAvailableQuantity(40, 0)).toBe(40);
  });

  it('reserved = N (< on-hand) → available = on-hand - N', () => {
    expect(computeAvailableQuantity(40, 15)).toBe(25);
  });

  it('reserved > on-hand → available goes negative (NOT floored at 0)', () => {
    // Over-issue / over-reservation must surface, never be hidden behind a 0 floor.
    expect(computeAvailableQuantity(5, 12)).toBe(-7);
  });

  it('null reserved is treated as 0', () => {
    expect(computeAvailableQuantity(30, null)).toBe(30);
  });

  it('undefined reserved is treated as 0', () => {
    expect(computeAvailableQuantity(30, undefined)).toBe(30);
  });

  it('null on-hand is treated as 0 (available = -reserved)', () => {
    expect(computeAvailableQuantity(null, 4)).toBe(-4);
  });

  it('null on-hand and null reserved → 0', () => {
    expect(computeAvailableQuantity(null, null)).toBe(0);
  });

  it('preserves fractional quantities', () => {
    expect(computeAvailableQuantity(10.5, 2.25)).toBe(8.25);
  });
});

describe('toStockSelectableItems availability mapping', () => {
  it('reserved = 0 → available_quantity equals on-hand', () => {
    const [item] = toStockSelectableItems([row(40, 0)]);
    expect(item.available_quantity).toBe(40);
  });

  it('reserved = N (< on-hand) → available_quantity = on-hand - N', () => {
    const [item] = toStockSelectableItems([row(40, 15)]);
    expect(item.available_quantity).toBe(25);
  });

  it('reserved > on-hand → available_quantity negative, surfacing over-issue', () => {
    const [item] = toStockSelectableItems([row(5, 12)]);
    expect(item.available_quantity).toBe(-7);
  });

  it('null reserved is treated as 0 in the mapped available_quantity', () => {
    const [item] = toStockSelectableItems([row(30, null)]);
    expect(item.available_quantity).toBe(30);
  });

  it('exposes the raw quantity_reserved (the picking hold) alongside available', () => {
    // UIs render this as "Reserved (held)"; it must carry the raw hold, not the net.
    const [item] = toStockSelectableItems([row(40, 15)]);
    expect(item.quantity_reserved).toBe(15);
    expect(item.available_quantity).toBe(25);
  });

  it('passes null quantity_reserved through raw while still netting available to on-hand', () => {
    const [item] = toStockSelectableItems([row(30, null)]);
    expect(item.quantity_reserved).toBeNull();
    expect(item.available_quantity).toBe(30);
  });

  it('unwraps an array-shaped component embed and still computes availability', () => {
    const [item] = toStockSelectableItems([
      row(20, 8, {
        inventory: [{ component_id: 101, quantity_on_hand: 20, quantity_reserved: 8 }],
      }),
    ]);
    expect(item.available_quantity).toBe(12);
    expect(item.quantity_reserved).toBe(8);
  });

  it('keeps active master components pickable when no inventory row exists yet', () => {
    const [item] = toStockSelectableItems([
      row(null, null, {
        component_id: 202,
        internal_code: 'CMP-202',
        description: 'No Inventory Yet',
        inventory: null,
      }),
    ]);

    expect(item.component_id).toBe(202);
    expect(item.available_quantity).toBe(0);
    expect(item.has_inventory_record).toBe(false);
    expect(item.quantity_reserved).toBeNull();
  });
});
