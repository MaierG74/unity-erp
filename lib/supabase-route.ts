import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type RouteClientResult = {
  supabase: SupabaseClient;
  user: User;
  accessToken: string;
};

export type RouteClientError = {
  error: string;
  status?: number;
};

function parseTokenFromJsonPayload(rawValue: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (typeof parsed === 'string' && parsed.length > 0) {
    return parsed;
  }

  if (Array.isArray(parsed)) {
    const first = parsed[0] as any;
    if (typeof first === 'string' && first.length > 0) {
      return first;
    }
    if (typeof first?.access_token === 'string') {
      return first.access_token;
    }
    if (typeof first?.currentSession?.access_token === 'string') {
      return first.currentSession.access_token;
    }
    if (typeof first?.session?.access_token === 'string') {
      return first.session.access_token;
    }
  }

  if (parsed && typeof parsed === 'object') {
    const value = parsed as any;
    if (typeof value.access_token === 'string') {
      return value.access_token;
    }
    if (typeof value.currentSession?.access_token === 'string') {
      return value.currentSession.access_token;
    }
    if (typeof value.session?.access_token === 'string') {
      return value.session.access_token;
    }
  }

  return null;
}

function parseTokenFromCookiePayload(rawValue: string): string | null {
  const candidates = [rawValue];
  try {
    const decoded = decodeURIComponent(rawValue);
    if (decoded !== rawValue) {
      candidates.push(decoded);
    }
  } catch {
    // keep raw value only
  }

  for (const candidate of candidates) {
    const token = parseTokenFromJsonPayload(candidate);
    if (token) return token;
  }

  return null;
}

function readCookieToken(req: NextRequest): string | null {
  const direct = req.cookies.get('sb-access-token')?.value;
  if (direct) return direct;

  const cookies = req.cookies.getAll();

  // Auth helpers can store JSON under these names depending on adapter/version.
  const authCookieNames = new Set<string>(['supabase-auth-token']);
  for (const { name } of cookies) {
    if (/^sb-.*-auth-token$/.test(name)) {
      authCookieNames.add(name);
    }
  }

  for (const cookieName of authCookieNames) {
    const cookiePayload = req.cookies.get(cookieName)?.value;
    if (!cookiePayload) continue;
    const token = parseTokenFromCookiePayload(cookiePayload);
    if (token) return token;
  }

  // Some adapters chunk larger auth cookies into <name>.0, <name>.1, ...
  const chunkMap = new Map<string, Array<{ index: number; value: string }>>();
  for (const { name, value } of cookies) {
    const match = name.match(/^(.*auth-token)\.(\d+)$/);
    if (!match) continue;
    const baseName = match[1];
    const index = Number.parseInt(match[2], 10);
    if (!Number.isFinite(index)) continue;
    const existing = chunkMap.get(baseName) ?? [];
    existing.push({ index, value });
    chunkMap.set(baseName, existing);
  }

  for (const chunks of chunkMap.values()) {
    const combined = chunks
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.value)
      .join('');
    if (!combined) continue;
    const token = parseTokenFromCookiePayload(combined);
    if (token) return token;
  }

  return null;
}

export function extractAccessToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) {
    return header.substring('Bearer '.length).trim();
  }

  return readCookieToken(req);
}

function buildClient(accessToken: string | null): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers,
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
  });
}

export async function getRouteClient(req: NextRequest): Promise<RouteClientResult | RouteClientError> {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return { error: 'Missing Supabase access token', status: 401 };
  }

  const supabase = buildClient(accessToken);

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    console.error('[getRouteClient] User fetch error:', userError);
    return { error: 'Unable to resolve authenticated user', status: 401 };
  }

  return {
    supabase,
    user: userData.user,
    accessToken,
  };
}

export type RouteClientResponse = Promise<RouteClientResult | RouteClientError>;
