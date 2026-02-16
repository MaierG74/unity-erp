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

function readCookieToken(req: NextRequest): string | null {
  const direct = req.cookies.get('sb-access-token')?.value;
  if (direct) return direct;

  // Auth helpers store a JSON payload under this cookie when using the client libraries.
  const cookiePayload = req.cookies.get('supabase-auth-token')?.value;
  if (cookiePayload) {
    try {
      const parsed = JSON.parse(cookiePayload);
      if (Array.isArray(parsed) && typeof parsed[0]?.access_token === 'string') {
        return parsed[0].access_token;
      }
    } catch (_err) {
      return null;
    }
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
