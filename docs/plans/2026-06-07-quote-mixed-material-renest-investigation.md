# Quote board costing with mixed per-part board materials — investigation & re-nest analysis

- **Date:** 2026-06-07
- **Status:** Investigation / finding (READ-ONLY). **No code changed.** No DDL proposed.
- **Branch context:** worktree `codex/local-costing-tree-bom-consolidation`
- **Scope:** How quote *board* costing behaves when a single quote line uses **different board materials per part** (e.g. 16 mm Iceberg White carcass + a Super-Black door, via per-part overrides), and whether it is materially mispricing.
- **Evidence base:** direct source reads (file:line below), `rg` call-graph checks, the **live** product-867 cutlist snapshot + the live persisted quote-cluster board line, and a 7-agent verification/adversarial workflow (4 independent verifiers + 3 adversarial skeptics). All three skeptics returned *holds-with-caveat* — the mechanism and root cause are confirmed; the caveats refine scope and are folded in below.

---

## TL;DR

When parts on one quote line use different boards, quote costing **does split into one priced line per distinct board** — but it derives each board's sheet quantity by **prorating the product nest's single, fixed total sheet count by part-area share**. It **does not re-nest**, and it **does not round each material up to whole sheets**. The total sheet count is *conserved* and merely redistributed by area.

That is materially wrong **whenever splitting forces an extra physical sheet** (you cannot cut black parts from a white sheet) **and** the product is billed per physical sheet (full / manual-% / global-full-board). On the live test product **867** (billed manual-80%), splitting the two doors onto a second board **under-prices the board subtotal by ~R650 (~33%)** with no warning to the estimator.

A secondary, narrower error exists even under the default *auto / used-area* billing: the split reuses the **product's** sheet size for every material, so a material that ships in a **different sheet format** is mis-billed by the sheet-area ratio (≈±40% for a 2440×1220 vs 2750×1830 mix).

| Billing basis (product 867) | Split scenario | Model board cost | True board cost | Error |
|---|---|---|---|---|
| **manual-80%** (867's real setting) | doors → 2nd board, equal price | R1,299.20 | R1,948.80 | **−R649.60 (−33.3%)** |
| **manual-80%** | doors → 2nd board @ R963 | R1,347.97 | R2,069.60 | **−R721.63 (−34.9%)** |
| auto / used-area, **same sheet size** | doors → 2nd board | R1,203.38 | R1,203.38 | 0% (exact) |
| auto / used-area, **different sheet size** | doors → 2440×1220 board | (under) | (true) | **≈−41%** (sheet-area ratio) |

**Recommendation:** worth fixing for shops that bill whole/percentage sheets (867 does). The pragmatic fix (Option B) is a contained change to one function with **no schema** — compute each material's sheet quantity from *its own* area and *its own* sheet size, rounding up to whole sheets under per-sheet billing. A true per-material re-nest (Option A) is the accurate-but-heavy alternative. A manual sheet-count override (Option C) would need schema → **stop and confirm with Greg before any DDL.**

---

## 1. The question

A quote line is linked to a product whose cutlist defines parts. The quote lets the operator change board/edging materials, including **per-part overrides** (e.g. doors in a different colour). When parts end up on different boards:

1. Does quote board cost **split per material**, or lump everything at one rate?
2. Because it re-prices a *fixed* nest rather than re-nesting, how big is the error — do we under- or over-count sheets/waste, and by how much for a typical cupboard?
3. Is this a real pricing gap worth fixing, and what are the options?

---

## 2. What the code does today

### 2.1 Data flow (no nesting anywhere in the quote path)

```
PATCH /api/quote-items/[id]/cutlist-material
  → buildQuoteCutlistSnapshot()              ← lib/quotes/build-cutlist-snapshot.ts (re-export)
      → buildCutlistSnapshot()               ← lib/orders/build-cutlist-snapshot.ts
            stamps each part's effective_board_id / effective_edging_id only — NO packing
      → stored on quote_items.cutlist_material_snapshot

Quote costing (create / refresh):
  buildQuoteProductCostingLines()            ← lib/quotes/build-costing-cluster.ts:806
    → productCutlistLines(..., cutlistMaterialSnapshot)        :471
        if snapshot present → deriveQuoteMaterialCutlistLines() :486-487   ← THE LOGIC
    → persisted as quote_cluster_lines

Quote costing UI:
  getQuoteCostingGroups()                     ← lib/quotes/costing-tree.ts:411
    only RE-READS the persisted lines and multiplies qty × unit_cost. No recompute.
```

- The quote material snapshot only records, per part, the *effective* board/edging — it never packs sheets. `lib/orders/build-cutlist-snapshot.ts:86` `const effectiveBoardId = override?.board_component_id ?? primaryMaterialId;` and `:91` for edging; parts returned as `{ ...part, effective_board_id, effective_edging_id, ... }` (`:94-103`).
- `costing-tree.ts` is render-only. Its own group descriptions say so: board materials are *"…using the product cutlist costing as the usage template"* (`lib/quotes/costing-tree.ts:77`, edging `:81`); `buildLineView` just multiplies `qty × unit_cost` (`:181-224`).

### 2.2 The core: `deriveQuoteMaterialCutlistLines` (lib/quotes/build-costing-cluster.ts:385-469)

**It splits per distinct board, then area-prorates a fixed total sheet count:**

- The board accumulator is keyed by **distinct `effective_board_id`** → one priced line per board (`:401` `const board = new Map<string, …>()`; `:406-408` `bid = effective_board_id` → `bkey`). One output line per entry, each priced at its **own** component price (`:447-450`). **So it splits, it does not lump.**
- The quantity it distributes is the product nest's **total** primary sheet count, summed **across all materials** (`:396`):
  ```ts
  const productPrimaryQty = deriveCutlistLines(productSnapshot)
    .filter(l => (l.cutlist_slot ?? '').startsWith('primary'))
    .reduce((s, l) => s + l.qty, 0);
  ```
  Those `l.qty` are the stored nest's *billed sheet fractions* (`:283` `current.qty += billedSheetFraction(...)`, `:292` `qty: roundQty(sheet.qty)`) — **no optimiser is run**; it reads the already-saved `product_cutlist_costing_snapshots.snapshot_data` (`:477-485`, fetched by `product_id` only).
- Each part contributes by **part-area share** (`:395` `totalArea`, `:405` `areaShare`, `:409`):
  ```ts
  const areaShare = (len * wid * qty) / totalArea;   // footprint share
  b.qty += productPrimaryQty * areaShare;             // distribute the fixed total
  ```
  Because `Σ areaShare = 1`, the **total board qty across all materials is exactly `productPrimaryQty`** — the split only *redistributes* the original single nest's sheet count; it can never add sheets.
- **No whole-sheet rounding per material:** the emitted qty is `roundQty(entry.qty)` and `roundQty` is `Math.round(value*1000)/1000` (3-dp, **not `Math.ceil`**) (`:78-80`, `:447-450`). Confirmed `rg` of the entire quote path: **no `Math.ceil` anywhere**.
- **Backer** uses the identical pattern (`:412-418`, `:451-453`): `bk.qty += productBackerQty * areaShare` keyed by `effective_backer_id`.

### 2.3 Billing-fraction branches (lib/quotes/build-costing-cluster.ts:254-263)

`billedSheetFraction` determines what `productPrimaryQty` *means*:

| Branch | Code | Meaning |
|---|---|---|
| global full board | `:255` `if (kind==='primary' && snap.global_full_board) return 1` | per **physical sheet** |
| per-sheet full | `:258` `if (billing_override.mode==='full') return 1` | per **physical sheet** |
| per-sheet manual | `:259` `mode==='manual' → Math.max(0, manualPct/100)` | per **physical sheet** (× pct) |
| auto (default) | `:261-262` `sheetUsedArea / sheetArea` | **used-area** (area-proportional) |

`sheetArea` (`:237-240`) and `sheetUsedArea` (`:231-234`) read the **product snapshot's** sheet dimensions. This matters for the auto-mode error in §3.3.

### 2.4 Live corroboration

Product **867** snapshot (live): 2 physical sheets, **both** board 926 (16 mm Iceberg White, R812/sheet, 2750×1830 = 5,032,500 mm²), each with `billing_override {mode:'manual', manualPct:80}` → billed = 0.80 + 0.80 = **1.60 sheets**. The persisted quote-cluster board line for the test item is exactly:

| slot | description | qty | unit | line cost |
|---|---|---|---|---|
| primary | 16mm Iceberg White (926) | **1.600** | R812 | R1,299.20 |
| band32 | Iceberg White PVC 36mm | 6.000 | R5.43 | R32.58 |
| band16 | Iceberg White PVC 20mm | 14.000 | R2.86 | R40.04 |

`1.600` = `productPrimaryQty` (single material, `areaShare` sums to 1). End-to-end chain validated against live data.

---

## 3. Pricing-impact analysis

### 3.1 The structural defect

Nesting is **sub-additive**: nesting all parts on one material shares offcuts → fewer sheets; splitting into N physically distinct materials forces **each** material to round up to ≥1 whole sheet independently → more sheets and more waste. Area-proration **conserves the single-material total**, so it is blind to the extra physical sheets a split forces. The product snapshot is even fetched by `product_id` alone (`:477-485`), so it *cannot* reflect quote-time, override-induced sheet changes.

### 3.2 Failure mode 1 — per-sheet billing + forced extra sheet → **under-bill** (dominant)

Worked example, real product-867 geometry, doors (Door Left + Door Right, 1722×437 each) split onto a 2nd board:

- Part areas: total `7,457,708 mm²` (= the nest's `used_area`); doors `1,505,028`; carcass `5,952,680`.
- Area shares: carcass `0.7982`, doors `0.2018`.
- **Physical reality:** carcass `5.953 m² > 5.0325 m²` → **2 sheets**; doors `1.505 m²` → **1 sheet**. The split forces **3 physical sheets** vs the combined nest's 2. The extra door sheet is exactly what the model omits.

Under 867's **manual-80%** basis:

| scenario | model billed sheets | true billed sheets | model board cost | true board cost | under-bill |
|---|---|---|---|---|---|
| doors @ equal price (R812) | 1.60 (1.277+0.323) | 2.40 (1.60+0.80) | R1,299.20 | R1,948.80 | **−R649.60 (−33.3%)** |
| doors @ R963 | 1.60 | 2.40 | R1,347.97 | R2,069.60 | **−R721.63 (−34.9%)** |

The understated board cost feeds markup, so the **sell price is set ~R650 too low** (or margin silently eroded by ~R650 if the price is held). For reference the whole line currently sells at R1,704.50 with a R1,371.82 board+edging base — a R650 board error is ~38% of that base.

General magnitude: under-bill ≈ `Σ_materials ceil(area/sheet) − N_combined` whole sheets × billed-fraction × price. It grows with the **number of distinct materials** and with how badly each minority material under-fills its forced sheet.

### 3.3 Failure mode 2 — auto / used-area billing + different sheet size → mis-bill

Auto mode is **exact only when every split material shares the product's sheet dimensions** (and the worked auto rows above confirm exactly R0 error in that case). But the split bills board *B* using the **product's** `sheetArea`, never *B*'s own:

```
model  B qty = area_B / sheetArea_product       (productPrimaryQty × areaShare collapses to this)
true   B qty = area_B / sheetArea_B             (re-nested on B's own sheets)
error factor = sheetArea_B / sheetArea_product
```

If doors move to a 2440×1220 board (2.976 M mm²) while primary is 2750×1830 (5.033 M), auto **under-bills the door board ≈41%** with zero whole-sheet rounding involved; a larger sheet over-bills. Real exposure: product 867's own board catalog already mixes 2730 and 2750 lengths (small here, ~0.7%), and melamine (2750×1830) vs MDF (2440×1220) is a realistic cross-material mix. **This breaks the comforting "auto is always safe" assumption.**

### 3.4 Failure mode 3 — multi-material *default* products → cost shifted (over **or** under)

If a product's **default** cutlist already spans materials (each group falls back to its own `primaryMaterialId`, `build-cutlist-snapshot.ts:86`), the product nest's `productPrimaryQty` is *already* the correct per-material whole-sheet sum — but the quote **re-prorates it by overall part-area share anyway** (`:409`), destroying that structure. At equal prices the total is conserved (≈net 0); at unequal prices it **shifts cost between materials**, so the error is not a monotone under-bill. (No overrides required to trigger this.)

### 3.5 Things that are *not* problems

- **Edging:** sold per metre (`deriveQuoteMaterialCutlistLines` scales metres per slot, `:455-467`); per-metre has no whole-unit rounding, so splitting edging is ~fine.
- **Lamination (32 mm):** investigated and **dismissed**. One verifier flagged that `effective_thickness_mm` doesn't double the area weight, but `boardCalculator.ts` `same-board` lamination sets `Qty = pieces to cut` ("Finished parts = Qty ÷ 2"), so `length×width×qty` already doubles board area. For 867 the quote's area sum equals the nest's `used_area` exactly — no discrepancy. (Worth a spot-check per template if ever relied on, but not a confirmed defect.)
- **Minor:** `deriveCutlistLines(productSnapshot)` is recomputed 3× (`:392, :396, :397`) — inefficiency only.

---

## 4. Is it a real pricing gap?

**Yes — for shops that bill whole/percentage sheets — but it is gated behind a compound, opt-in condition:**

1. The operator must split one line's parts across 2+ boards via **per-part overrides** (line-level material changes apply uniformly and do **not** trigger it; single-board lines are trivially exact). Two-tone / accent-door cabinets are the realistic trigger.
2. **AND** the product snapshot must use per-physical-sheet billing. This is **off by default** (`CutlistCalculator.tsx:347-357`: `sheetOverrides ?? {}`, `globalFullBoard ?? false`, `backerGlobalFullBoard ?? false`) — but **product 867 is set to manual-80%**, i.e. real products do turn it on. Per-sheet billing is arguably the *more correct* basis (you buy whole sheets; auto under-bills offcut waste).

Why it slips through: the derived board line shows only a subtle fractional sheet count (e.g. `0.323 sheets`) with **no whole-sheet alert**, and the costing refresh (`refreshQuoteItemCostingMaterials`, `:989`) re-derives the qty every time materials change — it preserves a unit-*cost* override/surcharge but **re-computes qty**, so a manual qty fix would be clobbered. A busy estimator will not reliably catch it.

**Net:** a shop on full/manual billing quoting two-tone cabinets silently under-prices board by ~⅓ of board cost on those lines. Genuine, but per-line / board-subtotal, not a blanket "every mixed line" or quote-level error.

---

## 5. Recommendation & options

The root cause is shared by all three failure modes: the quote prorates a **single scalar** (`productPrimaryQty`, on the product's sheet geometry) instead of computing **per-material consumption from per-material geometry**. Any real fix computes board quantity *per distinct material*.

### Option B — Per-material area + own sheet size + whole-sheet rounding (no SA) — **RECOMMENDED**
For each distinct `effective_board_id`: `material_area = Σ footprints on that board` (qty already encodes laminations); look up **that board's** sheet dimensions (from `calculator_inputs.primaryBoards` / the component); `sheets = material_area / (sheetArea_material × packingEfficiency)` where efficiency = the product nest's observed `used_area / (physicalSheets × sheetArea)`. Then **auto** bills `material_area/sheetArea_material` (used-area); **full/manual** bills `ceil(sheets)` (× manualPct). Mirror for backer.
- **Fixes failure modes 1, 2, 3.** Approximate only on packing efficiency (borrowed from the product nest).
- **Effort:** Medium — contained to `deriveQuoteMaterialCutlistLines` + a sheet-size lookup. **Risk:** Low–Medium. **Schema:** none.

### Option A — True per-material re-nest at quote time (run the SA optimiser per material)
Run `runSimulatedAnnealing` (`lib/cutlist/saOptimizer.ts:329`) per distinct board with the quote's materials + each board's stock sheet size.
- **Most accurate** (real packing + waste). 
- **Effort:** High — the optimiser is currently **client-side** (`saWorker.ts`, `components/features/cutlist/packing.ts`); running it server-side in the costing path needs a server-runnable port, a per-material stock-sheet catalog, perf/determinism work. **Risk:** Medium–High. **Schema:** none, but heavy.

### Option C — Manual per-material sheet-count override on the quote
Let the operator set billed sheets per board on the line.
- **Effort:** Low–Medium algorithmically, but durable storage that survives `refreshQuoteItemCostingMaterials` (which re-derives qty) almost certainly needs a **new persisted field/column** → **SCHEMA**. **⚠ Stop and confirm with Greg before any DDL — not assumed here.** Best as an *interim/escape hatch* layered on Option B, not the primary fix.

---

## 6. Decision points for Greg

1. **Scope/priority:** Do operators actually split one quote line's parts across multiple boards today (two-tone / accent doors), and is that expected to grow? If rare, this is low priority.
2. **Billing basis in the field:** How many product cutlist snapshots use full/manual/global-full vs the default auto? (867 uses manual-80%.) The more per-sheet billing in use, the harder failure mode 1 bites.
3. **Sheet-format mixing:** Do any boards ship in a different sheet size than the primary (e.g. MDF 2440×1220 vs melamine 2750×1830)? If yes, failure mode 2 means even default-auto shops are exposed.
4. **Which fix:** Option **B** (recommended — no schema, fixes all three modes) vs **A** (exact re-nest, heavy) vs **C** (manual override — **needs schema, requires your go-ahead before DDL**).
5. **Also-fix:** Apply the same correction to **backer** boards (same defect class). Lamination piece-count semantics looked correct for 867 but could be spot-checked per template if Option A/B relies on them.

---

## Appendix A — Evidence index

| Claim | Evidence |
|---|---|
| Splits per distinct board, prorates fixed total by area | `lib/quotes/build-costing-cluster.ts:395-396, 401-409, 447-450` |
| `productPrimaryQty` = summed nest sheets, no optimiser | `…:396, 283, 292, 477-487` |
| No whole-sheet rounding (3-dp round, not ceil) | `…:78-80, 447-450`; `rg` no `Math.ceil` in quote path |
| Billing branches (full/manual/auto) | `…:255-262` |
| `sheetArea` uses product sheet dims (auto-mode mode-2 bug) | `…:237-240, 231-234` |
| Backer same pattern | `…:412-418, 451-453` |
| Snapshot only stamps effective materials, no nesting | `lib/orders/build-cutlist-snapshot.ts:86, 91, 94-103` |
| costing-tree renders only ("usage template") | `lib/quotes/costing-tree.ts:77, 81, 181-224` |
| Optimiser lives only on cutlist side | `lib/cutlist/saOptimizer.ts:329`; callers `lib/cutlist/saWorker.ts:20`, `components/features/cutlist/packing.ts:582,613` |
| Per-sheet billing off by default | `components/features/cutlist/CutlistCalculator.tsx:347-357` |
| Lamination = pieces-to-cut (red herring) | `lib/cutlist/boardCalculator.ts` `same-board` case (~`:229-238`) |
| Qty refresh clobbers manual qty | `lib/quotes/build-costing-cluster.ts:989-1042` (preserves cost/surcharge, re-derives qty) |

## Appendix B — Live data snapshot (project ttlyfhkrsjjrzxiagzpb, 2026-06-07)

- Quote `00d57d33-5118-42c3-a969-6b66e2c10e06` ("TestMelamineChange"), item `c51d2372-fbfc-4fca-ae83-bd584fada42a`, product 867, qty 1, unit_price R1,704.50.
- Snapshot: 2 groups, **0 part overrides** (currently single-material — the mixed case is induced via overrides).
- Product 867 nest: `global_full_board=false`, 2 sheets both board 926, each `billing_override {manual, 80%}` → 1.60 billed; `used_area=7,457,708`; board prices 926=R812, 408=R963, 658=R907, 448=R797.05.

## Appendix C — Methodology

Direct source reads + `rg` call-graph + live Supabase reads, then a 7-agent workflow: 4 independent verifiers (area-proration mechanism, no-re-nest negative claim, billing-mode dependency, numeric quantification) and 3 adversarial skeptics (mechanism, billing-mode dichotomy, real-world materiality). All four verifier claims returned **supported**; all three skeptics returned **holds-with-caveat** (none refuted the mechanism/root cause). Skeptic contributions folded in: failure mode 2 (auto + different sheet size), failure mode 3 (multi-material defaults), the compound opt-in materiality framing, and dismissal of the lamination concern.
