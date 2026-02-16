# Cutlist Optimizer Parity Plan

> **Status**: Complete (SA optimizer + presentation upgrade + SA fix 2026-02-13)
> **Owner**: Unassigned
> **Last Updated**: 2026-02-13
> **Related UI**: `/cutlist`

## Goal
Match or approach CutlistOptimizer’s nesting quality (usable offcut consolidation) while retaining guillotine‑cuttable layouts and predictable runtimes.

## Current State (As‑Is)
- `/cutlist` runs `packPartsSmartOptimized()` with the **strip** algorithm by default.
- The **guillotine** packer exists but is not wired into the UI.
- `docs/clist/` is archival research and should remain unchanged.

## Constraints
- **Guillotine cuts** only: every cut must traverse the full sheet (panel saw).
- **Grain direction** must be respected (`any | length | width`).
- **Kerf** applied between cuts.
- **Runtime** should be near‑instant by default; optional longer optimization may be acceptable.
- **Offcut quality** is a key business objective (prefer one large block vs. many strips).

## Success Metrics
Primary:
- **Sheets used** (minimize).
- **Largest contiguous offcut area** (maximize).

Secondary:
- **Total waste area** (minimize).
- **Cut count / cut length** (minimize).
- **Runtime** (target < 250ms for default; allow 1–3s for “optimize longer”).

## Evaluation Dataset
Create a small, repeatable test set:
1. **Screenshot case** from Unity ERP (3 part sizes, grain enabled, kerf=3).
2. **Mixed cabinet job** (tall + wide + small filler).
3. **Drawer fronts** (smaller parts, low variety).
4. **High‑quantity uniform parts** (stress test).
5. **Grain‑constrained mix** (length/width/any).

Each dataset should record:
- Sheet size, kerf, part list with qty, grain.
- Output metrics for Strip, Guillotine, and CutlistOptimizer.

## Phased Plan

### Phase 1: Baseline & Benchmark
- Run current Strip algorithm on the dataset.
- Capture: sheets used, largest offcut area, waste %, cuts, runtime.
- Compare against CutlistOptimizer outputs.

### Phase 2: Algorithm Comparison
- Run Guillotine algorithm with multiple sort strategies.
- Evaluate scoring tweaks to favor offcut consolidation.
- Identify best‑performing configurations per dataset.

### Phase 3: Optimization Options
- Define **Optimization Priority** modes:
  - **Fast / Fewer cuts** (Strip default).
  - **Best offcut** (Guillotine + waste scoring).
  - **Optimize longer** (multi‑pass heuristics, time budgeted).
- Decide defaults and expose mode selection in UI.

### Phase 4: UX & Reporting
- Add an algorithm / priority selector in `/cutlist`.
- Surface runtime and optimization priority in results.
- Store user preference locally.

### Phase 5: Validation & Rollout
- Add tests for strip and guillotine paths.
- Validate guillotine cut correctness and grain constraints.
- Update documentation and changelog.

## Implementation Tasks
- [x] Build a small benchmarking harness for the evaluation dataset.
- [x] Add offcut quality scoring and fragmentation metrics to results.
- [x] Add "Optimization Priority" selector to `/cutlist`.
- [x] Wire UI to pass `algorithm` and optional time budget.
- [x] Add tests for strip default + guillotine mode.
- [x] Document algorithms and usage in feature docs.
- [x] **Simulated Annealing optimizer** (`lib/cutlist/saOptimizer.ts`) — 5 neighborhood moves, geometric cooling, stagnation reheating, V2 scoring heavily weighted toward offcut quality (2026-02-13).
- [x] **Web Worker** (`lib/cutlist/saWorker.ts`) — off-main-thread execution with progress/cancel protocol (2026-02-13).
- [x] **Progressive UI** — live progress bar, elapsed/iterations/improvements display, time budget selector (10s/30s/60s), "Stop & Keep Best" cancel (2026-02-13).
- [x] **Per-sheet offcut tracking** — `SheetOffcutInfo` type added to `GuillotinePackResult` (2026-02-13).
- [x] **SA tests** — 6 tests covering score comparison, grain constraints, scoring function, time budget, progress callbacks, cancellation (2026-02-13).
- [x] **V2 scoring compactness term** — Added bounding box penalty (×50) to prevent SA from spreading parts on single-sheet jobs (2026-02-13).
- [x] **Strip fallback safety net** — `packing.ts` compares SA result vs strip packer after completion; returns whichever scores better. Guarantees SA never regresses below Fast mode (2026-02-13).
- [x] **World-class presentation upgrade** — Color-coded parts (12-color palette), grain direction overlays, edge banding indicators, interactive pan/zoom dialog with legend/tooltip, operator cutting diagram PDF, framer-motion animations (2026-02-13).
- [x] **Placement metadata propagation** — Extended `Placement` type with grain, band_edges, lamination_type, material_id/label, original dimensions. Propagated through both guillotine and strip packers (2026-02-13).
- [x] **UX polish** — Fixed legend showing CSV IDs instead of part names, fixed zoom containment overflow, cleaned up thumbnail labels, clickable thumbnail cards, header with dimensions/usage, legend grain/edge info column (2026-02-13).

## Risks & Mitigations
- **Longer runtime**: time‑box optimization passes; fall back to best result.
- **Higher cut count**: keep Strip as default and expose cut‑minimizing mode.
- **User confusion**: add short tooltips describing trade‑offs.
- **SA regression on small jobs**: Strip fallback safety net guarantees SA >= strip quality.

## Open Questions
- ~~What is the acceptable upper bound for "Optimize longer" (1s, 2s, 3s)?~~ Resolved: 10s/30s/60s options.
- Should "Best offcut" become default for specific roles (production vs estimator)?
- Do we need to enforce a minimum offcut dimension (e.g., 300mm)?

