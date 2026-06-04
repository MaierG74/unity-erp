// Shared service-role Supabase client for OpenClaw agent Edge Functions.
//
// Service role bypasses RLS — every caller is fully responsible for scoping
// reads and writes to the org_id resolved via authenticateAgent().

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "agent-runtime: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
  );
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
