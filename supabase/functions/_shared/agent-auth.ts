// Bearer-token → agent_credentials lookup for OpenClaw agent Edge Functions.
//
// Pattern matches supabase/functions/agent-send-flyer/index.ts: SHA-256 hash
// the bearer secret and look up agent_credentials.api_key_hash. Only active
// credentials are accepted.

import { supabase } from "./supabase-client.ts";

export interface AgentCredential {
  agent_id: string;
  org_id: string;
  is_active: boolean;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function authenticateAgent(
  request: Request
): Promise<AgentCredential | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return null;

  const keyHash = await sha256Hex(apiKey);

  const { data, error } = await supabase
    .from("agent_credentials")
    .select("agent_id, org_id, is_active")
    .eq("api_key_hash", keyHash)
    .single();

  if (error || !data || !data.is_active) return null;
  return data as AgentCredential;
}
