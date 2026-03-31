'use client';

import { useState, useEffect, useRef } from 'react';
import { authorizedFetch } from '@/lib/client/auth-fetch';

export type ComponentOption = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  cheapest_price: number | null;
  cheapest_supplier_component_id: number | null;
  cheapest_supplier_name: string | null;
  all_supplier_names: string;
};

export function useComponentsByCategory(categoryId: number | 'all' | null, search: string) {
  const [components, setComponents] = useState<ComponentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (categoryId === null) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim().length >= 2) params.set('search', search.trim());

    authorizedFetch(`/api/components/by-category/${categoryId}?${params}`, {
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(json => {
        if (!controller.signal.aborted) {
          setComponents(json.components ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error('[useComponentsByCategory] fetch error:', err);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [categoryId, search]);

  return { components, loading };
}
