# Phase 1 — KS Pure Cutlist Export: Granular TDD Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement task-by-task (failing test → run → implement → pass → commit). Steps use checkbox (`- [ ]`) syntax. **Effort:** Codex `xhigh`. **Review:** per-phase Codex adversarial review at `xhigh` + stop-time review gate (ON).
> **Parent plan:** `2026-06-15-kinetic-sketch-unity-foundation-slice.md` (v3) Phase 1.

**Goal:** A pure, runtime-agnostic module that converts a saved KS cupboard design into `CutlistGroup[]` in Unity's `CutlistPart` shape — with correct **role → grain → band_edges**, deterministic IDs, `board_type`, and a canonical hash — verified by a 1200-cupboard golden fixture, invalid fixtures (409 paths), and an orientation test.

**Architecture:** The export is **role-driven**. It traverses the design's parts (reusing `collectCutList`'s traversal but **keeping unsorted axis dimensions**), classifies each part by its name prefix into a `PanelRole`, then a **role-rule table** assigns Unity `length_mm`/`width_mm` (grain axis), `grain`, and `band_edges`. No KS geometry math is reimplemented; orientation is recovered from role + the unsorted bounding box (thickness = the axis closest to `recipe.boardMm`).

**Tech Stack:** TypeScript (no `node:`/`Deno.` APIs, no React/DOM/three.js/localStorage), Vitest, Web Crypto (`crypto.subtle`) for hashing. Single source of truth at `supabase/functions/_shared/cutlistExport.ts`, re-exported into `src/domain/`.

**Repo:** `Kinetic Sketch 2.0/` (KS). One cross-repo test lands in `unity-erp/`.

---

## Current status (2026-06-16) — Tasks 1–5 DONE
Branch `codex/ks-cutlist-export` (worktree `~/development/kinetic-sketch-phase1`, **local/unpushed**). 6 commits, **34 vitest green**, tsc clean on touched files. See `docs/superpowers/HANDOFF-ks-phase1.md` for the full paste-into-new-session brief.
- ✅ **Task 1** role-rule table — *superseded*: realigned to Unity's **ACTIVE** convention (`UNITY_DEFAULT_PROFILE` = `generateCupboardParts`) per Greg's choice (A).
- ✅ **Task 2** contract+zod · **Task 3** classifier · **Task 4** oriented collection · **Task 5** role geometry (Unity-aligned, profile-based, name-based cleats). Each Codex `xhigh`-reviewed; **real-buildCupboard integration guard** added.
- ⏳ **Remaining:** Task 6 material/board_type · 7 deterministic IDs · 8 canonical hash · 9 assemble `exportCupboard` (+ Top laminated-pair→32mm collapse, thread the profile, golden/invalid fixtures) · 11 Unity import test. (Task 10 covered by the collection + integration tests.)
- Convention is a swappable **`EdgingProfile`** (per-order override seam). Full override wiring + shop-vs-Unity reconciliation are deferred follow-ups (see foundation §14).

## Ground truth (verified — anchors for the implementer)
- `PieceRecipe` — `src/model.ts:91`. `CutListRow` + `collectCutList` — `src/model.ts:1424` (sorts dims **descending**, excludes `Handle*` and `cutList===false`, aggregates by `name|dims`). `Definition`/`SketchDocument` — `src/model.ts:622`. `finish:{carcass?,doors?}` — `src/model.ts:636`. CSV columns `part,quantity,length_mm,width_mm,thickness_mm` — `src/App.tsx:7665`.
- Cupboard panels (`src/catalog.ts`): `Top W×D×t` (qty 2, `buildCarcassPiece` ~570), `Base W×D×t` (~533), `Cleat …` front/back + sides (~514), `Side carcassD×sideH×t` (qty 2, ~539), `Back innerW×backH×t` (~543), `Shelf innerW×shelfD×t` (qty=`recipe.shelves`, ~1282), `Door doorW×doorH×t` (qty 2, ~1246). Name prefix = role; name embeds **role-semantic** dim order.
- MelaWood decors + `melawoodSlug()` — `src/library.ts:292,309`. Door detection `^(Door|Drawer Front)` — `src/library.ts:250`. All cut dims are integer **mm**.

## File structure
- Create `Kinetic Sketch 2.0/supabase/functions/_shared/cutlistExport.ts` — pure module (single source of truth).
- Create `Kinetic Sketch 2.0/src/domain/cutlistExport.ts` — `export * from "../../supabase/functions/_shared/cutlistExport"` (app/test entry; verify the path alias resolves under Vite+Vitest, else use a tsconfig path).
- Create `Kinetic Sketch 2.0/src/domain/__tests__/cutlistExport.test.ts` — unit tests.
- Create `Kinetic Sketch 2.0/fixtures/ks/1200-cupboard.recipe.json` — input.
- Create `Kinetic Sketch 2.0/fixtures/ks/1200-cupboard.expected-cutlist.json` — golden output (generated in Task 9, reviewed).
- Create `Kinetic Sketch 2.0/fixtures/ks/invalid/*.json` — 409-path inputs.
- Create `unity-erp/lib/cutlist/__tests__/ksProjectionImport.test.ts` — cross-repo: the golden fixture imports cleanly into `CutlistPart`/`product_cutlist_groups` shape.

---

## Task 1 — Role-rule table (CONFIRMED 2026-06-15 by Greg) ✅

`grain` and `band_edges` are shop conventions, now confirmed. Encode as `ROLE_RULES` in Task 4. Bands are stated in plain panel-edge terms; the `{top,right,bottom,left}` flag mapping is resolved in Task 5 against Unity's `boardCalculator.ts` convention (top/bottom ↔ `length_mm` edges; left/right ↔ `width_mm` edges) and locked by the orientation test (Task 10).

| Panel (name prefix) | Grain runs | Banded edges (plain) | Group | Finished thickness |
|---|---|---|---|---|
| `Top` | front-to-back | **all 4** | laminated | **32mm laminated** (pair of 16mm → `same-board`); band the finished 32mm edge |
| `Base` | front-to-back | **all 4** | laminated/carcass | **32mm** typical, **16mm** sometimes — from recipe build |
| `Side` | vertical | **front + back** (two vertical edges) | carcass | `boardMm` (16) |
| `Back` | `any` | **none** | carcass | `boardMm` (16) |
| `Shelf` | left-to-right | **front only** | carcass | `boardMm` (16) |
| `Door` | vertical | **all 4** | doors | `boardMm` (16) |
| `Cleat` | `any` | **none** | carcass | `boardMm` (16) |

**Lamination (confirmed):** Top is normally a **laminated 32mm** top — KS emits it as a qty-2 pair of 16mm `Top` panels; the export collapses the pair into one 32mm laminated part (`lamination_type:"same-board"`, `board_type` …`_32MM`) in the **laminated** group, banded all-around on the 32mm edge. Base is **mostly 32mm, sometimes 16mm** — derive finished thickness from the recipe build (double/cleated → 32mm; single panel → 16mm). All other panels are `boardMm` (16mm). This maps onto Unity's existing lamination grouping (`board_type` `16mm` vs `32mm-both`).

- [x] **Step 1:** Confirmed (above): Top/Base/Doors banded all around; Sides front+back; Shelves front only; Back/Cleats none. Top laminated 32mm; Base 32mm (sometimes 16mm).
- [ ] **Step 2:** Grouping: **laminated** group (32mm top/base) + **carcass** group (16mm) + **doors** group; `board_type` from finished thickness + `finish` decor (Task 6). Confirm 2-vs-3 groups during the Task 9 fixture review.

## Task 2 — Contract types + Zod (mirror Unity's `CutlistPart`)
**Files:** Create `_shared/cutlistExport.ts` (types section); Test `cutlistExport.test.ts`.
- [ ] **Step 1: Failing test** — import `CutlistPartSchema`, assert a valid part parses and a part missing `band_edges` throws.
```ts
import { describe, it, expect } from "vitest";
import { CutlistPartSchema } from "../cutlistExport";
describe("CutlistPart schema", () => {
  it("accepts a valid part", () => {
    expect(() => CutlistPartSchema.parse({ id:"ks:d:door_left:0", name:"Door 348×648×16",
      length_mm:648, width_mm:348, quantity:1, grain:"length",
      band_edges:{top:true,right:true,bottom:true,left:true}, board_type:"MELAMINE_ICEBERG_WHITE_16MM",
      material_label:"Iceberg White", material_thickness:16 })).not.toThrow();
  });
  it("rejects a part with no band_edges", () => {
    expect(() => CutlistPartSchema.parse({ id:"x", name:"x", length_mm:1, width_mm:1, quantity:1, grain:"any" })).toThrow();
  });
});
```
- [ ] **Step 2:** Run `npx vitest run src/domain/__tests__/cutlistExport.test.ts` → FAIL (no export).
- [ ] **Step 3:** Implement `GrainSchema`, `BandEdgesSchema`, `CutlistPartSchema`, `CutlistGroupSchema`, `CutlistPullResponseSchema` + inferred TS types, matching Unity `lib/cutlist/types.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ks): cutlist export contract types + zod schemas`.

## Task 3 — Role parser
- [ ] **Step 1: Failing test:** `parseRole("Side 560×650×16")==="Side"`, `parseRole("Door 348×648×16")==="Door"`, `parseRole("Cleat 900×100×16")==="Cleat"`, `parseRole("Handle …")===null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `parseRole(name): PanelRole|null` (first word → enum; `Handle`/`Steel` → null).
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

## Task 4 — Part collection with UNSORTED axis dims
The lossy bit of `collectCutList` is the descending sort. This module needs axis-preserved dims.
- [ ] **Step 1: Failing test:** given a tiny `SketchDocument` fixture with one `Side` mesh whose bbox is `depth=0.560, height=0.650, thickness=0.016` m, `collectOrientedParts(doc)` returns one entry `{ role:"Side", name, dims_mm:{x:?,y:?,z:?}, quantity:1 }` with the three dims as integer mm preserving axes (not sorted), thickness identified as the axis nearest `recipe.boardMm`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `collectOrientedParts(doc, recipe)` — traverse like `collectCutList` (`src/model.ts:1424`) but keep `{x,y,z}` mm dims; exclude `Handle*`/`cutList===false`; aggregate by `name|x×y×z`; carry mesh `color` for material lookup.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

## Task 5 — Role-rule mapping → length/width/grain/band_edges
- [ ] **Step 1: Failing test:** with the confirmed `ROLE_RULES` (Task 1), `applyRoleRule({role:"Side", dims_mm,…})` yields `length_mm=height`, `width_mm=depth`, `grain="length"`, `band_edges` per table; a `Door` yields all-four bands + `grain="length"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `ROLE_RULES` (from confirmed Task 1 table) + `applyRoleRule(part)`. Thickness = axis nearest `recipe.boardMm`; the remaining two axes assigned to length/width per the rule.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

## Task 6 — board_type + material from finish
- [ ] **Step 1: Failing test:** `materialFor("Side", {carcass:"Iceberg White"}, 16)` → `{ board_type:"16mm", material_label:"Iceberg White", material_thickness:16, lamination_type:"none" }`; a laminated `Top` at 32mm → `{ board_type:"32mm-both", material_label:"Iceberg White", material_thickness:32, lamination_type:"same-board" }`; a `Door` uses `finish.doors`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `materialFor(role, finish, thicknessMm)`: decor = `role==="Door" ? finish.doors : finish.carcass`; **`board_type` = lamination CLASS** = `thicknessMm===32 ? "32mm-both" : "16mm"` (matches Unity `product_cutlist_groups.board_type`; **NOT** a `MELAMINE_*` token — see parent §17 #6); `material_label = decor` (the MelaWood name; `melawoodSlug` at `src/library.ts:292` is only for any slug needs); `material_thickness = thicknessMm`; `lamination_type = thicknessMm===32 ? "same-board" : "none"`. Hex finish (no decor name) → `material_label = hex` (board_type/thickness unchanged).
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

## Task 7 — Deterministic IDs (no version)
- [ ] **Step 1: Failing test:** for `design_id="abc"`, the two doors get `ks:abc:door_left:0` / `ks:abc:door_right:0`; ids are stable across two calls; **no `design_version` in the id**.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `partId(design_id, role, index)` with a stable per-role ordering (sides → left=0,right=1; doors → left,right; shelves → 0..n).
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

## Task 8 — Canonical hash (Web Crypto)
- [ ] **Step 1: Failing test:** `cutlistHash(groups)` is stable under object-key reordering and group/part reordering; differs when a dimension changes; returns `sha256:<hex>`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `canonicalJson` (sort object keys; groups by `sort_order` then name; parts by `id`) + `cutlistHash` via `crypto.subtle.digest("SHA-256", …)` (available in Deno/Node18+/browser). Async.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

## Task 9 — Validation + assemble export + GOLDEN fixture
- [ ] **Step 1: Failing test (happy):** `exportCupboard(doc)` for `fixtures/ks/1200-cupboard.recipe.json` deep-equals `fixtures/ks/1200-cupboard.expected-cutlist.json` (minus volatile `generated_at`).
- [ ] **Step 2: Failing tests (invalid → throws `CutlistExportError`):** zero dim, qty 0, missing band_edges, unknown board_type, empty groups, bad grain (one fixture each in `fixtures/ks/invalid/`).
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement `exportCupboard(doc)`: resolve root `definition.recipe`+`finish` → `collectOrientedParts` → `applyRoleRule` → `materialFor` → `partId` → group (carcass/doors) → `validate()` (throw `CutlistExportError` on the §invalid rules) → attach `cutlist_hash`,`schema_version`,`design_version`,`design_updated_at`,`generated_at`,`warnings`.
- [ ] **Step 5:** Generate the golden fixture by running `exportCupboard` on the recipe, **hand-review every role row against the confirmed Task 1 table**, then write it as `expected-cutlist.json`.
- [ ] **Step 6:** Run → PASS (happy + all invalid throw). **Step 7:** Commit `feat(ks): pure cupboard cutlist export + golden + invalid fixtures`.

## Task 10 — Orientation regression test
- [ ] **Step 1: Test:** two synthetic parts `1000×300` with `grain:"length"` vs `grain:"width"` map to the expected `length_mm`/`width_mm` per the role rules and do **not** collapse to the same oriented part (guards the descending-sort trap).
- [ ] **Step 2:** Run → PASS (logic exists). **Step 3:** Commit.

## Task 11 — Cross-repo import test (Unity)
**File:** Create `unity-erp/lib/cutlist/__tests__/ksProjectionImport.test.ts`.
- [ ] **Step 1: Test:** load `1200-cupboard.expected-cutlist.json` (copied/symlinked into a Unity test fixture), parse each group's parts with Unity's `CutlistPart` expectations (`lib/cutlist/types.ts`), assert every part has `grain ∈ {any,length,width}`, full `band_edges`, positive `length_mm`/`width_mm`, integer `quantity ≥ 1`.
- [ ] **Step 2:** Run `npx vitest run lib/cutlist/__tests__/ksProjectionImport.test.ts` (or the repo's runner) → PASS.
- [ ] **Step 3:** Commit (in `unity-erp`) `test(cutlist): KS projection fixture imports into CutlistPart shape`.

## Phase 1 Acceptance
- `exportCupboard` is pure (no React/DOM/three.js/localStorage/`node:`/`Deno.`), runs in Vitest and is importable by a Deno Edge Function.
- 1200-cupboard golden fixture matches; all 6 invalid fixtures throw `CutlistExportError`; orientation test green; Unity import test green.
- Role rules match Greg's confirmed table.
- **Codex adversarial review (`xhigh`)** finds no way to (a) emit a part with missing/incorrect `band_edges`/`grain`, (b) collapse two differently-oriented parts, (c) leak a non-deterministic id, (d) produce a non-canonical hash.

## Self-review (writing-plans)
- Spec coverage: parent §5 (pure module, role-driven, deterministic ids, canonical hash, validation, fixtures, orientation) — all mapped to Tasks 2–11. ✔
- Placeholders: only the role-rule **values** (grain/bands) are pending — gathered in Task 1 (blocking) before any dependent task, not a silent TBD. ✔
- Type consistency: `CutlistPart`/`CutlistGroup` names match parent §4 and Unity `lib/cutlist/types.ts`. ✔

## Codex Review Corrections (apply within these tasks)
- **#6 board_type/lamination:** `board_type` = lamination class (`'16mm'`/`'32mm-both'`), decor → `material_label`, add `lamination_type`/`lamination_group` to the schema (Task 2) — already fixed in Task 6; ensure the golden fixture (Task 9) uses class values, not `MELAMINE_*` tokens.
- **#7 role determinism:** first-word role + order-based left/right is fragile (traversal/aggregation order can swap IDs + band/grain on mirrored parts). Preferred: stamp an explicit `role`/panel-path in KS `buildCupboard` and read it; otherwise derive left/right by a **geometry tie-breaker** (e.g. left = smaller centroid X), never by iteration order. **Task 7 must add a test that left/right Side and Door IDs + `band_edges` stay stable when the part list is shuffled.**
- **#8 orientation test (strengthen Task 10):** use **axis-swapped asymmetric** fixtures (`1000×300×16` vs `300×1000×16`) and assert `length_mm`, `width_mm`, `grain`, **and** `band_edges` after role-rule mapping; add a negative fixture proving a descending-sort collector would collapse the two / fail. The two-`1000×300`-different-grain test alone is insufficient.
