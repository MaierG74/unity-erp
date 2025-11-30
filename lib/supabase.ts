import { createClient } from '@supabase/supabase-js';

// Get environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// If env vars are missing during static build, use empty strings as placeholders.
// Runtime environments (Vercel/Netlify) must supply the real values.

// Create a safe proxy that throws only when actually used.
function createUnconfiguredProxy(): any {
  const message =
    'Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment (.env.local).';
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

// Lazily initialize Supabase only if env vars are present to avoid import-time crashes in the browser.
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : createUnconfiguredProxy();

// Export as default for compatibility with existing imports
export default supabase;