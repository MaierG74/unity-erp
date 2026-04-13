'use client';

import { supabase } from '@/lib/supabase';

type FetchOptions = RequestInit & { headers?: HeadersInit };

const TOKEN_CACHE_TTL_MS = 5_000;

let cachedToken: string | null = null;
let cachedTokenAt = 0;
let pendingTokenPromise: Promise<string> | null = null;

function clearTokenCache() {
  cachedToken = null;
  cachedTokenAt = 0;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_CACHE_TTL_MS) {
    return cachedToken;
  }

  if (pendingTokenPromise) {
    return pendingTokenPromise;
  }

  pendingTokenPromise = (async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    let token = data?.session?.access_token;

    // If no session in memory, force a refresh before giving up
    if (!token) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      token = refreshData?.session?.access_token;
    }

    if (!token) {
      const err = new Error('Missing Supabase access token');
      (err as Error & { code?: string }).code = 'NO_TOKEN';
      clearTokenCache();
      throw err;
    }
    cachedToken = token;
    cachedTokenAt = Date.now();
    return token;
  })();

  try {
    return await pendingTokenPromise;
  } finally {
    pendingTokenPromise = null;
  }
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessTokenWithRetry(retries = 4, delayMs = 250): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getAccessToken();
    } catch (error) {
      lastError = error;
      const code = (error as Error & { code?: string })?.code;
      if (code !== 'NO_TOKEN' || attempt === retries) {
        throw error;
      }
      clearTokenCache();
      await wait(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Missing Supabase access token');
}

export async function authorizedFetch(input: RequestInfo | URL, init?: FetchOptions) {
  const token = await getAccessTokenWithRetry();
  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}
