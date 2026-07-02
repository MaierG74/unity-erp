// process-payment-escalations - converts claimed cash-supplier closure
// escalation events into buyer/accounts-team email reminders and todos.
//
// Request:
//   POST /functions/v1/process-payment-escalations
//   Authorization: Bearer <agent api key>
//
// The agent credential owns the org boundary. This function uses the shared
// service-role client, so every query below must be explicitly org-scoped.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { authenticateAgent } from "../_shared/agent-auth.ts";
import { supabase } from "../_shared/supabase-client.ts";

const SOURCE_TYPES = [
  "cash_invoice_overdue",
  "cash_payment_overdue",
  "cash_pop_overdue",
  "po_eta_overdue",
  "cash_closed_unsigned",
];

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_BASE_URL =
  Deno.env.get("APP_BASE_URL")?.replace(/\/+$/, "") || "https://app.unityerp.co.za";
const EMAIL_FROM =
  Deno.env.get("EMAIL_FROM_ORDERS") ||
  Deno.env.get("EMAIL_FROM") ||
  "Unity ERP Purchasing <purchasing@example.com>";

type DeliveryStatus =
  | "sent"
  | "partial"
  | "failed"
  | "daily_brief"
  | "no_profile"
  | "no_recipient";

interface EscalationEvent {
  event_id: string;
  closure_item_id: string;
  escalation_level: number;
  target_type: "owner" | "supervisor" | "daily_brief" | string;
  target_user_id: string | null;
  source_type: string;
  source_id: string;
  item_title: string;
  item_payload: Record<string, unknown> | null;
  owner_user_id: string | null;
}

interface RecipientContext {
  profileId: string;
  email: string;
}

interface PurchaseOrderContext {
  purchaseOrderId: number;
  supplierId: number;
}

interface Summary {
  claimed: number;
  sent: number;
  todos: number;
  skipped: number;
  failed: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getPurchaseOrderId(event: EscalationEvent): number | null {
  const payloadId = event.item_payload?.purchase_order_id;
  const id = typeof payloadId === "number" ? payloadId : Number(payloadId ?? event.source_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getContextPath(event: EscalationEvent): string {
  return `/purchasing/purchase-orders/${event.source_id}`;
}

async function markEventProcessed(
  eventId: string,
  deliveryStatus: DeliveryStatus
): Promise<void> {
  const { error } = await supabase
    .from("closure_escalation_events")
    .update({
      processed_at: new Date().toISOString(),
      delivery_status: deliveryStatus,
    })
    .eq("id", eventId);

  if (error) {
    console.error("[process-payment-escalations] Failed to mark processed", {
      eventId,
      deliveryStatus,
      error,
    });
  }
}

async function resolveRecipient(authUserId: string): Promise<RecipientContext | null> {
  const [{ data: userResult, error: userError }, { data: profile, error: profileError }] =
    await Promise.all([
      supabase.auth.admin.getUserById(authUserId),
      supabase.from("profiles").select("id").eq("id", authUserId).maybeSingle(),
    ]);

  if (profileError) {
    console.error("[process-payment-escalations] Failed to load profile", {
      authUserId,
      error: profileError,
    });
    throw new Error(`Failed to load profile for ${authUserId}: ${profileError.message}`);
  }

  if (!profile?.id) {
    return null;
  }

  const email = userResult?.user?.email;
  if (userError || !email) {
    console.error("[process-payment-escalations] Failed to load auth email", {
      authUserId,
      error: userError,
    });
    throw new Error(`No auth email for recipient ${authUserId}`);
  }

  return {
    profileId: profile.id as string,
    email,
  };
}

async function resolveRecipients(event: EscalationEvent, orgId: string): Promise<string[]> {
  if (event.target_type === "daily_brief") {
    return [];
  }

  if (event.target_type === "supervisor") {
    const { data, error } = await supabase
      .from("org_accounts_team")
      .select("user_id")
      .eq("org_id", orgId);

    if (error) {
      throw new Error(`Failed to load accounts team: ${error.message}`);
    }

    return [...new Set((data ?? []).map((row) => row.user_id as string).filter(Boolean))];
  }

  const ownerId = event.target_user_id ?? event.owner_user_id;
  return ownerId ? [ownerId] : [];
}

async function fetchPurchaseOrder(
  orgId: string,
  purchaseOrderId: number
): Promise<PurchaseOrderContext> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("purchase_order_id, supplier_id")
    .eq("org_id", orgId)
    .eq("purchase_order_id", purchaseOrderId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      error?.message ?? `Purchase order ${purchaseOrderId} not found for org`
    );
  }

  return {
    purchaseOrderId: data.purchase_order_id as number,
    supplierId: data.supplier_id as number,
  };
}

async function sendReminderEmail(args: {
  event: EscalationEvent;
  recipient: RecipientContext;
  deliveryKey: string;
}): Promise<string | null> {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const path = getContextPath(args.event);
  const url = `${APP_BASE_URL}${path}`;
  const summary =
    typeof args.event.item_payload?.summary === "string"
      ? args.event.item_payload.summary
      : `Payment escalation for ${args.event.source_type.replaceAll("_", " ")}.`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <p>${escapeHtml(summary)}</p>
      <p><a href="${escapeHtml(url)}">Open purchase order</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="font-size:12px;color:#6b7280">Delivery key: ${escapeHtml(args.deliveryKey)}</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "X-Entity-Ref-ID": args.deliveryKey,
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [args.recipient.email],
      subject: args.event.item_title,
      html,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : `Resend returned ${response.status}`
    );
  }

  return typeof body?.id === "string" ? body.id : null;
}

async function logEmail(args: {
  orgId: string;
  po: PurchaseOrderContext;
  recipientEmail: string;
  status: "sent" | "failed";
  messageId: string | null;
  errorMessage: string | null;
}): Promise<void> {
  const { error } = await supabase.from("purchase_order_emails").insert({
    org_id: args.orgId,
    purchase_order_id: args.po.purchaseOrderId,
    supplier_id: args.po.supplierId,
    supplier_order_id: null,
    recipient_email: args.recipientEmail,
    cc_emails: [],
    email_type: "po_payment_reminder",
    status: args.status,
    message_id: args.messageId,
    error_message: args.errorMessage,
  });

  if (error) {
    throw new Error(`Failed to log purchase_order_emails row: ${error.message}`);
  }
}

async function createTodo(args: {
  event: EscalationEvent;
  recipient: RecipientContext;
  deliveryKey: string;
}): Promise<void> {
  const contextPath = getContextPath(args.event);
  const contextSnapshot = {
    ...(args.event.item_payload ?? {}),
    delivery_key: args.deliveryKey,
    escalation_event_id: args.event.event_id,
    closure_item_id: args.event.closure_item_id,
    source_type: args.event.source_type,
    source_id: args.event.source_id,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("todo_items")
    .insert({
      title: args.event.item_title,
      description: null,
      priority: "medium",
      due_at: null,
      created_by: args.recipient.profileId,
      assigned_to: args.recipient.profileId,
      entity_id: null,
      context_type: "purchase_order",
      context_id: null,
      context_path: contextPath,
      context_snapshot: contextSnapshot,
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message ?? "Failed to create todo");
  }

  const { error: activityError } = await supabase.from("todo_activity").insert({
    todo_id: inserted.id,
    event_type: "created",
    payload: {
      assigned_to: args.recipient.profileId,
      priority: "medium",
      due_at: null,
      delivery_key: args.deliveryKey,
    },
    performed_by: args.recipient.profileId,
  });

  if (activityError) {
    throw new Error(`Failed to log todo activity: ${activityError.message}`);
  }
}

function finalStatus(results: {
  intended: number;
  delivered: number;
  skippedNoProfile: number;
  failed: number;
}): DeliveryStatus {
  if (results.intended > 0 && results.skippedNoProfile === results.intended) {
    return "no_profile";
  }
  if (results.delivered === results.intended && results.intended > 0) {
    return "sent";
  }
  if (results.delivered > 0) {
    return "partial";
  }
  return results.failed > 0 ? "failed" : "no_profile";
}

async function handleEvent(
  event: EscalationEvent,
  orgId: string,
  summary: Summary
): Promise<void> {
  if (event.target_type === "daily_brief") {
    await markEventProcessed(event.event_id, "daily_brief");
    summary.skipped += 1;
    return;
  }

  const purchaseOrderId = getPurchaseOrderId(event);
  if (!purchaseOrderId) {
    throw new Error(`Invalid purchase_order_id for event ${event.event_id}`);
  }

  const [recipientIds, po] = await Promise.all([
    resolveRecipients(event, orgId),
    fetchPurchaseOrder(orgId, purchaseOrderId),
  ]);

  const results = {
    intended: recipientIds.length,
    delivered: 0,
    skippedNoProfile: 0,
    failed: 0,
  };

  if (recipientIds.length === 0) {
    // Ownerless PO (created_by null) or empty accounts team: nothing to send.
    // Not a failure — the next policy step still fires on schedule.
    await markEventProcessed(event.event_id, "no_recipient");
    summary.skipped += 1;
    return;
  }

  for (const authUserId of recipientIds) {
    const deliveryKey = `${event.event_id}:${authUserId}`;

    try {
      const recipient = await resolveRecipient(authUserId);
      if (!recipient) {
        results.skippedNoProfile += 1;
        summary.skipped += 1;
        continue;
      }

      let messageId: string | null = null;
      try {
        messageId = await sendReminderEmail({ event, recipient, deliveryKey });
        await logEmail({
          orgId,
          po,
          recipientEmail: recipient.email,
          status: "sent",
          messageId,
          errorMessage: null,
        });
        summary.sent += 1;
      } catch (error) {
        await logEmail({
          orgId,
          po,
          recipientEmail: recipient.email,
          status: "failed",
          messageId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      await createTodo({ event, recipient, deliveryKey });
      summary.todos += 1;
      results.delivered += 1;
    } catch (error) {
      results.failed += 1;
      summary.failed += 1;
      console.error("[process-payment-escalations] Recipient delivery failed", {
        eventId: event.event_id,
        authUserId,
        error,
      });
    }
  }

  await markEventProcessed(event.event_id, finalStatus(results));
}

Deno.serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const credential = await authenticateAgent(req);
  if (!credential) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const { data, error } = await supabase.rpc("claim_escalation_events", {
    p_org_id: credential.org_id,
    p_source_types: SOURCE_TYPES,
    p_limit: 25,
  });

  if (error) {
    return jsonResponse({ success: false, error: error.message }, 400);
  }

  const events = (data ?? []) as EscalationEvent[];
  const summary: Summary = {
    claimed: events.length,
    sent: 0,
    todos: 0,
    skipped: 0,
    failed: 0,
  };

  for (const event of events) {
    try {
      await handleEvent(event, credential.org_id, summary);
    } catch (error) {
      summary.failed += 1;
      await markEventProcessed(event.event_id, "failed");
      console.error("[process-payment-escalations] Event delivery failed", {
        eventId: event.event_id,
        error,
      });
    }
  }

  return jsonResponse(summary);
});
