# Purchasing Agent — Aims

**Status:** Active. QButton trial begins approximately 14 days from 2026-05-07.
**Owner:** Greg Maier (Polygon).
**Companion docs:**
- `docs/pitch/output/Purchasing Agent.pdf` — what we sold (the offer)
- `docs/pitch/output/Agent Overview.pdf` — broader sales overview
- `docs/pitch/nervous-system-positioning.md` — internal strategy / brand voice
- `docs/technical/openclaw-agent-architecture.md` — current Matt POC architecture

## Context

The Purchasing Agent has been sold to QButton (existing POC client, furniture manufacturer). Pricing: R600/week, first month at no charge, no setup fee, month-to-month, cancel anytime. The first-month-free trial means the agent must be **production-ready from day 1 of the trial** — not "we iterate during the month."

This is the first sellable agent built on the OpenClaw runtime. Its success defines whether other agents (Inter-Site Transfer, Production Exception Triage, Daily Control-Tower Brief) ship in subsequent quarters.

## Primary aim

Ship a working Purchasing Agent for QButton within **30 days** that delivers on all five capabilities promised in the *Purchasing Agent* pamphlet, and demonstrably catches at least one real ball that would otherwise have dropped.

## The five capabilities (the contract)

1. **Stock shortfall detection** — for each open customer order, compute BOM × current stock × open-PO arrivals × supplier lead times. Surface "this order won't ship by [date] unless [item] is ordered today."
2. **PO drafting** — for each shortfall, suggest a supplier (history-ranked), draft a purchase order with quantities and expected delivery. Buyer reviews and approves; agent never auto-submits.
3. **Delivery-note OCR + match** — Telegram photo → extract line items → match against open POs → book clean lines, open closure-engine items on mismatches (short / over / wrong-revision). Builds on the existing Matt skill that caught the four oak boards on PO Q26-395.
4. **Stock issue tracking** — watch issuances from store to job. Flag discrepancies (over-issued, under-issued vs. BOM).
5. **Inventory reconciliation** — periodic stock counts via Telegram photo. Compare counted vs. system. Detect drift over weeks. Surface patterns ("J389 keeps coming up short").

## Architectural aims

- Extends the existing OpenClaw runtime on `ocmac-air` (M1 MacBook Air). Does **not** fork or rewrite Matt.
- Uses the existing Supabase MCP as the data plane (already configured, project-scoped to QButton via `mcporter`).
- Built on the **closure engine primitive** (Linear `POL-100`). Every agent-tracked item lives there: owner, age, SLA, escalation policy, closure note.
- Telegram-first interaction. Dashboard surfacing in Unity ERP is phase 2 (`POL-106`).
- Every agent action is auditable — logged, append-only, auto-resolves when conditions clear.
- LLM routing: GPT-5.5 for reasoning, Gemini 3 Flash for vision/OCR, GPT-5.4 Mini for light/heartbeat tasks. Local Gemma is a future margin lever, not a v1 dependency.

## Constraints

- Must work alongside Unity ERP, never replace it. Buyer screens stay where they are; the agent adds a layer on top.
- No autonomous writes that bypass human approval. The agent drafts, escalates, surfaces — humans decide.
- "Considered messaging" principle (see positioning doc): silent unless something is genuinely actionable. Spam kills the product; one ignored message destroys trust permanently.
- Plaintext secrets currently in `~/.openclaw/openclaw.json` (Telegram bot token, Supabase service-role key, Groq, Resend agent key) **must be cleaned up** before live customer data flows through this agent in production.
- 30 days. Real customer is waiting.

## Success criteria

| Horizon | Criterion |
|---|---|
| **Day 30** | Agent runs daily. Surfaces real items from real QButton data. Books real receipts via Telegram OCR. Daily morning brief lands in the buyer's Telegram before 07:00 SAST. Zero spurious messages in the past 7 days. |
| **End of trial month** | QButton chooses to continue at R600/week. |
| **Day 90** | At least one previously-undetected loss caught and quantified — order of magnitude R5,000+. |

## Non-goals (explicit)

- The other three pilot agents (Inter-Site Transfer, Production Exception Triage, Daily Control-Tower Brief). Phase 2.
- Replacing the existing Unity ERP purchasing screens.
- Multi-tenant scaling. Single-customer pilot only; multi-tenant generalisation comes after.
- A full Unity ERP dashboard panel for the agent (per `POL-106` — phase 2 architecturally).

## Pre-requisites and known dependencies

- **Closure engine (`POL-100`)** — must be built before or in parallel with the agent. Without it, the agent has nowhere to register tracked items.
- **OpenClaw upgrade** — already on `2026.5.6` (current latest). No action needed for now.
- **Secrets cleanup on `ocmac-air`** — must be done before going live. See "Constraints" above.
- **Test data safety** — pilot writes to QButton's real Supabase project. A staged approach (read-only first, then dry-run writes, then live writes behind feature flags) is required. Synthetic data must not pollute the customer's wage tables (recurring constraint per `feedback_no_synthetic_wage_data_in_live_db.md`).

## References

- Linear: `POL-100` (closure engine, blocker), `POL-101` (Receiving & PO Match — the largest single piece of this agent), `POL-106` (personal agents, phase 2)
- Architecture: `docs/technical/openclaw-agent-architecture.md`
- Brand voice: `docs/pitch/nervous-system-positioning.md`
- The pitch as sold: `docs/pitch/output/Purchasing Agent.pdf`
