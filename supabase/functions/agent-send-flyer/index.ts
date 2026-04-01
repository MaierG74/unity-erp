import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "QButton <noreply@qbutton.co.za>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Auth ---

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AgentCredential {
  agent_id: string;
  org_id: string;
  is_active: boolean;
}

async function authenticateAgent(
  request: Request
): Promise<AgentCredential | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7);
  const keyHash = await hashKey(apiKey);

  const { data, error } = await supabase
    .from("agent_credentials")
    .select("agent_id, org_id, is_active")
    .eq("api_key_hash", keyHash)
    .single();

  if (error || !data || !data.is_active) return null;
  return data;
}

// --- Storage ---

function getPublicFlyerUrl(storagePath: string): string {
  const { data } = supabase.storage.from("flyers").getPublicUrl(storagePath);
  return data.publicUrl;
}

async function verifyFlyerExists(storagePath: string): Promise<boolean> {
  const parts = storagePath.split("/");
  const fileName = parts.pop()!;
  const folder = parts.join("/");

  const { data, error } = await supabase.storage
    .from("flyers")
    .list(folder, { search: fileName, limit: 1 });

  if (error || !data || data.length === 0) return false;
  return data.some((f) => f.name === fileName);
}

// --- Email template ---

function buildFlyerEmailHtml(
  productName: string,
  flyerUrl: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0D4F4F,#1A8A7D);padding:20px 32px;">
            <table width="100%"><tr>
              <td style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:3px;">QBUTTON</td>
              <td align="right" style="font-size:11px;color:rgba(255,255,255,0.7);font-style:italic;">From Blueprint to Built.</td>
            </tr></table>
          </td>
        </tr>
        <!-- Accent bar -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#3DC78E,#1A8A7D);"></td></tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="font-size:16px;color:#0D4F4F;font-weight:700;margin:0 0 6px;">
              ${productName}
            </p>
            <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">
              Check out our latest product below.
            </p>
            <a href="${flyerUrl}" target="_blank" style="display:block;text-decoration:none;">
              <img src="${flyerUrl}" alt="${productName}" width="536" style="width:100%;max-width:536px;border-radius:6px;display:block;" />
            </a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0D4F4F;padding:16px 32px;">
            <table width="100%"><tr>
              <td style="font-size:10px;color:rgba(255,255,255,0.7);font-family:monospace;">
                www.qbutton.co.za &nbsp;&nbsp; 010 443 6874 &nbsp;&nbsp; sales@qbutton.co.za
              </td>
              <td align="right" style="font-size:10px;color:rgba(255,255,255,0.4);font-style:italic;">
                From Blueprint to Built.
              </td>
            </tr></table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// --- Resend ---

interface ResendResult {
  id?: string;
  error?: string;
}

async function sendViaResend(
  to: string,
  subject: string,
  html: string
): Promise<ResendResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    return { error: body.message || JSON.stringify(body) };
  }
  return { id: body.id };
}

// --- Request handler ---

interface SendFlyerRequest {
  to: string;
  subject?: string;
  productName: string;
  flyerStoragePath: string;
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // 1. Authenticate
  const credential = await authenticateAgent(req);
  if (!credential) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: SendFlyerRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { to, productName, flyerStoragePath } = body;
  if (!to || !productName || !flyerStoragePath) {
    return Response.json(
      { error: "Missing required fields: to, productName, flyerStoragePath" },
      { status: 400 }
    );
  }

  // 3. Validate storage path starts with org_id prefix
  if (!flyerStoragePath.startsWith(`${credential.org_id}/`)) {
    return Response.json(
      { error: "Storage path must start with your org_id" },
      { status: 403 }
    );
  }

  // 4. Verify flyer exists in storage
  const exists = await verifyFlyerExists(flyerStoragePath);
  if (!exists) {
    return Response.json(
      { error: `Flyer not found at path: ${flyerStoragePath}` },
      { status: 404 }
    );
  }

  // 5. Build email
  const flyerUrl = getPublicFlyerUrl(flyerStoragePath);
  const subject = body.subject || `${productName} — QButton`;
  const html = buildFlyerEmailHtml(productName, flyerUrl);

  // 6. Try to find matching customer for logging
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("org_id", credential.org_id)
    .eq("email", to)
    .limit(1)
    .maybeSingle();

  // 7. Send via Resend
  const result = await sendViaResend(to, subject, html);

  // 8. Log to agent_email_log
  await supabase.from("agent_email_log").insert({
    org_id: credential.org_id,
    agent_id: credential.agent_id,
    recipient_email: to,
    customer_id: customer?.id || null,
    subject,
    flyer_storage_path: flyerStoragePath,
    product_name: productName,
    resend_message_id: result.id || null,
    status: result.error ? "failed" : "sent",
    error_message: result.error || null,
  });

  if (result.error) {
    return Response.json(
      { error: `Email send failed: ${result.error}` },
      { status: 502 }
    );
  }

  return Response.json({
    success: true,
    messageId: result.id,
    to,
    subject,
  });
});
