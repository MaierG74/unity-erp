# Kinetic Sketch ↔ Unity ERP — Foundation Slice: Design & Implementation Plan

> **Status:** **v4** — Codex adversarial review (verdict: needs-attention, 9 findings) folded in; see **§17**. (v3 had applied GPT-5.5 Pro's 5 must-fixes.) Ready to decompose Phase 0/1 into granular TDD tasks for Codex.
> **For agentic workers:** Each phase in §10 is expanded into a granular `superpowers:writing-plans` task list (failing test → run → implement → pass → commit) before Codex implements it.

**Date:** 2026-06-15 (v3 same day) · **Demo target:** Thursday 2026-06-18
**Author:** Claude (brainstormed with Greg) · **Reviewer:** GPT-5.5 Pro (2 passes)
**Branch:** `codex/local-ks-integration-spec` (off `codex/integration`)
**Repos touched:** `unity-erp` (Next.js ERP) + `Kinetic Sketch 2.0` (Vite/React/three.js)

### Revision history
- **v1:** initial design+plan.
- **v2 (after review #1):** server-side handoff verification; `org_id + product_id` join; export-as-core; atomic Unity import; `ks_org_members` RLS; source metadata; runtime schemas.
- **v3 (after review #2) — the 5 must-fixes:** (1) part IDs **drop `design_version`**; (2) snapshot + replace + metadata are **one RPC transaction**; (3) **wording** fixed everywhere — the join is `org_id + product_id`, `internal_code` is display/traceability only; (4) handoff verification does **JWT + KS session + email + membership server-side** in the Edge Function; (5) KS's design model is **decoupled from Unity `product_id`** via a link table so KS stays standalone. Plus: `sub` and `unity_user_id` added; runtime-agnostic export + canonical hash; explicit `board_type` convention; status enum; Option-A status UI; JWT alg-lock + negative tests; strict critical path.

---

## Goal

A **real, end-to-end vertical slice**:

> **Create a product in Unity → design it in Kinetic Sketch → its cutlist syncs back into Unity → Unity costs the product.**

Two products that **stand alone** (each its own Supabase backend, KS sellable independently), **joined by Unity's stable `product_id` within `org_id`** — `internal_code` is carried only for display and traceability (it is editable and only app-enforced-unique, never a join key). This is the spine; render-from-quote / two-tone melamine are deferred and ride on top later.

## Architecture (in three sentences)

KS owns the **editable design**; Unity owns the **cutlist *projection*** + costing; they join on `org_id (uuid) + product_id (int)`, and KS keeps designs in its own table **decoupled** from Unity via a link table so KS can also run fully standalone. Unity (server-side) mints a short-lived signed handoff JWT and opens KS in a tab; a **KS Edge Function verifies the JWT *and* the KS session, email, and org membership** before the SPA opens the design; later Unity **pulls** a validated projection through that Edge Function and imports it in **one atomic RPC** (each database only writes itself — no cross-platform token exchange). The integration is one generic capability contract (`{mode, context, product_code, overrides, return}`); this slice implements only the `design` verb.

## Tech Stack

- **Unity ERP:** Next.js 16 (App Router), React 18, TS, Supabase (Postgres+Auth+Storage+RLS), TanStack Query, Tailwind v4 / shadcn v4. `product_id` = **integer serial**; `org_id` + Supabase-auth `user_id` = **uuid**.
- **Kinetic Sketch:** Vite 6, React 18, TS, three.js; currently localStorage-only.
- **New for KS:** Supabase (Auth + Postgres + RLS + **Edge Functions**, Deno runtime) — greenfield.
- **Cross-system:** HS256 handoff JWT (verified in a KS Edge Function) + a read-key (constant-time compare), both **server-side only**. Zod validation both sides. The shared cutlist export is **runtime-agnostic** (runs in Deno Edge Function, Node tests, and browser) and uses **Web Crypto** for hashing.

---

## 1. Guiding Principles

1. **Plug-in, not merge.** KS runs with no Unity (local `DesignStore`); the Unity link is additive via a link table, never baked into the core design row.
2. **Split source of truth.** KS owns the editable design; Unity owns the **cutlist projection** + costing — never edited in Unity as if it were the design.
3. **Join key:** `org_id (uuid) + product_id (int, stable)`. `internal_code` is carried for display/traceability only (editable; app-enforced-unique, not a DB key).
4. **Licence = per-org module entitlement** (new `kinetic_sketch` "sellable add-on").
5. **Authorization is server-side via `ks_org_members`**, never email. Email (normalized) is only for "wrong account" UX + audit. `unity_user_id` (uuid) is the audit actor.
6. **Secrets never reach a browser.** All verification/secret checks run in server surfaces; the handoff token is stripped from the URL immediately.
7. **Unity pulls, explicitly.** Opening KS ≠ changing manufacturing data; syncing is a separate, logged, atomic action.
8. **Reusable contract, single surface.** Implement `design`; declare-but-don't-build `render`/`quote`.

## 2. Scope (the revised minimum slice — not expanded in v3)

1. Shared **contract + Zod schemas** (both repos).
2. **Pure, runtime-agnostic** KS `design → CutlistGroup[]` export + **1200-cupboard fixture matrix** (+ invalid fixtures). Built first.
3. KS Supabase: `ks_designs` (decoupled) + `ks_design_external_links` + `ks_org_members` + RLS (`USING`+`WITH CHECK`) + `DesignStore`.
4. KS **Edge Function `handoff-verify`**: JWT + KS session + email + membership.
5. Unity **server-side** signed-handoff route (derives all identity) + "Design in Kinetic Sketch" button.
6. KS **Edge Function read endpoint**: recompute export from `document`, validate, return projection.
7. Unity **sync**: verify-matches → **one RPC** (snapshot + delete + insert + metadata) → status enum.
8. Product page: **Design** / **Sync** / last-synced status (Option A) / **costing** result (pre-seeded priced board).

### Out of scope → §14.

## 3. End-to-End Flow

| # | Step | Where | Mechanics |
|---|------|-------|-----------|
| 1 | **Create product** | Unity | Product has `product_id` (int) + `internal_code`. *Already works.* |
| 2 | **Design in KS** | Unity → KS | Button → Unity server route (derives `org_id`,`product_id`,`internal_code`; checks entitlement+permissions) mints a short-lived JWT, opens `KS_APP_URL/handoff?token=…`. KS SPA: store token in `sessionStorage` → `history.replaceState` to strip it from the URL → require KS login → `POST /handoff-verify` (Bearer KS access token + token). The **Edge Function** verifies JWT (alg-locked HS256, `iss`/`aud`/`exp`/`nbf` w/ small skew), the KS session, normalized email match, and `ks_org_members` membership, then returns the open instruction. Save → `ks_designs` via `DesignStore`. |
| 3 | **Cutlist back** | Unity ← KS | "Sync from Kinetic Sketch" → Unity server route → Edge Function `GET /v1/cutlist?org_id=…&product_id=…` with `X-KS-Read-Key`. Edge Function **recomputes** the export from `document`, validates, returns the projection (`cutlist_hash`, `schema_version`, `design_version`, `design_updated_at`, `generated_at`, `warnings[]`). |
| 4 | **Cost** | Unity | Unity verifies `org_id`/`product_id` match → one RPC import → maps `board_type` → a **pre-seeded priced board material** so costing yields a real number. |

## 4. The Integration Contract

**Handoff JWT** (HS256; minted in Unity server, verified in KS Edge Function; **alg explicitly locked to HS256**):
```jsonc
{
  "iss": "unity", "aud": "kinetic-sketch",
  "sub": "unity-product:<org_id>:<product_id>",   // org-scoped subject
  "org_id": "<uuid>", "product_id": 1234,         // stable join key
  "product_code": "<internal_code>",              // display/traceability only
  "mode": "design",
  "context": { "source": "unity", "entity": "product" },
  "overrides": {},
  "return": { "url": "<strictly-allowlisted Unity URL>", "label": "Back to Unity" },
  "contract_version": 1, "schema_version": 1,
  "iat": 0, "nbf": 0, "exp": 0,                    // exp ≤ 5 min; small clock-skew tolerance
  "jti": "<uuid>",                                 // logged; replay-store deferred (§14)
  "trace_id": "<uuid>",
  "actor": { "unity_user_id": "<uuid>", "email": "<email>" }  // id = audit; email = wrong-account UX
}
```

**Read (pull)** — query-param shape (codes may contain `/`, spaces, `#`):
```
GET {KS_EDGE_URL}/v1/cutlist?org_id=<uuid>&product_id=<int>
Header: X-KS-Read-Key: <secret>          # constant-time compare
200 → CutlistPullResponse (Zod-validated before return)
401 bad/missing key · 404 no design · 409 design exists but not a valid cutlist
```

**`CutlistPullResponse`:**
```jsonc
{
  "schema_version": 1,
  "org_id": "<uuid>", "product_id": 1234, "product_code": "CAB-1200",
  "design_id": "<uuid>", "design_version": 8,
  "design_updated_at": "<iso>",   // when the user last saved the design
  "generated_at": "<iso>",        // when this export was produced
  "cutlist_hash": "sha256:…",     // canonical hash (see §5)
  "warnings": [{ "code": "MISSING_EDGE_RULE", "message": "…" }],
  "groups": [ { "name": "…", "board_type": "MELAMINE_WHITE_16MM", "sort_order": 0, "parts": [ /* CutlistPart[] */ ] } ]
}
```

**`board_type` convention (CORRECTED per Codex review #6):** `board_type` is the **lamination/thickness CLASS** matching Unity's existing `product_cutlist_groups.board_type` — `'16mm'` | `'32mm-both'` | `'32mm-backer'`. It is **not** a material token. Material identity = `material_label` (decor) + `material_thickness`. `group.board_type` required; parts inherit it. A laminated 32mm top/base → `board_type:'32mm-both'` + `lamination_type:'same-board'`. Unity maps `(board_type + material_label)` → a pre-seeded priced material/component.

**`CutlistPart`** (canonical in Unity `lib/cutlist/types.ts` — which ALREADY carries lamination fields; KS mirrors them + Zod-validates):
`{ id, name, length_mm, width_mm, quantity, grain:'any'|'length'|'width', band_edges:{top,right,bottom,left:boolean}, board_type?, material_label?, material_thickness?, lamination_type?:'none'|'with-backer'|'same-board'|'custom', lamination_group? }`

## 5. Cutlist Export — the core

A **pure, runtime-agnostic** module (no React/DOM/three.js/localStorage, **no `node:`/`Deno.` APIs**) so the *exact same code* runs in the browser, Node/Vitest tests, and the Deno Edge Function. Single source of truth at `supabase/functions/_shared/cutlistExport.ts`, re-exported into `src/domain/` for the app/tests (no logic duplication).

**Verified Unity semantics it must honour** (`lib/cutlist/types.ts`, `guillotinePacker.ts`, `boardCalculator.ts`):
- `length_mm` = sheet **Y**, `width_mm` = sheet **X**; **no `length >= width` rule**.
- `grain:'length'` → unrotated; `'width'` → 90°; `'any'` → optimizer chooses (set `grain` when orientation matters).
- Bands: `top`/`bottom` ↔ `length_mm`; `left`/`right` ↔ `width_mm`.

**Rules:**
- **Role-driven** (`PieceRecipe` panel `role`: `left_side`,`right_side`,`top`,`bottom`,`back`,`shelf`,`door_left`,`door_right`,`toe_kick`,`rail`); `grain`/`band_edges` derive from `role`+dimensions, never from the name string.
- **Deterministic, version-independent IDs:** `ks:<design_id>:<role>:<index>` — **no `design_version`** in the ID (version is carried on the response only), so re-saves don't churn every part ID. (Use a panel path if available: `ks:<design_id>:<panel_path>`.)
- **Canonical hash:** `cutlist_hash = sha256(canonical_json(groups))` via **Web Crypto** (`crypto.subtle`), canonicalizing by sorting object keys, groups by `sort_order` then name, parts by id.
- **Validate before return** (else `409`): no zero/negative dims, qty ≥ 1, name present, `grain`+`band_edges` present, known thickness, non-empty groups.
- **Fixtures (shared, both repos):** `fixtures/ks/1200-cupboard.{design,expected-cutlist}.json` (full role matrix) **plus** invalid fixtures (zero dim, missing band_edges, unknown board_type, empty groups, negative qty, bad grain) to lock the `409` path.

## 6. Data Ownership & Unity Import Safety

- **Naming:** the synced data is the **cutlist projection**, not the design.
- **Source metadata** — additive table:
  ```sql
  product_integration_sources (
    id uuid pk default gen_random_uuid(), org_id uuid not null, product_id int not null,
    provider text not null default 'kinetic_sketch',
    external_org_id uuid, external_product_id int, external_product_code text, external_design_id uuid,
    last_synced_design_version int, last_seen_design_version int,
    last_synced_cutlist_hash text, last_synced_at timestamptz, last_checked_at timestamptz,
    last_synced_by uuid, last_sync_status text, last_sync_error text,
    previous_groups_snapshot jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (org_id, product_id, provider)
  )
  ```
- **One atomic RPC** (verified: Unity's existing replace is non-atomic). `replace_product_cutlist_projection_from_ks(p_org_id uuid, p_product_id int, p_groups jsonb, p_external_design_id uuid, p_external_product_code text, p_design_version int, p_cutlist_hash text, p_synced_by uuid, p_trace_id uuid)` performs **read existing → write `previous_groups_snapshot` → delete → insert → update metadata → commit** in one transaction. `SECURITY DEFINER` with `set search_path = public`; validates inputs (Zod in the route is not a substitute for DB-side shape checks).
- **Verify-then-write / skip-unchanged:** reject if `product_id`/`org_id` mismatch or Zod fails; if `cutlist_hash` unchanged, **skip the rewrite but still update** `last_seen_design_version`/`last_checked_at`/`last_sync_status='unchanged'` (so the panel doesn't say "newer changes" forever).
- **Status enum:** `success | unchanged | failed | not_found | invalid_cutlist | unauthorized`. On failure record `last_sync_status='failed'` + a **safe** `last_sync_error` (never raw exception text / headers), leave `last_synced_at` unchanged.
- **`trace_id`** is returned in Unity's API responses ("Sync failed. Trace ID: …") and logged on both sides.
- **Replace scope caveat (verified):** `product_cutlist_groups` has **no per-group source tag**, so full-replace wipes *all* groups for the product. Slice rule: **demo on a product with no manual cutlist; if existing groups are present, warn/confirm; always snapshot.** Group-level source ownership → §14.
- **Costing dependency (verified):** costing needs a priced Unity material; pre-seed one and map `board_type` → it.
- **Status UI (Option A, slice):** show only "last synced version/time" until the user clicks **Sync**, then report whether anything changed. No separate design-meta endpoint for Thursday (§14).

## 7. KS Backend & Security

- **Designs decoupled from Unity** (keeps KS standalone):
  ```sql
  ks_designs (id uuid pk default gen_random_uuid(), org_id uuid not null, owner_user uuid,
    document jsonb not null, doc_version int not null, design_version int not null,
    units text not null default 'mm', last_export_cache jsonb,   -- NON-authoritative; sync recomputes
    created_at timestamptz default now(), updated_at timestamptz default now())

  ks_design_external_links (design_id uuid references ks_designs(id) on delete cascade,
    external_system text not null,        -- 'unity'
    external_org_id uuid not null, external_product_id int not null, external_product_code text,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (external_system, external_org_id, external_product_id))
  ```
  `document` is **versioned** (`doc_version`, units). The read endpoint **recomputes** the export from `document` and ignores `last_export_cache` for authority.
- `ks_org_members (org_id uuid, user_id uuid references auth.users, role text, primary key(org_id,user_id))` — **service-role managed only** (no client self-add policy).
- **RLS** on `ks_designs`/links: both `USING` **and** `WITH CHECK` require membership of the row's `org_id` via `ks_org_members`; disallow moving a row to another `org_id`.
- **`DesignStore` modes (explicit):** standalone-local (`LocalStorageDesignStore`, no org/product), Unity-linked (`SupabaseDesignStore` + membership), future KS-cloud standalone (Supabase, KS-native ids, no Unity product). Supabase persistence is **not** hardwired to Unity.
- **Edge Functions:** lock JWT alg to HS256; small clock-skew tolerance (`nbf` ~30–60s, `iat` not >60s future); normalized email compare; CORS scoped (no `*` with Authorization); log `trace_id`/`jti`/ids + outcomes, **never** the JWT or read-key.
- **Wrong-account** is decided **server-side** (Edge Function); the SPA only renders the message.

## 8. Unity Integration & Security

- **New module key** `kinetic_sketch` (not reuse `furniture_configurator`), seeded disabled (additive migration).
- **Client sends only `{ productId }`**; the server derives `org_id`/`product_id`/`internal_code`/return URL and checks authenticated + org member + may-edit-product + module-enabled + product-belongs-to-org + has `internal_code`. UI gating ≠ authorization.
- **`return.url` strict allowlist:** exact origin + path pattern; reject protocol-relative, `javascript:`, `data:`, non-HTTPS in prod; used only after the Edge Function returns it.
- **Server-only secrets:** `import "server-only"` in `lib/integrations/ks/*`; no `NEXT_PUBLIC_` secrets. Env: `KS_APP_URL`, `KS_EDGE_URL`, `KS_HANDOFF_SECRET`, `KS_READ_KEY`.

## 9. File / Component Map

**Kinetic Sketch (`Kinetic Sketch 2.0/`)**
- `supabase/functions/_shared/cutlistExport.ts` (pure, runtime-agnostic) + `src/domain/cutlistExport.ts` re-export; `src/domain/__tests__/…` + `fixtures/ks/1200-cupboard.*` + invalid fixtures.
- `src/backend/{supabaseClient,designStore,designStore.local,designStore.supabase}.ts`; `src/integration/handoffClient.ts` (sessionStorage + replaceState + verify call).
- `supabase/migrations/0001_ks_designs.sql` (+ links, members, RLS).
- `supabase/functions/handoff-verify/index.ts`; `supabase/functions/cutlist/index.ts`.

**Unity ERP (`unity-erp/`)**
- `lib/modules/keys.ts` (+`KINETIC_SKETCH`); migrations: `…_ks_module_catalog.sql`, `…_product_integration_sources.sql`, `…_replace_product_cutlist_projection_rpc.sql`.
- `lib/integrations/ks/{handoff,client,schemas}.ts` (`server-only`, Zod).
- `app/api/integrations/ks/handoff/route.ts`; `app/api/products/[productId]/sync-from-ks/route.ts`.
- Product page KS panel (Design / Sync / last-synced / costing).

## 10. Phased Workstreams

- **Phase 0 — Contract & Zod schemas:** JWT claims, `CutlistPullResponse`, `CutlistPart`; sign-in-Unity / verify-in-Edge-Function round-trip; **negative JWT tests** (`alg:none`, wrong `aud`/`iss`, future `nbf`, expired `exp`, tampered payload). *AC:* schemas validate both repos; all negatives rejected.
- **Phase 1 — Pure export + fixtures (KS) [critical, first]:** `cutlistExport.ts` + 1200-cupboard role-matrix fixture + invalid fixtures; canonical-hash test; **orientation-semantics test** (two asymmetric parts: `1000×300 grain length` vs `1000×300 grain width`) confirming rotation; Unity-side test importing `expected-cutlist.json`. *AC:* `design→export` equals fixture; Unity imports cleanly; 409 on invalid.
- **Phase 2 — KS persistence + RLS:** `ks_designs` + links + `ks_org_members` + RLS (`USING`+`WITH CHECK`) + `DesignStore`. *AC:* member saves/reloads by link; non-member denied; cannot move row across orgs.
- **Phase 3 — KS `handoff-verify` Edge Function:** JWT (alg-locked) + KS session + email + membership; wrong-account server-side. *AC:* valid token opens the right design; every negative rejected.
- **Phase 4 — Unity launch:** module gate + server-derived signed-handoff route + button; token stripped from URL on landing. *AC:* opens to the right product; off when module disabled; client can't inject identity.
- **Phase 5 — KS read endpoint:** `/v1/cutlist` (read-key constant-time, recompute+validate, 200/401/404/409). *AC:* correct key → validated projection; bad key → 401; unknown → 404; invalid → 409.
- **Phase 6 — Unity sync + cost:** verify-matches → atomic RPC (snapshot+replace+metadata) → status enum; skip-unchanged updates metadata; map `board_type` → priced material; costing yields a number; last-synced UI. *AC:* full create→design→sync→cost; forced insert-failure leaves prior cutlist intact.
- **Phase 7 — Demo prep:** pre-seed org/product/KS-membership/KS-user (**pre-logged-in**)/priced board/module; rehearse; fallback = **real sync from a pre-saved KS design** (never hardcoded Unity-local fake data).

### Critical path vs nice-to-have (scope discipline)
**Critical demo path:** (1) fixture export, (2) KS read endpoint from a pre-saved design, (3) Unity atomic sync into cutlist groups, (4) costing number, (5) handoff button.
**Nice-to-have:** polished wrong-account UX, "KS has newer changes" status, richer panel state. Cut these before the critical path if time runs short — the end-to-end manufacturing proof matters more than launch polish.

## 11. Acceptance Criteria

1. "Design in Kinetic Sketch" opens KS focused on the product; design persists in KS keyed by the link `(unity, org_id, product_id)`.
2. "Sync" replaces `product_cutlist_groups` **atomically** (one RPC; prior set snapshotted) with parts carrying correct `grain`+`band_edges`.
3. Cutlist Builder shows the projection; costing yields a **real** material cost (pre-seeded priced board).
4. **KS still runs fully standalone** (local `DesignStore`, no Unity).
5. Off by default; client can't drive identity; secrets never reach the browser; handoff token leaves the URL immediately.

## 12. Verification Commands

- **Unity:** `npm run lint`; `npx tsc --noEmit` (touched); Supabase advisors for new RLS/RPC.
- **KS:** build + lint; export + hash + orientation tests; sign-token→`handoff-verify` script (incl. negatives); read-endpoint with/without key.
- **Contract:** shared-fixture tests in both repos (happy + invalid).
- **Manual:** end-to-end click-through via preview; screenshot each step.

## 13. Resolved Decision Points

| Topic | Decision |
|---|---|
| Module key | New `kinetic_sketch`. |
| `org_id` across projects | Reuse Unity org UUID; link table carries `external_*`. |
| Read endpoint host | Supabase Edge Function. |
| Pull trigger | Explicit "Sync". |
| KS auth (slice) | KS login + `ks_org_members`; verified server-side; pre-login demo account. |
| grain/band_edges | Pure runtime-agnostic module + role-driven + fixture matrix; semantics pinned. |
| Part IDs | `ks:<design_id>:<role>:<index>` (no version). |
| Import atomicity | One `SECURITY DEFINER` RPC: snapshot+delete+insert+metadata. |
| Status UI | Option A (last-synced only until Sync). |
| `board_type` | Explicit token (e.g. `MELAMINE_WHITE_16MM`); group-required, part-optional override. |
| KS standalone | `ks_designs` decoupled; Unity link via `ks_design_external_links`. |

## 14. Deferred — Production Hardening & Next Increments

One-time handoff code (vs JWT-in-URL); `jti` replay store; read-key HMAC/per-org/asymmetric + rotation + rate-limit + audit; full `product_id↔design_id` mapping & `internal_code`-change relink; `ks_material_key` + mappings table; richer edge-banding metadata; group-level source ownership (so sync won't touch manual cutlists); sync diff-preview + confirm + block-if-in-approved-quote; two-tab conflict UI; generic `ProductDesignProvider` framework (**YAGNI** for one provider — sketch only); a `GET /v1/design-meta` status endpoint; **the magic** (`render`/`quote` ephemeral overrides, KS cloud library, server/bench types, BOM/operations, drawings/CNC "manufacturing package").

## 15. Review Triage (v3)

**Applied (must-fix):** version-free part IDs; one-RPC atomic import; product_code/product_id wording fixed throughout; server-side handoff verification incl. session/email/membership; KS design model decoupled via link table.
**Applied (sharpenings):** `sub` org-scoped; `actor.unity_user_id` (uuid) + email-for-UX; runtime-agnostic export + Web Crypto canonical hash; explicit `board_type` token + group/part rule; `design_updated_at`; skip-unchanged-still-update-metadata; status enum + safe errors + `trace_id` in responses; alg-lock + negative JWT tests + clock skew; normalized email; strict `return.url` allowlist; RLS `USING`+`WITH CHECK`; members service-role-only; `last_export_cache` non-authoritative (recompute on read); CORS scoped; safe logging; replace-scope caveat + demo rule; orientation + role-matrix + invalid-fixture tests; Option-A status UI; explicit critical path; real-sync fallback.
**Calibrated:** `unity_user_id` is a Supabase-auth **uuid** (review said "uuid-or-int"); shared export must be **runtime-agnostic** across Deno/Node/browser, so hashing uses Web Crypto (concrete deployment constraint the review flagged generally).
**Held (not expanded):** everything in §14 stays deferred; scope unchanged from v2.

## 16. Risks · Rollback · Process

**Risks:** KS backend + Edge Functions from scratch in 3 days *(High — protect the §10 critical path; cut nice-to-haves first)*; export mapping wrong *(Med — Phase 1 fixtures first)*; legacy non-atomic replace *(addressed by the RPC)*; costing shows no number *(pre-seeded priced board)*; live-demo auth *(pre-login + real-sync fallback)*.

**Rollback:** Unity changes behind the disabled module → zero impact; migrations additive (`product_integration_sources`, RPC, module seed) — no destructive ops; rollback = disable module + hide buttons. KS greenfield; rollback = don't deploy (localStorage keeps working).

**Process:**
```
Brainstorm ✅ → v1 ✅ → GPT-5.5 Pro review #1 ✅ → v2 ✅ → review #2 ✅ → v3 (this) →
expand Phase 0/1 into granular TDD tasks → Codex implements → Claude reviews diff vs codex/integration + re-verifies → merge
```

## 17. Codex Adversarial Review — v4 Corrections (authoritative; override conflicting body text)

Codex adversarial review, verdict **needs-attention**, 9 findings. Triage + required changes:

**Folded into the slice (correctness/security):**
- **[critical] #1 RPC exposure boundary:** the `SECURITY DEFINER` replace RPC MUST live in a private/unexposed schema **or** `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`, be callable only by the server (service role), and do an in-function org check. Add negative tests proving a direct `anon`/`authenticated` call cannot mutate `product_cutlist_groups`.
- **[high] #5 Concurrency:** inside the RPC, serialize per product via `pg_advisory_xact_lock(hashtext(p_org_id::text || ':' || p_product_id::text))` (or `SELECT … FOR UPDATE` on the `product_integration_sources` row). Add a concurrent-sync test proving a stale retry cannot overwrite a newer import and the snapshot reflects the true prior state.
- **[high] #3 Link-table tenancy:** `ks_design_external_links` MUST carry its own `org_id`, enforced to equal `ks_designs.org_id` (FK + trigger/CHECK); RLS + uniqueness key on that `org_id`. Add cross-org negative tests (a member of org A cannot create/update/read a link for org B, including a mismatched `external_org_id`).
- **[medium] #6 Contract — lamination + board_type:** `board_type` = lamination/thickness **class** (`'16mm'|'32mm-both'|'32mm-backer'`); material identity = `material_label` + `material_thickness`; `CutlistPart`/`CutlistGroup` schemas include Unity's existing `lamination_type?` + `lamination_group?`. Laminated 32mm top/base → `'32mm-both'` + `'same-board'`. (Supersedes any `MELAMINE_*_32MM` token.)
- **[medium] #9 Idempotency drift:** store `schema_version`, `contract_version`, `importer_version`, `material_mapping_version` in `product_integration_sources`; skip-rewrite only when the `cutlist_hash` AND all of those are unchanged — force a rewrite when any importer-affecting version changes even if `cutlist_hash` matches.
- **#7 / #8** are Phase-1-specific → see the Phase 1 plan's "Codex Review Corrections" section.

**Conscious demo-risk (remain §14-deferred — pull into the slice only if we want the higher bar now):**
- **[high] #2 Static read-key:** server-side only + constant-time compare for the slice; signed requests (HMAC over method/path/org/product/ts/nonce) + per-org keys + rotation + rate-limit + audit = production.
- **[high] #4 JWT-in-URL:** slice keeps short-`exp` + `sessionStorage` + `history.replaceState` + `no-referrer`; an **opaque single-use handoff code** = production.

These two are the ONLY findings not folded into the slice.
