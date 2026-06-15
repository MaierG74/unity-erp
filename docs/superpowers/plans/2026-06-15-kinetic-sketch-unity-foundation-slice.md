# Kinetic Sketch ↔ Unity ERP — Foundation Slice: Design & Implementation Plan

> **Status:** DRAFT for GPT-5.5 Pro pre-implementation review. Not yet approved; not yet decomposed into granular TDD steps.
> **For agentic workers:** Once approved, each phase below is expanded into a granular `superpowers:writing-plans` task list (failing test → run → implement → pass → commit) before Codex implements it.

**Date:** 2026-06-15
**Demo target:** Thursday 2026-06-18
**Author:** Claude (brainstormed with Greg)
**Branch:** `codex/local-ks-integration-spec` (off `codex/integration`)
**Repos touched:** `unity-erp` (Next.js ERP) + `Kinetic Sketch 2.0` (Vite/React/three.js)

---

## Goal

A **real, end-to-end vertical slice** proving the Unity ↔ Kinetic Sketch (KS) integration:

> **Create a product in Unity → design it in Kinetic Sketch → its cutlist syncs back into Unity → Unity costs the product.**

Two products that **stand alone** (each its own Supabase backend, KS sellable independently), joined by a shared **product code**. This slice is the spine; the visually striking pieces (render-from-quote, two-tone melamine) are deliberately deferred and ride on top of it later.

## Architecture (in three sentences)

KS is the **system of record for the editable design** (geometry, finishes, render data); Unity is the **system of record for the product and its derived manufacturing data** (cutlist, drawing, costing); the two are joined by `org_id + products.internal_code`. Unity launches KS in a browser tab via a **signed handoff URL**, KS persists the design to its own Supabase, and Unity later **pulls** the derived cutlist back by product code using a static read-key (each database only ever writes itself — no cross-platform token exchange). The integration is built as **one generic capability contract** (`{mode, context, product_code, overrides, return}`); this slice implements only the `design` verb so every future interlink point (render, order, etc.) is a cheap reuse.

## Tech Stack

- **Unity ERP:** Next.js 16 (App Router), React 18, TypeScript, Supabase (Postgres + Auth + Storage + RLS), TanStack Query, Tailwind v4 / shadcn v4.
- **Kinetic Sketch:** Vite 6, React 18, TypeScript, three.js + three-gpu-pathtracer, currently localStorage-only (no backend yet).
- **New for KS:** Supabase (Auth + Postgres + RLS) — greenfield.
- **Cross-system:** HS256-signed handoff JWT + static read-key, both held server-side only.

---

## 1. Context & Guiding Principles

1. **Not a merge — a plug-in.** KS remains a standalone, sellable product. Unity consumes its features. Nothing in this design may make KS unable to run on its own.
2. **Split the source of truth by capability, don't mirror the same object.**
   - **KS owns the DESIGN** — the only place the cupboard can be edited or rendered.
   - **Unity owns the PRODUCT + derived data** — cutlist, drawing, costing; what the ERP/factory consumes.
   - Unity's cutlist is a **derived projection** of the KS design at a point in time, not a rival editable copy.
3. **Join key:** `org_id + internal_code` (Unity's `products.internal_code` is already unique per org).
4. **Licensing is per-org/team** and maps onto Unity's **existing module-entitlement system** (KS appears as a "Sellable add-on" module). Enabling it for an org *is* the licence.
5. **Identity:** mirrored Supabase-auth accounts (same user provisioned in both projects, same email), each platform authenticating its own users. **No SSO / no token exchange.**
6. **Sync direction:** **Unity pulls** from KS. Each DB writes only itself; the single cross-system call is a *read* keyed by product code. This also gives the ERP control over *when* manufacturing data changes (no silent rewrites of a cutlist already on the floor).
7. **Reusable contract, single surface.** Design the handoff/return as a generic capability invocation; implement one verb (`design`) now.

## 2. Scope

### In scope (Thursday)
- KS Supabase backend (minimal): Auth + `ks_designs` table + signed-handoff landing + design persistence + cutlist export in Unity's `CutlistPart` shape + a read endpoint.
- Unity: entitlement gate, "Design in Kinetic Sketch" launch (server-signed handoff URL), "Sync from Kinetic Sketch" pull → `product_cutlist_groups`, then cost via the **existing** costing snapshot.
- Shared contract types + two secrets (handoff signing secret, KS read-key).

### Out of scope (next increments — "the magic")
- Render-from-quote; two-tone / per-context finish overrides.
- Two-way sync; account-linking UX; full KS cloud library; KS-exclusive types (server, bench) in this flow; iframe / same-origin embed.

## 3. End-to-End Flow

| # | Step | Where | Mechanics |
|---|------|-------|-----------|
| 1 | **Create product** | Unity | Product exists with `internal_code` (join key). *Already works today.* |
| 2 | **Design in KS** | Unity → KS | Gated "Design in Kinetic Sketch" button calls a Unity server route that mints a **signed handoff JWT** (`org_id`, `internal_code`, `mode:design`, `exp`, `nonce`) and opens `KS_APP_URL/handoff?token=…` in a new tab. KS validates the signature, authenticates the user via **KS's own Supabase Auth**, opens/creates the design for `(org_id, internal_code)`, user designs the cupboard, saves → persisted to `ks_designs`. |
| 3 | **Cutlist back** | Unity ← KS | "Sync from Kinetic Sketch" calls a Unity server route → `GET {KS_API_URL}/v1/designs/{org_id}/{internal_code}/cutlist` with `X-KS-Read-Key`. Response (cutlist already in `CutlistPart` shape) is written to `product_cutlist_groups` via Unity's existing **full-replace** path. Shows in the Cutlist Builder. |
| 4 | **Cost** | Unity | Unity's **existing** costing runs over the synced cutlist (`/api/products/[productId]/cutlist-costing-snapshot`, `lib/cutlist/costingSnapshot.ts`) → product material cost. |

## 4. The Integration Contract (generic, reusable)

**Handoff (Unity → KS), signed JWT (HS256, shared secret, minted server-side):**
```
GET {KS_APP_URL}/handoff?token=<jwt>
jwt.payload = {
  iss: "unity",
  org_id: "<uuid>",
  product_code: "<internal_code>",
  mode: "design",            // future: "render"
  overrides: {},             // future: { finishes: { carcass, doors } }
  exp: <unix>,               // short-lived (e.g. 5 min)
  nonce: "<uuid>"
}
```

**Pull (Unity → KS), static read-key:**
```
GET {KS_API_URL}/v1/designs/{org_id}/{product_code}/cutlist
Header: X-KS-Read-Key: <static secret>
200 → {
  product_code, design_version, updated_at,
  groups: CutlistGroup[]     // parts are CutlistPart[]
}
404 → design not found for that org+code
```

**Shared types** (canonical definition lives in Unity's `lib/cutlist/types.ts`; KS mirrors it for its export layer):
- `CutlistPart` = `{ id, name, length_mm, width_mm, quantity, grain: 'any'|'length'|'width', band_edges: {top,right,bottom,left:boolean}, material_label?, material_thickness? }`
- `CutlistGroup` = `{ name, board_type, parts: CutlistPart[], sort_order }`
- `HandoffClaims`, `CutlistPullResponse` (as above).

## 5. The One Real Gotcha — data-shape mapping

KS's internal `CutListRow` is `{ name, lengthMm, widthMm, thicknessMm, quantity }` — **no `grain`, no `band_edges`**. Unity's `CutlistPart` requires both. So KS's **export layer** (new) must emit `CutlistPart`:
- `grain` ← derived from each panel's orientation/role in the cupboard recipe (`catalog.ts buildCupboard` / `PieceRecipe` knows panel roles).
- `band_edges` ← per-panel-role defaults (e.g. doors banded all four edges; sides banded on visible edges), overridable later.

This is the single piece of genuinely new domain mapping and the most likely thing to be subtly wrong — it gets its own phase and explicit test fixtures comparing KS output to a known-good Unity cupboard cutlist.

## 6. File / Component Map

### Kinetic Sketch (`Kinetic Sketch 2.0/`) — greenfield backend
- `src/backend/supabaseClient.ts` — KS Supabase browser client (env-driven).
- `supabase/migrations/0001_ks_designs.sql` — `ks_designs` table + RLS.
- `src/integration/handoff.ts` — parse + verify the signed JWT from `?token=`.
- `src/integration/handoffRoute` (landing) — wire `/handoff` to: verify token → require KS auth → open/create design for `(org_id, product_code)`.
- `src/integration/cutlistExport.ts` — `toCutlistParts(doc): CutlistGroup[]` (the §5 mapping).
- `src/integration/designStore.ts` — persist/load `ks_designs` keyed by `(org_id, product_code)`.
- Read API (`v1/designs/.../cutlist`) — a lightweight serverless/edge function (Supabase Edge Function or a small Worker) authenticated by the read-key. *(Decision point — see §10.)*

### Unity ERP (`unity-erp/`) — small, seams exist
- `lib/modules/keys.ts` — add `KINETIC_SKETCH` module key *(or reuse `FURNITURE_CONFIGURATOR` — see §10)*.
- `supabase/migrations/<ts>_ks_module_catalog.sql` — seed the module (disabled) if a new key.
- `lib/integrations/ks/handoff.ts` — server-side: mint signed handoff JWT.
- `app/api/integrations/ks/handoff/route.ts` — `POST` → returns signed `KS_APP_URL/handoff?token=…` (keeps secret server-side; gated by module access).
- `app/api/products/[productId]/sync-from-ks/route.ts` — `POST` → calls KS read endpoint with `KS_READ_KEY`, maps response, writes `product_cutlist_groups` (reuse existing replace logic), returns groups.
- `components/features/configurator/...` or product page — "Design in Kinetic Sketch" + "Sync from Kinetic Sketch" buttons (gated by `useModuleAccess`).
- Env: `KS_APP_URL`, `KS_API_URL`, `KS_HANDOFF_SECRET`, `KS_READ_KEY`.

## 7. Phased Workstreams

> Each phase produces working, testable software. Granular TDD steps are generated per phase **after** GPT-5.5 Pro approves the approach.

- **Phase 0 — Contract & secrets (shared):** lock the JWT claims, the pull response shape, the `CutlistPart` contract; generate the two secrets; document env vars. *AC:* contract types compile in both repos; a signed token round-trips (sign in Unity, verify in KS) in a unit test.
- **Phase 1 — KS backend foundation:** Supabase project wired, `ks_designs` table + RLS, KS Auth (email/password), `designStore` persist/load. *AC:* a logged-in KS user can save and reload a design keyed by `(org_id, product_code)`.
- **Phase 2 — KS handoff landing:** `/handoff?token=` verifies signature + exp, requires KS auth, opens/creates the design for the claimed product code. *AC:* a Unity-signed token opens the correct design; tampered/expired tokens are rejected.
- **Phase 3 — KS cutlist export (the §5 mapping):** `toCutlistParts(doc)` emits `CutlistGroup[]`/`CutlistPart[]` with correct `grain` + `band_edges`. *AC:* output for a known 1200 cupboard matches a fixture validated against Unity's own cupboard cutlist.
- **Phase 4 — KS read endpoint:** `GET /v1/designs/{org}/{code}/cutlist` behind `X-KS-Read-Key`, org+code scoped. *AC:* correct key returns the cutlist; wrong/missing key → 401; unknown code → 404.
- **Phase 5 — Unity launch:** module gate + `POST /api/integrations/ks/handoff` (server-signs) + "Design in Kinetic Sketch" button. *AC:* clicking it opens KS to the right product; disabled when the module is off.
- **Phase 6 — Unity pull + cost:** `POST /api/products/[id]/sync-from-ks` writes `product_cutlist_groups`; Cutlist Builder shows it; costing produces a number. *AC:* full click-through create→design→sync→cost works end-to-end.
- **Phase 7 — Demo prep:** seed the 1200 cupboard as a designed KS library product; rehearse; record a fallback capture.

## 8. Acceptance Criteria (demo-level)

1. From a Unity product, "Design in Kinetic Sketch" opens KS focused on that product code; user designs a cupboard and saves; design persists in KS's DB keyed by code.
2. Back in Unity, "Sync from Kinetic Sketch" populates `product_cutlist_groups` with correct parts **including `grain` and `band_edges`**.
3. The Cutlist Builder displays the synced cutlist; costing yields a material cost.
4. **KS still runs fully standalone** — designing and saving locally needs no Unity.
5. The integration is off by default for all other orgs (entitlement gated).

## 9. Verification Commands

- **Unity:** `npm run lint`; `npx tsc --noEmit` (touched areas); Supabase security advisors for any new RLS.
- **KS:** its build + lint; a script that signs a token (Unity secret) and hits `/handoff`, and one that calls the read endpoint with/without the key.
- **Manual:** end-to-end click-through via the preview server; screenshot each of the 4 steps.

## 10. Decision Points (for GPT-5.5 Pro)

1. **Module key:** new `kinetic_sketch` module vs. reuse the existing `furniture_configurator` "sellable add-on" gate. *(Lean: new key — keeps "built-in configurator" vs "KS" independently sellable.)*
2. **`org_id` across two Supabase projects:** reuse Unity's org UUID as the canonical id inside KS (provision on licence) vs. KS-native org + a mapping table. *(Lean: reuse Unity's UUID for the slice.)*
3. **KS read endpoint host:** Supabase Edge Function vs. a small Cloudflare Worker (KS's handover doc previously leaned Workers). *(Lean: Edge Function — fewer moving parts for 3 days.)*
4. **Pull trigger:** explicit "Sync" button vs. auto-on-product-open. *(Lean: explicit button for the slice; safer + simpler.)*
5. **KS auth for the slice:** require KS login (pre-create the demo account) vs. bootstrap a session from the trusted handoff. *(Lean: require KS login — honest to "standalone product," avoids session-minting work.)*
6. **`grain`/`band_edges` derivation rules** (§5): exact defaults per panel role.
7. **Secret management & rotation:** both secrets server-side only; where stored; rotation story.

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| KS backend from scratch in 3 days | High | Keep schema to one table; lean on existing Unity costing; cut Phase 7 polish before cutting Phases 1–6. |
| `CutListRow → CutlistPart` mapping wrong | Med | Dedicated phase + fixture compared to Unity's known cupboard cutlist. |
| `org_id`/user identity misalignment across projects | Med | Decision point #2 resolved up front; reuse Unity UUID. |
| Cross-origin issues on pull | Low | Server-to-server call (Unity route → KS), not browser cross-origin. |
| Live-demo fragility | Med | Pre-seed design, rehearse, keep a recorded fallback. |

## 12. Rollback / Release Notes

- **Unity:** all changes behind the entitlement gate (**off by default**) → zero impact on existing orgs. New env vars only; **no destructive migrations** (module-catalog seed is additive). Rollback = disable the module + hide the buttons; any synced cutlists are ordinary `product_cutlist_groups` needing no cleanup.
- **KS:** greenfield backend; rollback = don't deploy it (KS keeps working on localStorage).

## 13. Docs to Update (on implementation)

- This plan + a paired `…-design.md` if the design diverges during build.
- Unity: module/entitlement docs; integration contract doc under `docs/projects/kinetic-sketch-integration/`.
- KS: backend README + the contract mirror.

## 14. Process — where this sits (the added review step)

```
Brainstorm (done)
  → THIS plan
  → GPT-5.5 Pro plan review        ← NEW STEP (per active workflow trial)
  → revise plan to address findings
  → expand approved phases into granular TDD task lists (writing-plans)
  → Codex implements
  → Claude reviews diff vs codex/integration + re-runs verification
  → merge to codex/integration
```
