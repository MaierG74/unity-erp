# Kinetic Sketch ↔ Unity ERP — Foundation Slice: Design & Implementation Plan

> **Status:** Revised **v2** after GPT-5.5 Pro plan review. Verdict was APPROVE-WITH-REVISIONS; this version folds the safety-critical findings into the slice and defers production-hardening. Next step: expand approved phases into granular TDD task lists.
> **For agentic workers:** Each phase in §10 is expanded into a granular `superpowers:writing-plans` task list (failing test → run → implement → pass → commit) before Codex implements it.

**Date:** 2026-06-15 (v2 same day) · **Demo target:** Thursday 2026-06-18
**Author:** Claude (brainstormed with Greg) · **Reviewer:** GPT-5.5 Pro
**Branch:** `codex/local-ks-integration-spec` (off `codex/integration`)
**Repos touched:** `unity-erp` (Next.js ERP) + `Kinetic Sketch 2.0` (Vite/React/three.js)

### v2 changelog (what the review changed)
1. **Handoff verification moved server-side** (KS Supabase **Edge Function**) — a Vite SPA cannot hold the HS256 secret. *(Critical fix.)*
2. **Enriched, calibrated JWT claims** (`aud`, `iat`, `nbf`, `jti`, `product_id` as **integer**, `contract_version`, `schema_version`, allowlisted `return`, `trace_id`).
3. **Cutlist export promoted to the core** of the slice and made a **pure, server-compatible module** with a fixture matrix; export semantics pinned against verified Unity behaviour.
4. **Unity import made safe**: server-derives all identity, verifies the response matches the product, **atomic replace via Postgres RPC + previous-snapshot**, and records **source metadata** (`product_integration_sources`).
5. **KS security**: RLS via `ks_org_members` (not email), wrong-account handling, `DesignStore` abstraction to preserve standalone, design-doc versioning.
6. **Costing dependency surfaced**: step 4 needs a priced Unity material mapped from KS `board_type`.
7. A clearly separated **§14 Deferred (production hardening / next increments)** so the 3-day slice stays lean.

---

## Goal

A **real, end-to-end vertical slice**:

> **Create a product in Unity → design it in Kinetic Sketch → its cutlist syncs back into Unity → Unity costs the product.**

Two products that **stand alone** (each its own Supabase backend, KS sellable independently), joined by a shared **product code**. This is the spine; the visually striking pieces (render-from-quote, two-tone melamine) are deferred and ride on top of it.

## Architecture (in three sentences)

KS is the **system of record for the editable design**; Unity is the **system of record for the product and its derived manufacturing data** (the *cutlist projection*, drawing, costing); the two are joined by `org_id (uuid) + product_id (int)` with `internal_code` as the human-readable code. Unity (server-side) mints a short-lived signed handoff JWT, opens KS in a tab, and a **KS Edge Function verifies the token** before the SPA opens the design; later Unity **pulls** the cutlist projection back through that Edge Function (each database only writes itself — no cross-platform token exchange). The integration is one generic capability contract (`{mode, context, product_code, overrides, return}`); this slice implements only the `design` verb.

## Tech Stack

- **Unity ERP:** Next.js 16 (App Router), React 18, TS, Supabase (Postgres+Auth+Storage+RLS), TanStack Query, Tailwind v4 / shadcn v4. `product_id` is **integer serial**; `org_id` is **uuid**.
- **Kinetic Sketch:** Vite 6, React 18, TS, three.js + three-gpu-pathtracer; currently localStorage-only.
- **New for KS:** Supabase (Auth + Postgres + RLS + **Edge Functions**) — greenfield.
- **Cross-system:** HS256 handoff JWT (verified in a KS Edge Function) + a read-key (constant-time compared), both **server-side only**. Runtime validation via Zod on both sides.

---

## 1. Guiding Principles

1. **Plug-in, not merge.** KS stays a standalone, sellable product (must run with no Unity, via a local `DesignStore`).
2. **Split source of truth.** KS owns the editable design; Unity owns the **cutlist *projection*** + costing. The projection is a synced snapshot — *never edited in Unity as if it were the design*.
3. **Join key:** `org_id (uuid)` + `product_id (int, stable)`; `internal_code` is the human-readable code carried alongside (it is editable and only **app-enforced** unique — never treat it as a guaranteed-unique DB key).
4. **Licence = per-org module entitlement** (new `kinetic_sketch` "sellable add-on").
5. **Identity:** mirrored Supabase-auth accounts; **authorization is via `ks_org_members`, not email**. Email claim is only for "wrong account" detection + audit. No SSO / no token exchange.
6. **Secrets never reach a browser.** Handoff verification + read-key checks happen in server surfaces (Unity API routes; KS Edge Functions).
7. **Unity pulls**, explicitly. Opening KS ≠ changing manufacturing data; syncing is a separate, logged action.
8. **Reusable contract, single surface.** Implement the `design` verb; leave `render`/`quote` modes as declared-but-unbuilt.

## 2. Scope

### In scope (Thursday) — the revised minimum slice
1. Shared **contract + Zod runtime schemas** (both repos).
2. **Pure** KS `design → CutlistGroup[]` export with a **1200-cupboard fixture** (the highest-risk, highest-value piece — built first).
3. KS Supabase: `ks_designs` + `ks_org_members` + RLS + `DesignStore` (Supabase impl alongside the existing local impl).
4. KS **Edge Function** verifies the Unity handoff token; SPA opens the design only after success (+ wrong-account handling).
5. Unity **server-side** signed-handoff route (derives all identity from `productId`) + "Design in Kinetic Sketch" button.
6. KS **Edge Function read endpoint** returns a **validated** cutlist projection.
7. Unity **sync route**: verify-matches-product → **atomic replace (Postgres RPC) + previous snapshot** → record `product_integration_sources`.
8. Product page: **Design** / **Sync** / **last-synced** status / **costing** result (with a pre-seeded priced board so a real number appears).

### Out of scope → see §14
Render/two-tone overrides; two-way sync; one-time handoff codes; read-key HMAC/rotation; provider-abstraction framework; BOM/CNC; sync diff-preview; rich edge-banding metadata.

## 3. End-to-End Flow

| # | Step | Where | Mechanics |
|---|------|-------|-----------|
| 1 | **Create product** | Unity | Product exists with `product_id` (int) + `internal_code`. *Already works.* |
| 2 | **Design in KS** | Unity → KS | Button → Unity server route (derives `org_id`, `product_id`, `internal_code` from `productId`; checks entitlement + permissions) mints a short-lived signed JWT, opens `KS_APP_URL/handoff?token=…` (`Referrer-Policy: no-referrer`). KS SPA posts the token to the **KS Edge Function `/handoff-verify`**, which checks signature/`exp`/`nbf`/`aud`/`iss`. On success the SPA requires KS login, confirms the session email matches the claim (else "wrong account"), and opens/creates the design for `(org_id, product_id)`. Save → `ks_designs` via `DesignStore`. |
| 3 | **Cutlist back** | Unity ← KS | "Sync from Kinetic Sketch" → Unity server route → KS Edge Function `GET /v1/cutlist?org_id=…&product_id=…` with `X-KS-Read-Key`. Edge Function runs the **pure export**, **validates** it, returns the projection (with `cutlist_hash`, `schema_version`, `warnings[]`). Unity verifies `product_id`/`org_id` match, then **atomically replaces** `product_cutlist_groups` (snapshotting the prior set) and records `product_integration_sources`. |
| 4 | **Cost** | Unity | Synced parts carry `board_type` + `material_label` + `thickness`; the sync maps `board_type` → a **pre-seeded priced Unity board material/component** so the Cutlist Builder / costing snapshot yields a real number. |

## 4. The Integration Contract (generic, reusable)

**Handoff JWT** (HS256, minted in Unity server, verified in KS Edge Function):
```jsonc
{
  "iss": "unity", "aud": "kinetic-sketch",
  "sub": "unity-product:<product_id>",
  "org_id": "<uuid>",
  "product_id": 1234,                 // Unity integer PK (stable join key)
  "product_code": "<internal_code>",  // human-readable, editable
  "mode": "design",                   // future: "render" | "quote"
  "context": { "source": "unity", "entity": "product" },
  "overrides": {},                     // future: { finishes: { carcass, doors } }
  "return": { "url": "<allowlisted Unity URL>", "label": "Back to Unity" },
  "contract_version": 1, "schema_version": 1,
  "iat": 0, "nbf": 0, "exp": 0,        // exp ≤ 5 min
  "jti": "<uuid>",                     // logged; replay-store deferred (§14)
  "trace_id": "<uuid>",               // same id logged in both systems
  "unity_user_email": "<email>"        // wrong-account detection only
}
```

**Read (pull)** — query-param shape (codes may contain `/`, spaces, `#`):
```
GET {KS_EDGE_URL}/v1/cutlist?org_id=<uuid>&product_id=<int>
Header: X-KS-Read-Key: <secret>      # constant-time compared
200 → CutlistPullResponse            # validated by Zod before return
401 → bad/missing key
404 → no design for (org_id, product_id)
409 → design exists but is not a valid manufacturing cutlist
```

**`CutlistPullResponse`:**
```jsonc
{
  "schema_version": 1,
  "org_id": "<uuid>", "product_id": 1234, "product_code": "CAB-1200",
  "design_id": "<uuid>", "design_version": 8,
  "generated_at": "<iso>", "cutlist_hash": "sha256:…",
  "warnings": [{ "code": "MISSING_EDGE_RULE", "message": "…" }],
  "groups": [ { "name": "…", "board_type": "16mm", "sort_order": 0, "parts": [ /* CutlistPart[] */ ] } ]
}
```

**`CutlistPart`** (canonical in Unity `lib/cutlist/types.ts`; KS mirrors + Zod-validates):
`{ id, name, length_mm, width_mm, quantity, grain: 'any'|'length'|'width', band_edges:{top,right,bottom,left:boolean}, material_label?, material_thickness?, board_type? }`

Both sides validate with Zod at the boundary (KS validates outgoing export; Unity validates the incoming response — never blindly writes).

## 5. Cutlist Export — the core of the slice

A **pure** module `src/domain/cutlistExport.ts` in KS: **no React, DOM, three.js render, or localStorage imports**, so it runs identically in the browser, in unit tests, and in the Edge Function read endpoint.

**Verified Unity semantics the export must honour** (from `lib/cutlist/types.ts`, `guillotinePacker.ts`, `boardCalculator.ts`):
- `length_mm` = sheet **Y** axis; `width_mm` = sheet **X** axis. **No `length >= width` requirement.**
- `grain:'length'` → placed unrotated; `'width'` → rotated 90°; `'any'` → optimizer chooses. The producer must set `grain` whenever orientation matters.
- Edge banding: `top`/`bottom` ↔ `length_mm` edges; `left`/`right` ↔ `width_mm` edges.

**Rules:**
- **Role-driven, not name-driven.** Each `PieceRecipe` panel carries a `role` (`left_side`, `right_side`, `top`, `bottom`, `back`, `shelf`, `door_left`, `door_right`, `toe_kick`, `rail`); `grain` and `band_edges` derive from `role` + dimensions, never from `name.includes("Door")`.
- **Stable, deterministic IDs:** `ks:<design_id>:<design_version>:<role>:<index>` (no random IDs per export → clean diffs/debugging).
- **Validation before return** (else `409`): no negative/zero dimensions, non-zero quantity, name present, `grain` + `band_edges` present, known thickness, non-empty groups.
- **Material (minimal):** emit `board_type` + `material_label` + `material_thickness`; Unity maps `board_type` → a default priced material (§6). Full `ks_material_key` mapping is §14.
- **Fixture matrix:** the 1200-cupboard fixture exercises every role with expected `{dimensions, quantity, grain, band_edges, material/thickness, group}`, checked in `fixtures/ks/1200-cupboard.{design,expected-cutlist}.json` shared by both repos' contract tests (§10 Phase 1).

## 6. Data Ownership & Unity Import Safety

- **Naming:** the synced data is the **cutlist projection**, not the design. Code/comments/UI say so.
- **Source metadata** — new additive table (off-by-default safe):
  ```sql
  product_integration_sources (
    id uuid pk default gen_random_uuid(),
    org_id uuid not null, product_id int not null,
    provider text not null default 'kinetic_sketch',
    external_org_id uuid, external_product_code text, external_design_id uuid,
    last_synced_design_version int, last_synced_cutlist_hash text,
    last_synced_at timestamptz, last_synced_by uuid,
    last_sync_status text, last_sync_error text,
    previous_groups_snapshot jsonb,          -- reversibility for the slice
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (org_id, product_id, provider)
  )
  ```
- **Atomic replace.** Verified: Unity's current `product_cutlist_groups` replace is **non-atomic** (delete-then-insert, no transaction). The sync route must call a new **Postgres RPC** `replace_product_cutlist_groups(p_org_id, p_product_id, p_groups jsonb)` that deletes + inserts in one transaction, and snapshots the prior set into `product_integration_sources.previous_groups_snapshot` first.
- **Verify-then-write.** Reject the sync if `response.product_id`/`org_id` ≠ expected, or if `cutlist_hash` is unchanged (skip rewrite), or if Zod validation fails.
- **Costing dependency (verified).** The costing snapshot is built in the Cutlist Builder from material assignments; a cost needs a Unity material/component with a price. For the demo, **pre-seed one priced board material** and have the sync map KS `board_type` → it, so step 4 shows a real number. (`material_id`/`component_id` mapping table is §14.)
- **UI:** a "Kinetic Sketch" panel on the product page — design status (found/not found), last-synced version + time, "KS has newer changes" when `design_version` advanced, **Design** vs **Sync** as distinct actions.

## 7. KS Backend & Security

- `ks_designs (id uuid pk, org_id uuid, product_id int, owner_user uuid, external_system text default 'unity', external_org_id uuid, document jsonb, cutlist jsonb, doc_version int, design_version int, units text default 'mm', created_at, updated_at, unique(org_id, product_id))`. Document JSON is **versioned** (`doc_version`, `app_version`, `units`) — never store unversioned arbitrary JSON Unity will depend on.
- `ks_org_members (org_id uuid, user_id uuid references auth.users, role text, primary key(org_id, user_id))`.
- **RLS:** a user may select/insert/update a `ks_designs` row only where they are a member of that `org_id` (via `ks_org_members`) — *not* by matching email. The read endpoint uses the service role gated by the read-key + `(org_id, product_id)` filter.
- **Wrong-account handling:** if the handoff email claim ≠ the logged-in KS session email, show "You're signed into KS as X; sign in as Y or relaunch from Unity."
- **`DesignStore` interface** (`load/save(key)`), with `LocalStorageDesignStore` (standalone) and `SupabaseDesignStore` (Unity path) — preserves principle #1.
- **Optimistic concurrency (minimal):** `design_version` bumped on save; last-write-wins tolerated for the demo, but the column exists for the future conflict UI (§14).

## 8. Unity Integration & Security

- **New module key** `kinetic_sketch` (do **not** reuse `furniture_configurator`; different pricing/rollout/support). Seeded disabled (additive migration).
- **Client sends only `{ productId }`.** The server route derives `org_id`, `product_id`, `internal_code`, return URL, and checks: authenticated, org member, may edit the product, module enabled, product belongs to org, has `internal_code`. **UI gating is not authorization.**
- **Server-only secrets:** `import "server-only"` in `lib/integrations/ks/*`; no `NEXT_PUBLIC_` for secrets. Env: `KS_APP_URL`, `KS_EDGE_URL`, `KS_HANDOFF_SECRET`, `KS_READ_KEY`.
- **Sync route** uses the §6 RPC + snapshot + metadata, and a shared `trace_id` logged on both sides.

## 9. File / Component Map

**Kinetic Sketch (`Kinetic Sketch 2.0/`)**
- `src/domain/cutlistExport.ts` — pure export (§5). `src/domain/__tests__/cutlistExport.test.ts` + `fixtures/ks/1200-cupboard.*`.
- `src/backend/supabaseClient.ts`, `src/backend/designStore.{ts,local.ts,supabase.ts}`.
- `supabase/migrations/0001_ks_designs.sql` (+ `ks_org_members`, RLS).
- `supabase/functions/handoff-verify/index.ts` — verifies JWT (holds `KS_HANDOFF_SECRET`).
- `supabase/functions/cutlist/index.ts` — read endpoint (holds `KS_READ_KEY`; runs pure export + validation).
- `src/integration/handoffClient.ts` — SPA side: post token to `/handoff-verify`, then open design.

**Unity ERP (`unity-erp/`)**
- `lib/modules/keys.ts` (+ `KINETIC_SKETCH`); `supabase/migrations/<ts>_ks_module_catalog.sql`.
- `supabase/migrations/<ts>_product_integration_sources.sql`; `supabase/migrations/<ts>_replace_product_cutlist_groups_rpc.sql`.
- `lib/integrations/ks/{handoff,client,schemas}.ts` (`import "server-only"`; Zod schemas).
- `app/api/integrations/ks/handoff/route.ts` (POST, server-signs); `app/api/products/[productId]/sync-from-ks/route.ts` (POST, pull+verify+RPC+metadata).
- Product page: KS panel (Design / Sync / last-synced / costing), gated by `useModuleAccess` **and** server checks.

## 10. Phased Workstreams (reordered: export first)

> Each produces working, testable software. Granular TDD steps generated per phase before Codex implements.

- **Phase 0 — Contract & Zod schemas (shared):** JWT claims, `CutlistPullResponse`, `CutlistPart`; sign-in-Unity / verify-in-Edge-Function round-trip test. *AC:* schemas compile + validate in both repos; tampered/expired token rejected.
- **Phase 1 — Pure cutlist export + fixture (KS):** `cutlistExport.ts` + 1200-cupboard fixture matrix; **also** a Unity-side test importing `expected-cutlist.json` into `product_cutlist_groups`. *AC:* KS `design→export` equals the fixture; Unity imports it cleanly. *(Riskiest claim proven first.)*
- **Phase 2 — KS persistence + RLS:** `ks_designs` + `ks_org_members` + RLS + `DesignStore`. *AC:* a member saves/reloads by `(org_id, product_id)`; a non-member is denied.
- **Phase 3 — KS handoff Edge Function:** verify signature/exp/nbf/aud/iss; SPA opens design only on success; wrong-account path. *AC:* Unity-signed token opens the right design; tampered/expired/wrong-aud rejected.
- **Phase 4 — Unity launch:** module gate + server-derived signed-handoff route + button. *AC:* opens KS to the right product; disabled when module off; client cannot inject `org_id`/`product_code`.
- **Phase 5 — KS read endpoint:** `/v1/cutlist` with read-key (constant-time), validation, 200/401/404/409. *AC:* correct key → validated projection; bad key → 401; unknown → 404; invalid design → 409.
- **Phase 6 — Unity sync + cost:** verify-matches → RPC atomic replace + snapshot + metadata; map `board_type` → pre-seeded priced material; costing yields a number; last-synced UI. *AC:* full create→design→sync→cost works; a forced insert-failure leaves the prior cutlist intact (atomicity).
- **Phase 7 — Demo prep:** pre-seed org, product, KS membership, KS demo user (**pre-logged-in**), priced board material, module entitlement; rehearse; record a fallback that still exercises a **real** sync.

## 11. Acceptance Criteria

1. "Design in Kinetic Sketch" opens KS focused on the product; design persists in KS keyed by `(org_id, product_id)`.
2. "Sync from Kinetic Sketch" replaces `product_cutlist_groups` **atomically** with parts carrying correct `grain` + `band_edges`; prior set is snapshotted.
3. Cutlist Builder shows the synced projection; costing yields a **real material cost** (pre-seeded priced board).
4. **KS still runs fully standalone** (local `DesignStore`, no Unity).
5. Off by default for all other orgs; client cannot drive identity; secrets never reach the browser.

## 12. Verification Commands

- **Unity:** `npm run lint`; `npx tsc --noEmit` (touched areas); Supabase security advisors for new RLS/RPC.
- **KS:** build + lint; export unit tests; a script signing a token (Unity secret) → `/handoff-verify`; read-endpoint calls with/without key.
- **Contract:** shared-fixture tests in both repos.
- **Manual:** end-to-end click-through via preview; screenshot each step.

## 13. Resolved Decision Points

| # | Decision |
|---|----------|
| Module key | **New `kinetic_sketch`** (not reuse `furniture_configurator`). |
| `org_id` across projects | **Reuse Unity org UUID** in KS; keep `external_system`/`external_org_id` columns for the future. |
| Read endpoint host | **Supabase Edge Function** (same stack, fewer surfaces). |
| Pull trigger | **Explicit "Sync"** (safer; matches manufacturing control). |
| KS auth (slice) | **Require KS login** + `ks_org_members` checks; pre-login the demo account. |
| grain/band_edges | **Pure module + fixture matrix**, role-driven; semantics pinned to verified Unity behaviour (§5). |
| Secrets (slice) | `KS_HANDOFF_SECRET` + `KS_READ_KEY`, **server-side only**, constant-time read-key compare. |
| Stable link | **`product_id` (int)** is the stable join key; `internal_code` carried alongside. |

## 14. Deferred — Production Hardening & Next Increments

*Correct, but intentionally out of the 3-day slice.*
- **Handoff:** one-time handoff code instead of JWT-in-URL; `jti` replay store (5-min).
- **Read auth:** HMAC request signing **or** per-org read keys **or** asymmetric server-to-server JWT; rotation, rate limiting, audit logs.
- **Identity:** full `product_id ↔ design_id` mapping table; enforce/relink on `internal_code` change; consider a DB `unique(org_id, internal_code)` (only after de-duping existing data).
- **Materials:** `ks_material_key` + `ks_material_mappings` table; richer edge-banding metadata (colour/thickness/material per edge).
- **Sync UX:** diff preview + confirm; block/warn if the product is in an approved quote/work order; export status (`draft`/`ready`).
- **Concurrency:** two-tab conflict UI on `design_version` mismatch.
- **Abstraction:** generic `ProductDesignProvider` interface — **YAGNI for one provider now**; sketch only, build when a second provider appears.
- **The magic:** `render`/`quote` modes with **ephemeral** finish overrides (two-tone melamine), full KS cloud library, KS-exclusive types (server/bench), BOM/operations, drawings/CNC export ("manufacturing package").

## 15. Review Triage & "Do Not Miss"

**Accepted into slice:** server-side verification; enriched claims; export-as-pure-core + fixtures + role-driven banding + stable IDs + validation; source metadata + atomic RPC + snapshot + verify-matches; `ks_org_members` RLS + wrong-account + `DesignStore` + doc versioning; server-derived identity + backend permission checks + server-only secrets; new module key; runtime validation + shared contract tests; query-param read shape; costing material pre-seed.
**Calibrated/pushed back:** `product_id` is **integer** (review assumed UUID); `ProductDesignProvider` framework is **YAGNI** for one provider; `internal_code` uniqueness is **app-enforced** (caveat, not a DB key).
**Deferred:** see §14.

**Do not miss:** (1) no `KS_HANDOFF_SECRET` in Vite/browser; (2) backend authz, not just UI gating; (3) never let the client submit `org_id`/`product_code`; (4) never overwrite a cutlist without snapshot + source metadata + atomicity; (5) deterministic part IDs; (6) `product_id` is the stable link, not `internal_code`; (7) KS RLS via membership; (8) banding role/recipe-driven; (9) pre-login KS before the live demo; (10) keep the generic contract and the actual JWT consistent.

## 16. Risks · Rollback · Process

**Risks:** KS backend + Edge Functions from scratch in 3 days *(High — cut Phase 7 polish before Phases 0–6)*; export mapping wrong *(Med — Phase 1 fixtures first)*; non-atomic legacy replace *(addressed by the RPC)*; costing shows no number *(addressed by pre-seeded priced board)*; live-demo auth *(pre-login)*.

**Rollback:** Unity changes are behind the disabled module → zero impact; migrations additive (`product_integration_sources`, RPC, module seed) — no destructive ops; rollback = disable module + hide buttons (synced groups are ordinary rows). KS is greenfield; rollback = don't deploy (localStorage keeps working).

**Process:**
```
Brainstorm ✅ → plan v1 → GPT-5.5 Pro review ✅ → plan v2 (this) →
expand approved phases into granular TDD task lists → Codex implements →
Claude reviews diff vs codex/integration + re-verifies → merge
```
