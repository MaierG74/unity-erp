// agent_action_log helpers — start/finish + idempotency-key replay detection.
//
// Lifecycle:
//   1. startAction()  — INSERT a row with request_payload. If idempotency_key
//      is provided and matches an existing row (Postgres 23505 on the partial-
//      unique on (org_id, idempotency_key) WHERE NOT NULL), the row is
//      treated as a replay: caller skips the RPC and returns the cached
//      result_payload + error_message.
//   2. finishAction() — UPDATE the row with result_status / result_payload /
//      error_message after the RPC returns (or fails).
//
// Race note: if two concurrent requests share an idempotency_key, the loser's
// startAction() returns isReplay=true with whatever's currently in the row —
// which may still be the default ('ok' / empty payload) if the winner's RPC
// hasn't completed yet. v1 accepts this; the common case is a network retry
// where the winner long ago finished.

import type { PostgrestError } from "jsr:@supabase/supabase-js@2";
import { supabase } from "./supabase-client.ts";

export type ActionKind =
  | "read"
  | "reason"
  | "proposal"
  | "message"
  | "approved_write"
  | "rejected_write"
  | "error"
  | "dry_run"
  | "observation";

export type ResultStatus = "ok" | "skipped" | "failed" | "blocked";

export interface StartActionInput {
  org_id: string;
  agent_id: string;
  capability: string;
  action_kind: ActionKind;
  target_type?: string | null;
  target_id?: string | null;
  closure_item_id?: string | null;
  idempotency_key?: string | null;
  request_summary?: string | null;
  request_payload: Record<string, unknown>;
}

export interface ReplayResult {
  result_status: ResultStatus;
  result_summary: string | null;
  result_payload: Record<string, unknown>;
  error_message: string | null;
}

export interface ActionLogRow {
  id: string;
  isReplay: boolean;
  replayResult?: ReplayResult;
}

export async function startAction(input: StartActionInput): Promise<ActionLogRow> {
  const insertResult = await supabase
    .from("agent_action_log")
    .insert({
      org_id: input.org_id,
      agent_id: input.agent_id,
      capability: input.capability,
      action_kind: input.action_kind,
      target_type: input.target_type ?? null,
      target_id: input.target_id ?? null,
      closure_item_id: input.closure_item_id ?? null,
      idempotency_key: input.idempotency_key ?? null,
      request_summary: input.request_summary ?? null,
      request_payload: input.request_payload,
    })
    .select("id")
    .single();

  if (!insertResult.error && insertResult.data) {
    return { id: insertResult.data.id, isReplay: false };
  }

  // Distinguish duplicate-idempotency-key from real error.
  const err = insertResult.error as PostgrestError | null;
  if (err?.code === "23505" && input.idempotency_key) {
    const existing = await supabase
      .from("agent_action_log")
      .select("id, result_status, result_summary, result_payload, error_message")
      .eq("org_id", input.org_id)
      .eq("idempotency_key", input.idempotency_key)
      .single();

    if (!existing.error && existing.data) {
      return {
        id: existing.data.id as string,
        isReplay: true,
        replayResult: {
          result_status: existing.data.result_status as ResultStatus,
          result_summary: (existing.data.result_summary as string | null) ?? null,
          result_payload:
            (existing.data.result_payload as Record<string, unknown>) ?? {},
          error_message: (existing.data.error_message as string | null) ?? null,
        },
      };
    }
  }

  throw insertResult.error;
}

export interface FinishActionOk {
  ok: true;
  result_summary?: string | null;
  result_payload?: Record<string, unknown>;
  closure_item_id?: string | null;
}

export interface FinishActionFail {
  ok: false;
  status: Exclude<ResultStatus, "ok">;
  result_summary?: string | null;
  error_message: string;
}

export type FinishActionInput = FinishActionOk | FinishActionFail;

export async function finishAction(id: string, outcome: FinishActionInput): Promise<void> {
  if (outcome.ok) {
    await supabase
      .from("agent_action_log")
      .update({
        result_status: "ok",
        result_summary: outcome.result_summary ?? null,
        result_payload: outcome.result_payload ?? {},
        ...(outcome.closure_item_id !== undefined
          ? { closure_item_id: outcome.closure_item_id }
          : {}),
      })
      .eq("id", id);
  } else {
    await supabase
      .from("agent_action_log")
      .update({
        result_status: outcome.status,
        result_summary: outcome.result_summary ?? null,
        error_message: outcome.error_message,
      })
      .eq("id", id);
  }
}
