import { createClient } from '@supabase/supabase-js';

// Create admin client with service role key to bypass RLS
const isServer = typeof window === 'undefined';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createUnconfiguredProxy(): any {
  const message =
    'supabaseAdmin is not available (missing SUPABASE_SERVICE_ROLE_KEY or being used on the client). Use server-side API routes and set env vars in .env.local.';
  return new Proxy(
    {},
    {
      get() {
        throw new Error(message);
      },
      apply() {
        throw new Error(message);
      },
    }
  );
}

// Only create the admin client on the server and when env vars are present
export const supabaseAdmin =
  isServer && supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : createUnconfiguredProxy();

// Note: This client bypasses Row Level Security (RLS) and should only be used
// in server-side API routes where you have verified the user's permissions
