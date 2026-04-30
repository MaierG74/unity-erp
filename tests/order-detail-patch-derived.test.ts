import { describe, expect, it } from 'vitest';
import { getPresentDerivedSurchargeFields, warnOnDerivedSurchargeFieldWrite } from '@/lib/orders/derived-field-warnings';

describe('derived surcharge field observability', () => {
  it('detects direct writes to derived surcharge fields', () => {
    expect(getPresentDerivedSurchargeFields({
      surcharge_total: 999,
      cutlist_surcharge_resolved: 125,
      quantity: 5,
    })).toEqual(['surcharge_total', 'cutlist_surcharge_resolved']);
  });

  it('does not warn for ordinary quantity-only updates', () => {
    const originalWarn = console.warn;
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };

    warnOnDerivedSurchargeFieldWrite({
      route: '/api/order-details/123',
      payload: { quantity: 5 },
      callerInfo: { userId: 'user-1' },
    });

    expect(calls).toEqual([]);
    console.warn = originalWarn;
  });

  it('logs and leaves direct derived-field payloads available to pass through', () => {
    const originalWarn = console.warn;
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    const payload = { surcharge_total: 999 };

    warnOnDerivedSurchargeFieldWrite({
      route: '/api/order-details/123',
      payload,
      callerInfo: { userId: 'user-1' },
    });

    expect(payload).toEqual({ surcharge_total: 999 });
    expect(calls).toEqual([['[PATCH] derived field write detected', {
      route: '/api/order-details/123',
      field: 'surcharge_total',
      value: 999,
      callerInfo: { userId: 'user-1' },
    }]]);
    console.warn = originalWarn;
  });
});
