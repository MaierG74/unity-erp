// CORS helpers for OpenClaw agent Edge Functions.
//
// Unity ERP browser clients never call agent functions — they're hit by Sam's
// runtime on ocmac-air over Tailscale-routed HTTPS. CORS is permissive because
// rejection happens at the bearer-token layer, not the origin layer.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function corsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
