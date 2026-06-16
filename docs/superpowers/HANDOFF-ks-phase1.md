# Handoff — Kinetic Sketch ↔ Unity ERP integration (Phase 1, KS cutlist export)

> Paste the block below into a fresh Claude Code / Codex session. It is self-contained.

---

**LOCAL DESKTOP ONLY.** Run this only in Claude Code / Codex CLI on Greg's local machine. Do NOT run in Cloud or any remote agent — Cloud branches off `main`, not `codex/integration`, and produces stale-base divergence. Every branch referenced below is **local and unpushed**, so a remote agent literally cannot see this work.

**Continuing: Kinetic Sketch ↔ Unity ERP integration — Phase 1 (KS cutlist export).** This is a multi-session build. Read the two plan docs first; they are the source of truth:
- `~/development/unity-erp-ks-spec/docs/superpowers/plans/2026-06-15-kinetic-sketch-unity-foundation-slice.md` (v5) — overall foundation slice.
- `~/development/unity-erp-ks-spec/docs/superpowers/plans/2026-06-15-ks-phase1-cutlist-export.md` — granular Phase 1 TDD plan.

## Workflow format — KEEP EXACTLY (Greg's standing process)
- **Claude implements.** **GPT-5.5 Pro reviews PLANS** pre-implementation (Greg runs it; produce review-ready plan docs).
- **Codex runs an `xhigh` adversarial review on EVERY task**, and the **stop-time review gate is ON** (no task/phase closes without a fresh Codex review). From the KS worktree:
  `node "/Users/nadenebreedt/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs" adversarial-review --wait --scope working-tree "<skeptical focus>"`
  (The dedicated `adversarial-review` has no `--effort` flag — it already runs deep. For a forced xhigh pass use the `task --effort xhigh` read-only path.)
- **Fix-don't-defer:** fold review findings into the current slice as flagged. Only genuinely out-of-scope work is deferred. **Track deferrals in Linear — but Linear MCP was NOT connected as of 2026-06-16; until it is, deferrals live in plan §14.**
- **Per-task loop:** failing test → run (red) → implement → run (green) → Codex adversarial review → fix findings → commit. Commit only your new files; never stage Greg's WIP.

## Two repos / where everything lives (ALL LOCAL, UNPUSHED)
- **Kinetic Sketch** (standalone, separate repo): `~/Documents/Kinetic Sketch 2.0` (GitHub `MaierG74/kinetic-sketch-v2`).
  - Phase 1 code is on branch **`codex/ks-cutlist-export`** in worktree **`~/development/kinetic-sketch-phase1`** (off KS `main` @ `905deb1`).
  - ⚠️ Greg has **uncommitted WIP on KS `main`** (`src/catalog.ts`, `src/drawing.ts`) and a **pre-existing unrelated stash** (`stash@{0}` "Parallel sun draft"). **DO NOT touch either.** The worktree is clean of his WIP.
- **Unity ERP**: `~/development/unity-erp` (main checkout on `feature/roomcraft-integration`). Plan docs on **`codex/local-ks-integration-spec`** in worktree **`~/development/unity-erp-ks-spec`** (off `codex/integration`).
- Continue on the existing branches. They are not pushed — offer to push only when Greg says so.

## Architecture (locked)
- KS owns the editable design; Unity owns the **cutlist projection** + costing. Join key: `org_id (uuid) + product_id (int, stable)`; `internal_code` is display/traceability only.
- KS launches in a browser tab via a signed handoff → a **KS Supabase Edge Function verifies** (JWT alg-locked HS256 + KS session + normalized email + `ks_org_members` membership). Unity **pulls** the projection (Unity holds a read-key; each DB writes only itself; no token exchange). Two separate Supabase backends; mirrored Supabase-auth accounts. Per-org licence = a Unity entitlement module (`kinetic_sketch`).
- The cutlist export is a **pure, runtime-agnostic module** (NO React/DOM/three.js/localStorage/`node:`/`Deno.`; Web Crypto for hashing) so the same code runs in browser, Vitest, and a Deno Edge Function. Single source of truth: `supabase/functions/_shared/cutlistExport.ts`, re-exported into `src/domain/cutlistExport.ts`.

## Phase 1 — DONE (6 commits on `codex/ks-cutlist-export`; 34 vitest green; tsc clean on touched files)
- **Task 2** contract types + Zod schemas. `board_type` = lamination/thickness **class** (`'16mm'`/`'32mm-both'`/`'32mm-backer'`), NOT a material token; `material_label`+`material_thickness` carry material; `lamination_type` included.
- **Task 3** `classifyPart → {role|non-cut|unknown}` (longest-prefix, multi-word safe, unknown ≠ silently dropped).
- **Task 4** `collectOrientedParts` — mirrors `collectCutList` traversal but keeps **unsorted** `{x,y,z}` axes; aggregation key includes material colour (different finishes don't merge); path-based cycle guard (sibling instances counted).
- **Task 5** `roleGeometry` + **`UNITY_DEFAULT_PROFILE`** — **aligned to Unity's ACTIVE `lib/configurator/templates/cupboard.ts generateCupboardParts`** (Greg chose option A). Validated against REAL `buildCupboard` output by `cupboardIntegration.test.ts`. Cleats read length/width from the part **name** (correct on shallow cupboards). The convention is a swappable **`EdgingProfile`** (`roleGeometry(role, dims, { profile })`) → per-order/org overrides are a cheap future add (seam + unit test exist).

## Phase 1 — REMAINING (next, same per-task loop)
- **Task 6** material/board_type from `finish` (decor name → `material_label`; `board_type = thickness===32 ? '32mm-both' : '16mm'`; `lamination_type` accordingly). `melawoodSlug` at `src/library.ts:292`.
- **Task 7** deterministic part IDs `ks:<design_id>:<role>:<index>` — **no design_version in the id**; resolve left/right by a geometry tie-break, not traversal order; test IDs stable under shuffled input.
- **Task 8** canonical hash — `cutlist_hash = sha256(canonical_json(groups))` via Web Crypto; sort keys/groups/parts.
- **Task 9** assemble `exportCupboard(doc) → CutlistGroup[]`: collapse the laminated **Top pair → one 32mm `same-board` part**; thread the `EdgingProfile`; validate (zero/neg dims, qty≥1, present grain/band_edges, no `unknown` role) → throw `CutlistExportError`; build the 1200-cupboard **golden** fixture + invalid fixtures.
- **Task 11** Unity cross-repo import test — the golden fixture imports cleanly into `CutlistPart` / `product_cutlist_groups` shape (test lives in the unity-erp repo).
- (Task 10 orientation is already covered by the collection + integration tests.)
- Then the foundation-slice Phases 2+ (KS Supabase + `ks_org_members` RLS, handoff Edge Function, Unity launch button + sync route + atomic-replace RPC + `product_integration_sources`).

## Verification (run from `~/development/kinetic-sketch-phase1`)
- `npx vitest run` — all unit + integration tests (baseline is 34 green).
- `npx tsc --noEmit 2>&1 | grep -E "cutlistExport|domain/__tests__"` — type-check touched files (KS has pre-existing errors elsewhere; ignore those).
- Codex adversarial review per task (command above).

## Decision points / stop-and-surface to Greg
- **Shop-vs-Unity convention (OPEN):** KS now matches Unity's `generateCupboardParts` (sides banded front-only; top grain left-right). This DIFFERS from the shop convention Greg first stated (sides front+back; top grain front-to-back). Greg chose to match Unity for the demo; whether Unity's own generator is shop-correct is an unresolved follow-up — surface it, don't silently re-decide. The `EdgingProfile` override is the mechanism to set the real rule per-order later.
- **Per-order edging override wiring** (contract field + assembly threading + merge) — deferred feature; the profile seam is in.
- **Demo target: Thursday 2026-06-18.** The browser-testable round-trip (open KS from a Unity product → design → sync → cutlist → cost) is the foundation-slice goal; Phase 1 (export) is the spine under it. There is NO clickable demo yet — Phase 1 is a pure module verified by tests.
- **Migration discipline** (later Unity-side tasks): any DDL (`product_integration_sources`, atomic-replace RPC) needs the migration file + `apply_migration` + `list_migrations` reconcile + `docs/operations/migration-status.md` update. The replace RPC MUST `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + use an advisory lock (Codex critical/high findings).
- **No wage-table writes**; prefer pure unit tests over live-DB fixtures.

**First action:** read the two plan docs, run `npx vitest run` to confirm the 34-green baseline, then start **Task 6** with the per-task loop (TDD → Codex `xhigh` review → commit).
