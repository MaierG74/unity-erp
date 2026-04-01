# Agent Send Flyer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Matt (OpenClaw agent) send marketing flyer emails to customers via a Supabase Edge Function using Resend.

**Architecture:** Matt generates a flyer PNG on ocmac-air, uploads it to a `flyers` Supabase Storage bucket, then calls an Edge Function (`agent-send-flyer`) which validates the agent credential, builds a minimal branded HTML email, sends it via the Resend REST API, and logs the send to `agent_email_log`. The Edge Function runs on Deno (Supabase), uses raw HTML (not React Email), and authenticates agents via a per-agent API key stored in `agent_credentials`. Customer group tables are created for future UI work but are not used by the Edge Function in v1.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Resend REST API, Supabase Storage, PostgreSQL

---

## File Structure

| File | Purpose |
|------|---------|
| `supabase/migrations/20260328000001_agent_credentials.sql` | Agent credentials table + RLS |
| `supabase/migrations/20260328000002_customer_groups.sql` | Customer groups + members tables + RLS (schema only for v2) |
| `supabase/migrations/20260328000003_agent_email_log.sql` | Agent email log table + RLS + indexes |
| `supabase/functions/agent-send-flyer/index.ts` | Edge Function: validate key, build email, send via Resend, log |
| `app/api/webhooks/resend/route.ts` | Modify: add `agent_email_log` to webhook event correlation |

---

### Task 1: Migration — `agent_credentials`

**Files:**
- Create: `supabase/migrations/20260328000001_agent_credentials.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Agent credentials: per-agent API keys bound to an org
-- Used by Edge Functions to authenticate agent requests and derive tenant context

CREATE TABLE IF NOT EXISTS public.agent_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,           -- e.g. 'matt'
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  api_key_hash  TEXT NOT NULL,           -- SHA-256 hex of the API key
  label         TEXT,                    -- human-readable label, e.g. 'Matt - QButton'
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, org_id)
);

CREATE INDEX idx_agent_credentials_api_key_hash ON public.agent_credentials(api_key_hash);

ALTER TABLE public.agent_credentials ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write agent credentials (not user-facing)
CREATE POLICY agent_credentials_service_role_select
ON public.agent_credentials FOR SELECT TO service_role
USING (true);

CREATE POLICY agent_credentials_service_role_all
ON public.agent_credentials FOR ALL TO service_role
USING (true) WITH CHECK (true);

COMMENT ON TABLE public.agent_credentials IS 'Per-agent API keys for Edge Function authentication. Key is hashed; org_id derived from credential on each request.';
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP:
```
apply_migration("agent_credentials", <sql from step 1>)
```

- [ ] **Step 3: Verify the table exists**

Run via Supabase MCP:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'agent_credentials'
ORDER BY ordinal_position;
```

Expected: 8 columns (id, agent_id, org_id, api_key_hash, label, is_active, created_at, updated_at).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260328000001_agent_credentials.sql
git commit -m "feat: add agent_credentials table for Edge Function auth"
```

---

### Task 2: Migration — `customer_groups` + `customer_group_members`

**Files:**
- Create: `supabase/migrations/20260328000002_customer_groups.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Customer groups: named groups for future bulk email sends
-- Schema only for v1 — group sends come in v2 with consent tracking

CREATE TABLE IF NOT EXISTS public.customer_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

ALTER TABLE public.customer_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_groups_select_org_member
ON public.customer_groups FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_groups.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_groups_manage_org_member
ON public.customer_groups FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_groups.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_groups.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_groups_service_role
ON public.customer_groups FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Junction table: which customers belong to which groups
CREATE TABLE IF NOT EXISTS public.customer_group_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  group_id      UUID NOT NULL REFERENCES public.customer_groups(id) ON DELETE CASCADE,
  customer_id   BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, customer_id)
);

-- Enforce org consistency: group and customer must share the same org
-- Uses a trigger since composite FK across tables isn't straightforward
CREATE OR REPLACE FUNCTION public.check_customer_group_member_org_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_group_org_id UUID;
  v_customer_org_id UUID;
BEGIN
  SELECT org_id INTO v_group_org_id FROM public.customer_groups WHERE id = NEW.group_id;
  SELECT org_id INTO v_customer_org_id FROM public.customers WHERE id = NEW.customer_id;

  IF v_group_org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'group org_id (%) does not match member org_id (%)', v_group_org_id, NEW.org_id;
  END IF;

  IF v_customer_org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'customer org_id (%) does not match member org_id (%)', v_customer_org_id, NEW.org_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_group_member_org_check
BEFORE INSERT OR UPDATE ON public.customer_group_members
FOR EACH ROW EXECUTE FUNCTION public.check_customer_group_member_org_consistency();

CREATE INDEX idx_customer_group_members_group_id ON public.customer_group_members(group_id);
CREATE INDEX idx_customer_group_members_customer_id ON public.customer_group_members(customer_id);

ALTER TABLE public.customer_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_group_members_select_org_member
ON public.customer_group_members FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_group_members.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_group_members_manage_org_member
ON public.customer_group_members FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_group_members.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = customer_group_members.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY customer_group_members_service_role
ON public.customer_group_members FOR ALL TO service_role
USING (true) WITH CHECK (true);

COMMENT ON TABLE public.customer_groups IS 'Named customer groups for bulk email sends. v1 schema only — group sends require consent tracking (v2).';
COMMENT ON TABLE public.customer_group_members IS 'Junction: customers in groups. Org consistency enforced by trigger.';
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP:
```
apply_migration("customer_groups", <sql from step 1>)
```

- [ ] **Step 3: Verify both tables and the trigger**

Run via Supabase MCP:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('customer_groups', 'customer_group_members')
ORDER BY table_name;
```

Expected: both tables listed.

Then verify the org-consistency trigger exists:
```sql
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'customer_group_members';
```

Expected: `trg_customer_group_member_org_check`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260328000002_customer_groups.sql
git commit -m "feat: add customer_groups and customer_group_members tables (schema for v2)"
```

---

### Task 3: Migration — `agent_email_log`

**Files:**
- Create: `supabase/migrations/20260328000003_agent_email_log.sql`

- [ ] **Step 1: Write the migration SQL**

Pattern matches `quote_email_log` + delivery tracking columns from `20260114_email_tracking.sql`.

```sql
-- Agent email log: tracks all emails sent by agents via Edge Functions
-- Follows quote_email_log pattern with delivery tracking columns

CREATE TABLE IF NOT EXISTS public.agent_email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id),
  agent_id            TEXT NOT NULL,
  recipient_email     TEXT NOT NULL,
  customer_id         BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  subject             TEXT NOT NULL,
  flyer_storage_path  TEXT,
  product_name        TEXT,
  resend_message_id   TEXT,
  status              TEXT NOT NULL DEFAULT 'sent',   -- sent, failed
  error_message       TEXT,
  -- Delivery tracking (updated by Resend webhook)
  delivery_status     TEXT DEFAULT 'sent',            -- sent, delivered, bounced, complained, delayed
  delivered_at        TIMESTAMPTZ,
  bounced_at          TIMESTAMPTZ,
  bounce_reason       TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries and webhook correlation
CREATE INDEX idx_agent_email_log_org_id ON public.agent_email_log(org_id);
CREATE INDEX idx_agent_email_log_agent_id ON public.agent_email_log(agent_id);
CREATE INDEX idx_agent_email_log_sent_at ON public.agent_email_log(sent_at DESC);
CREATE INDEX idx_agent_email_log_resend_message_id ON public.agent_email_log(resend_message_id);
CREATE INDEX idx_agent_email_log_status ON public.agent_email_log(status);

ALTER TABLE public.agent_email_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view logs for their org
CREATE POLICY agent_email_log_select_org_member
ON public.agent_email_log FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = agent_email_log.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Service role can insert and update (for Edge Function + webhook)
CREATE POLICY agent_email_log_service_role
ON public.agent_email_log FOR ALL TO service_role
USING (true) WITH CHECK (true);

COMMENT ON TABLE public.agent_email_log IS 'Tracks emails sent by OpenClaw agents via Edge Functions. Delivery status updated by Resend webhooks.';
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP:
```
apply_migration("agent_email_log", <sql from step 1>)
```

- [ ] **Step 3: Verify table and indexes**

Run via Supabase MCP:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'agent_email_log'
ORDER BY ordinal_position;
```

Expected: 17 columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260328000003_agent_email_log.sql
git commit -m "feat: add agent_email_log table with delivery tracking columns"
```

---

### Task 4: Create `flyers` Storage Bucket

No migration file needed — buckets are managed via the Supabase dashboard or MCP. The bucket must be **public** so flyer images are accessible via URL in emails.

- [ ] **Step 1: Create the bucket**

Run via Supabase MCP `execute_sql`:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'flyers',
  'flyers',
  true,
  52428800,  -- 50MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Add storage policy for agent uploads (service role)**

The service role can already access all storage. For the org-scoped path convention `flyers/{org_id}/...`, we don't need extra policies since Matt uploads via service role key (POC). The Edge Function reads via service role.

Verify the bucket exists:
```sql
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'flyers';
```

Expected: one row, `public = true`.

- [ ] **Step 3: Commit a note in the migration directory for documentation**

Create `supabase/migrations/20260328000004_flyers_storage_bucket.sql`:

```sql
-- Flyers storage bucket
-- Created via Supabase storage API (not DDL)
-- Convention: flyers/{org_id}/{yyyy}/{mm}/{slug}.png
-- Public bucket — URLs are embeddable in emails
-- See: docs/technical/openclaw-agent-architecture.md

-- This file is documentation only. Bucket created via:
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('flyers', 'flyers', true, 52428800, ARRAY['image/png', 'image/jpeg', 'image/webp']);
```

```bash
git add supabase/migrations/20260328000004_flyers_storage_bucket.sql
git commit -m "feat: create flyers storage bucket (public, org-scoped paths)"
```

---

### Task 5: Edge Function — `agent-send-flyer`

**Files:**
- Create: `supabase/functions/agent-send-flyer/index.ts`

This is the first Edge Function in the project. It runs on Deno (Supabase Edge Runtime).

- [ ] **Step 1: Create the Edge Function file**

```typescript
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
  // List the specific file to verify it exists
  // storagePath is like "{org_id}/2026/03/zurich-chair.png"
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
```

- [ ] **Step 2: Deploy the Edge Function**

Run via Supabase MCP `deploy_edge_function`:
- name: `agent-send-flyer`
- entrypoint_path: `index.ts`
- verify_jwt: `false` (uses custom API key auth, not Supabase JWT)
- files: `[{ name: "index.ts", content: <code from step 1> }]`

- [ ] **Step 3: Set Edge Function secrets**

The Edge Function needs `RESEND_API_KEY` and `EMAIL_FROM` set as secrets. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase.

Run via CLI (on local machine or ask user):
```bash
supabase secrets set RESEND_API_KEY=<value from .env> EMAIL_FROM="QButton <noreply@qbutton.co.za>"
```

Note: The user will need to run this command themselves since it requires the Supabase CLI with project auth. Suggest they type `! supabase secrets set RESEND_API_KEY=<key>` in the Claude Code prompt.

- [ ] **Step 4: Commit the function file**

```bash
mkdir -p supabase/functions/agent-send-flyer
git add supabase/functions/agent-send-flyer/index.ts
git commit -m "feat: add agent-send-flyer Edge Function"
```

---

### Task 6: Seed Agent Credential for Matt

- [ ] **Step 1: Generate an API key and hash it**

Generate a random 32-byte key and compute its SHA-256 hash. Run locally:

```bash
API_KEY=$(openssl rand -hex 32)
API_KEY_HASH=$(echo -n "$API_KEY" | shasum -a 256 | cut -d' ' -f1)
echo "API_KEY=$API_KEY"
echo "API_KEY_HASH=$API_KEY_HASH"
```

Save the `API_KEY` value — it goes to Matt's env on ocmac-air. The hash goes to the database.

- [ ] **Step 2: Find QButton's org_id**

Run via Supabase MCP:
```sql
SELECT id FROM organizations WHERE name ILIKE '%qbutton%' LIMIT 1;
```

- [ ] **Step 3: Insert the credential**

Run via Supabase MCP (replace `<hash>` and `<org_id>`):
```sql
INSERT INTO agent_credentials (agent_id, org_id, api_key_hash, label)
VALUES ('matt', '<org_id>', '<hash>', 'Matt - QButton orchestrator');
```

- [ ] **Step 4: Store the API key on ocmac-air**

SSH to ocmac-air and add to Matt's environment:
```bash
ssh gregorymaier@100.72.214.30 'echo "export AGENT_FLYER_API_KEY=<API_KEY>" >> ~/.zshrc'
```

---

### Task 7: Update Resend Webhook to Correlate Agent Emails

**Files:**
- Modify: `app/api/webhooks/resend/route.ts`

- [ ] **Step 1: Add agent_email_log lookup to `findLinkedRecords`**

In `app/api/webhooks/resend/route.ts`, add a third lookup in the `findLinkedRecords` function.

Find this code (around line 90-111):
```typescript
async function findLinkedRecords(emailId: string) {
  // Check purchase_order_emails
  const { data: poEmail } = await supabaseAdmin
    .from('purchase_order_emails')
    .select('purchase_order_id, id')
    .eq('message_id', emailId)
    .single();

  // Check quote_email_log
  const { data: quoteEmail } = await supabaseAdmin
    .from('quote_email_log')
    .select('quote_id, id')
    .eq('resend_message_id', emailId)
    .single();

  return {
    purchaseOrderId: poEmail?.purchase_order_id || null,
    purchaseOrderEmailId: poEmail?.id || null,
    quoteId: quoteEmail?.quote_id || null,
    quoteEmailLogId: quoteEmail?.id || null,
  };
}
```

Replace with:
```typescript
async function findLinkedRecords(emailId: string) {
  // Check purchase_order_emails
  const { data: poEmail } = await supabaseAdmin
    .from('purchase_order_emails')
    .select('purchase_order_id, id')
    .eq('message_id', emailId)
    .single();

  // Check quote_email_log
  const { data: quoteEmail } = await supabaseAdmin
    .from('quote_email_log')
    .select('quote_id, id')
    .eq('resend_message_id', emailId)
    .single();

  // Check agent_email_log
  const { data: agentEmail } = await supabaseAdmin
    .from('agent_email_log')
    .select('id')
    .eq('resend_message_id', emailId)
    .single();

  return {
    purchaseOrderId: poEmail?.purchase_order_id || null,
    purchaseOrderEmailId: poEmail?.id || null,
    quoteId: quoteEmail?.quote_id || null,
    quoteEmailLogId: quoteEmail?.id || null,
    agentEmailLogId: agentEmail?.id || null,
  };
}
```

- [ ] **Step 2: Add agent_email_log updates to `updateEmailStatus`**

In the same file, find the `updateEmailStatus` function. After each event type's existing updates (for `purchase_order_emails` and `quote_email_log`), add the equivalent update for `agent_email_log`.

Add these lines inside each event branch:

For `delivered`:
```typescript
    await supabaseAdmin
      .from('agent_email_log')
      .update({ delivery_status: 'delivered', delivered_at: now })
      .eq('resend_message_id', emailId);
```

For `bounced`:
```typescript
    await supabaseAdmin
      .from('agent_email_log')
      .update({
        delivery_status: 'bounced',
        bounced_at: now,
        bounce_reason: bounceReason,
      })
      .eq('resend_message_id', emailId);
```

For `complained`:
```typescript
    await supabaseAdmin
      .from('agent_email_log')
      .update({ delivery_status: 'complained' })
      .eq('resend_message_id', emailId);
```

For `delayed`:
```typescript
    await supabaseAdmin
      .from('agent_email_log')
      .update({ delivery_status: 'delayed' })
      .eq('resend_message_id', emailId);
```

- [ ] **Step 3: Verify the webhook route compiles**

```bash
npx tsc --noEmit app/api/webhooks/resend/route.ts 2>&1 || echo "Check for type errors"
```

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/resend/route.ts
git commit -m "feat: add agent_email_log correlation to Resend webhook handler"
```

---

### Task 8: Update Matt's Workspace on ocmac-air

**Files on ocmac-air:**
- Modify: `~/.openclaw/workspace/skills/marketing-flyer/SKILL.md`
- Create: `~/.openclaw/workspace/scripts/upload-and-send-flyer.sh`

- [ ] **Step 1: Create the upload-and-send helper script**

SSH to ocmac-air and create `~/.openclaw/workspace/scripts/upload-and-send-flyer.sh`:

```bash
#!/bin/bash
# Upload a flyer PNG to Supabase Storage and send it via the agent-send-flyer Edge Function.
# Usage: ./upload-and-send-flyer.sh <png-path> <recipient-email> <product-name> [subject]

set -euo pipefail

PNG_PATH="$1"
RECIPIENT="$2"
PRODUCT_NAME="$3"
SUBJECT="${4:-$PRODUCT_NAME — QButton}"

# Required env vars
: "${SUPABASE_URL:?Set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"
: "${AGENT_FLYER_API_KEY:?Set AGENT_FLYER_API_KEY}"
: "${QBUTTON_ORG_ID:?Set QBUTTON_ORG_ID}"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF}"

# Build storage path: {org_id}/{yyyy}/{mm}/{filename}
YEAR=$(date +%Y)
MONTH=$(date +%m)
FILENAME=$(basename "$PNG_PATH")
STORAGE_PATH="${QBUTTON_ORG_ID}/${YEAR}/${MONTH}/${FILENAME}"

echo "Uploading ${FILENAME} to flyers/${STORAGE_PATH}..."

# Upload to Supabase Storage
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  "${SUPABASE_URL}/storage/v1/object/flyers/${STORAGE_PATH}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: image/png" \
  --data-binary "@${PNG_PATH}")

if [ "$HTTP_CODE" != "200" ]; then
  echo "Upload failed (HTTP $HTTP_CODE). Retrying with upsert..."
  curl -s -f \
    -X POST \
    "${SUPABASE_URL}/storage/v1/object/flyers/${STORAGE_PATH}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: image/png" \
    -H "x-upsert: true" \
    --data-binary "@${PNG_PATH}" > /dev/null
fi

echo "Upload complete. Sending email to ${RECIPIENT}..."

# Call Edge Function
RESPONSE=$(curl -s \
  -X POST \
  "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/agent-send-flyer" \
  -H "Authorization: Bearer ${AGENT_FLYER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"${RECIPIENT}\",
    \"productName\": \"${PRODUCT_NAME}\",
    \"flyerStoragePath\": \"${STORAGE_PATH}\",
    \"subject\": \"${SUBJECT}\"
  }")

echo "Response: ${RESPONSE}"
```

```bash
chmod +x ~/.openclaw/workspace/scripts/upload-and-send-flyer.sh
```

- [ ] **Step 2: Set the required env vars on ocmac-air**

SSH to ocmac-air and add to `~/.zshrc` (the `AGENT_FLYER_API_KEY` was already added in Task 6):

```bash
# Already set from previous work: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# Add:
export QBUTTON_ORG_ID="<org_id from Task 6>"
export SUPABASE_PROJECT_REF="<project ref from Supabase dashboard>"
```

- [ ] **Step 3: Update SKILL.md with send-via-email step**

Add the following section to `~/.openclaw/workspace/skills/marketing-flyer/SKILL.md`, after the "### Step 3: Send the flyer back" section:

```markdown
### Step 3b: Offer to email the flyer (optional)

After sending the flyer via Telegram, ask:
"Want me to email this to someone?"

If yes, ask for the recipient email address.

Then run the upload-and-send script:
```bash
cd /Users/gregorymaier/.openclaw/workspace && \
  scripts/upload-and-send-flyer.sh \
  flyer-output.png \
  "recipient@example.com" \
  "Product Name" \
  "Product Name — QButton"
```

Report the result: "Sent to recipient@example.com" or relay any error.
```

- [ ] **Step 4: No commit needed — these files are on ocmac-air, not in the Unity ERP repo**

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Test the Edge Function directly**

From the local machine, call the Edge Function with `curl` using the API key from Task 6.

First, upload a test flyer to verify the storage path works:
```bash
curl -X POST \
  "${SUPABASE_URL}/storage/v1/object/flyers/${QBUTTON_ORG_ID}/2026/03/test-flyer.png" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: image/png" \
  -H "x-upsert: true" \
  --data-binary "@/tmp/zurich-flyer-v9.png"
```

Then call the Edge Function:
```bash
curl -X POST \
  "https://<project-ref>.supabase.co/functions/v1/agent-send-flyer" \
  -H "Authorization: Bearer ${AGENT_FLYER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "testai@qbutton.co.za",
    "productName": "Zürich Chair",
    "flyerStoragePath": "<org_id>/2026/03/test-flyer.png"
  }'
```

Expected: `{ "success": true, "messageId": "...", "to": "testai@qbutton.co.za", "subject": "Zürich Chair — QButton" }`

- [ ] **Step 2: Verify the email arrived**

Check the test inbox for `testai@qbutton.co.za` and confirm:
- QButton branded header
- Product name "Zürich Chair" visible
- Flyer image loads from Supabase Storage URL
- Footer has contact info

- [ ] **Step 3: Verify the log entry**

Run via Supabase MCP:
```sql
SELECT agent_id, recipient_email, subject, status, resend_message_id
FROM agent_email_log
ORDER BY sent_at DESC
LIMIT 1;
```

Expected: one row with `agent_id = 'matt'`, `status = 'sent'`, `resend_message_id` populated.

- [ ] **Step 4: Test from ocmac-air**

SSH to ocmac-air and run the full flow:
```bash
source ~/.zshrc
cd ~/.openclaw/workspace
scripts/upload-and-send-flyer.sh \
  zurich-flyer-v9.png \
  "testai@qbutton.co.za" \
  "Zürich Chair"
```

Expected: "Upload complete. Sending email..." followed by success response.

- [ ] **Step 5: Run lint on modified files**

```bash
npm run lint
```

- [ ] **Step 6: Run RLS security advisor**

Run via Supabase MCP: `get_advisors` — check that `agent_credentials`, `customer_groups`, `customer_group_members`, and `agent_email_log` all have RLS enabled with no warnings.

- [ ] **Step 7: Clean up test data**

Run via Supabase MCP:
```sql
DELETE FROM agent_email_log WHERE recipient_email = 'testai@qbutton.co.za';
```

Remove the test flyer from storage if desired.
