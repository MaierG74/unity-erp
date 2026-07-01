'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import {
  InternalOrderCreateForm,
  type InternalOrderPrefillItem,
} from '@/components/features/orders/InternalOrderCreateForm';

function parsePrefill(raw: string | null): InternalOrderPrefillItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): InternalOrderPrefillItem | null => {
        if (!entry || typeof entry !== 'object') return null;
        const productId = Number((entry as Record<string, unknown>).product_id);
        const quantity = Number((entry as Record<string, unknown>).quantity);
        if (!Number.isFinite(productId)) return null;
        return {
          product_id: productId,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        };
      })
      .filter((item): item is InternalOrderPrefillItem => item !== null);
  } catch {
    return [];
  }
}

function NewInternalOrderContent() {
  const searchParams = useSearchParams();
  const prefillItems = useMemo(
    () => parsePrefill(searchParams.get('prefill')),
    [searchParams]
  );

  return <InternalOrderCreateForm prefillItems={prefillItems} />;
}

export default function NewInternalOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading...
        </div>
      }
    >
      <NewInternalOrderContent />
    </Suspense>
  );
}
