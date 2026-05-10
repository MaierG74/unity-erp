// agent-closure-rpc — single Edge Function that wraps the 9 closure-engine
// RPCs (POL-109) with bearer-token auth, agent_action_log idempotency, and
// org-scoping.
//
// Request:
//   POST /functions/v1/agent-closure-rpc
//   Authorization: Bearer <agent api key>
//   Content-Type: application/json
//   {
//     "method":          "register_closure_item" | "record_closure_observation" |
//                        "assign_closure_item"   | "set_closure_status"         |
//                        "pause_closure_sla"     | "resume_closure_sla"         |
//                        "close_closure_item"    | "escalate_due_closure_items" |
//                        "get_daily_closure_brief",
//     "capability":      "<string>",          // required, stamped onto agent_action_log.capability
//     "params":          { ... },             // RPC params; p_org_id is overridden by caller's credential
//     "idempotency_key": "<string>",          // optional; replay-safe via partial-unique
//     "summary":         "<string>"           // optional; stamped onto agent_action_log.request_summary
//   }
//
// Response (success):
//   { "success": true, "data": <rpc-return>, "action_log_id": "<uuid>", "replay": false }
//
// Response (idempotent replay):
//   { "success": true|false, "data": <cached>, "action_log_id": "<uuid>", "replay": true,
//     "error": "<cached error_message if any>" }
//
// Response (failure):
//   { "success": false, "error": "<message>", "action_log_id": "<uuid>" }
//
// Wrapper invariants:
//   - p_org_id is ALWAYS forced to the credential's org_id (caller cannot override).
//   - Actor params (p_*_by_agent_id, p_*_by_user_id) are passed through verbatim
//     from the caller; the wrapper does NOT auto-inject agent_id, because the
//     caller may be recording an action on behalf of a human (e.g. Telegram approval).
//   - target_type / target_id / closure_item_id are extracted from params for the
//     audit row when present, but never injected into the RPC call.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { authenticateAgent } from "../_shared/agent-auth.ts";
import { supabase } from "../_shared/supabase-client.ts";
import {
  ActionKind,
  finishAction,
  startAction,
} from "../_shared/agent-action-log.ts";

interface RpcConfig {
  action_kind: ActionKind;
  // RPC params that, when provided, indicate which closure_item this action
  // touches. Used to populate agent_action_log.closure_item_id for indexing.
  closure_item_param?: string;
}

const RPC_CONFIG: Record<string, RpcConfig> = {
  register_closure_item: { action_kind: "approved_write" },
  record_closure_observation: {
    action_kind: "observation",
    closure_item_param: "p_closure_item_id",
  },
  assign_closure_item: {
    action_kind: "approved_write",
    closure_item_param: "p_closure_item_id",
  },
  set_closure_status: {
    action_kind: "approved_write",
    closure_item_param: "p_closure_item_id",
  },
  pause_closure_sla: {
    action_kind: "approved_write",
    closure_item_param: "p_closure_item_id",
  },
  resume_closure_sla: {
    action_kind: "approved_write",
    closure_item_param: "p_closure_item_id",
  },
  close_closure_item: {
    action_kind: "approved_write",
    closure_item_param: "p_closure_item_id",
  },
  escalate_due_closure_items: { action_kind: "reason" },
  get_daily_closure_brief: { action_kind: "read" },
};

interface RequestBody {
  method?: string;
  capability?: string;
  params?: Record<string, unknown>;
  idempotency_key?: string;
  summary?: string;
}

Deno.serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  // 1. Authenticate.
  const credential = await authenticateAgent(req);
  if (!credential) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  // 2. Parse body.
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const method = body.method;
  const config = method ? RPC_CONFIG[method] : undefined;
  if (!method || !config) {
    return jsonResponse(
      {
        success: false,
        error: `Unknown method: ${method ?? "(missing)"}. Supported: ${Object.keys(RPC_CONFIG).join(", ")}`,
      },
      400
    );
  }

  if (!body.capability || typeof body.capability !== "string") {
    return jsonResponse(
      { success: false, error: "capability is required (string)" },
      400
    );
  }

  // 3. Build RPC params. Caller's params are passed through; p_org_id is
  //    forced from the credential. This is the security boundary.
  const callerParams = body.params ?? {};
  const rpcParams: Record<string, unknown> = {
    ...callerParams,
    p_org_id: credential.org_id,
  };

  const closureItemId =
    config.closure_item_param &&
    typeof callerParams[config.closure_item_param] === "string"
      ? (callerParams[config.closure_item_param] as string)
      : null;

  // 4. Start the action_log row. If idempotent replay, return cached result
  //    without calling the RPC.
  let logRow;
  try {
    logRow = await startAction({
      org_id: credential.org_id,
      agent_id: credential.agent_id,
      capability: body.capability,
      action_kind: config.action_kind,
      target_type: "closure_engine_rpc",
      target_id: method,
      closure_item_id: closureItemId,
      idempotency_key: body.idempotency_key ?? null,
      request_summary: body.summary ?? null,
      request_payload: { method, params: callerParams },
    });
  } catch (e) {
    return jsonResponse(
      {
        success: false,
        error: `Failed to record action: ${e instanceof Error ? e.message : String(e)}`,
      },
      500
    );
  }

  if (logRow.isReplay && logRow.replayResult) {
    const r = logRow.replayResult;
    return jsonResponse({
      success: r.result_status === "ok",
      data: r.result_payload,
      error: r.error_message ?? undefined,
      action_log_id: logRow.id,
      replay: true,
    });
  }

  // 5. Call the RPC.
  const { data, error } = await supabase.rpc(method, rpcParams);

  if (error) {
    await finishAction(logRow.id, {
      ok: false,
      status: "failed",
      error_message: error.message,
      result_summary: error.code ? `pg_error_code=${error.code}` : null,
    });
    return jsonResponse(
      {
        success: false,
        error: error.message,
        action_log_id: logRow.id,
        replay: false,
      },
      400
    );
  }

  // 6. Wrap RPC return value. SQL RPCs that return scalars (uuid, integer)
  //    come back as the raw value; jsonb comes back as an object. Wrap
  //    everything in { value } so the action_log_payload shape is consistent.
  const resultPayload =
    data === null || data === undefined
      ? {}
      : typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { value: data };

  // For register_closure_item, the RPC returns the new closure_item_id (uuid).
  // Capture it onto the action_log row so the closure_item_id index covers it.
  const registeredClosureItemId =
    method === "register_closure_item" && typeof data === "string" ? data : null;

  await finishAction(logRow.id, {
    ok: true,
    result_payload: resultPayload,
    closure_item_id: registeredClosureItemId ?? closureItemId ?? null,
  });

  return jsonResponse({
    success: true,
    data,
    action_log_id: logRow.id,
    replay: false,
  });
});
