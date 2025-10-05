'use client';

import { supabase } from '@/lib/supabase';

type FetchOptions = RequestInit & { headers?: HeadersInit };

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

export type EntityLinkType = 'order' | 'supplier_order' | 'quote';

export interface EntityLinkMeta {
  [key: string]: unknown;
}

export interface EntityLink {
  type: EntityLinkType;
  id: string;
  path: string;
  label: string;
  meta?: EntityLinkMeta | null;
}

export interface EntityLinkSearchResult {
  orders: EntityLink[];
  supplierOrders: EntityLink[];
  quotes: EntityLink[];
}

async function authorizedFetch(input: RequestInfo | URL, init?: FetchOptions) {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

export async function fetchEntityLinks(query: string, limit = 20): Promise<EntityLinkSearchResult> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (limit) params.set('limit', limit.toString());

  const res = await authorizedFetch(`/api/entity-links${params.size ? `?${params.toString()}` : ''}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to load links');
  }

  const json = await res.json();
  return {
    orders: Array.isArray(json?.orders) ? (json.orders as EntityLink[]) : [],
    supplierOrders: Array.isArray(json?.supplierOrders) ? (json.supplierOrders as EntityLink[]) : [],
    quotes: Array.isArray(json?.quotes) ? (json.quotes as EntityLink[]) : [],
  };
}
