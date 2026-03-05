// hooks/useTaskContext.ts
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface TaskContext {
  contextType: string;
  contextId: string;
  contextPath: string;
  contextLabel: string;
}

const ROUTE_PATTERNS: { pattern: RegExp; type: string; table: string; labelCol: string; prefix: string }[] = [
  { pattern: /^\/orders\/([0-9a-f-]{36})/, type: 'order', table: 'orders', labelCol: 'order_number', prefix: 'Order' },
  { pattern: /^\/purchasing\/purchase-orders\/([0-9a-f-]{36})/, type: 'supplier_order', table: 'supplier_orders', labelCol: 'po_number', prefix: 'PO' },
  { pattern: /^\/quotes\/([0-9a-f-]{36})/, type: 'quote', table: 'quotes', labelCol: 'quote_number', prefix: 'Quote' },
  { pattern: /^\/customers\/([0-9a-f-]{36})/, type: 'customer', table: 'customers', labelCol: 'name', prefix: '' },
  { pattern: /^\/products\/([0-9a-f-]{36})/, type: 'product', table: 'products', labelCol: 'name', prefix: '' },
];

export function useTaskContext(): TaskContext | null {
  const pathname = usePathname();
  const [context, setContext] = useState<TaskContext | null>(null);

  useEffect(() => {
    if (!pathname) {
      setContext(null);
      return;
    }

    let cancelled = false;

    const match = ROUTE_PATTERNS.find(r => r.pattern.test(pathname));
    if (!match) {
      setContext(null);
      return;
    }

    const id = pathname.match(match.pattern)?.[1];
    if (!id) {
      setContext(null);
      return;
    }

    (async () => {
      try {
        const { data } = await supabase
          .from(match.table)
          .select(match.labelCol)
          .eq('id', id)
          .maybeSingle();

        if (cancelled) return;

        const rawLabel = data?.[match.labelCol] ?? id;
        const label = match.prefix ? `${match.prefix} ${rawLabel}` : String(rawLabel);

        setContext({
          contextType: match.type,
          contextId: id,
          contextPath: pathname,
          contextLabel: label,
        });
      } catch {
        if (!cancelled) setContext(null);
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  return context;
}
