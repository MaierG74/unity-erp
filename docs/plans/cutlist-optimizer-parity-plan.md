# Cutlist Optimizer Parity Plan

> **Status**: Draft
> **Owner**: Unassigned
> **Last Updated**: 2026-01-26
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

## Implementation Tasks (Draft)
- [ ] Build a small benchmarking harness for the evaluation dataset.
- [ ] Add offcut quality scoring and fragmentation metrics to results.
- [ ] Add “Optimization Priority” selector to `/cutlist`.
- [ ] Wire UI to pass `algorithm` and optional time budget.
- [ ] Add tests for strip default + guillotine mode.
- [ ] Document algorithms and usage in a new technical doc.

## Risks & Mitigations
- **Longer runtime**: time‑box optimization passes; fall back to best result.
- **Higher cut count**: keep Strip as default and expose cut‑minimizing mode.
- **User confusion**: add short tooltips describing trade‑offs.

## Open Questions
- What is the acceptable upper bound for “Optimize longer” (1s, 2s, 3s)?
- Should “Best offcut” become default for specific roles (production vs estimator)?
- Do we need to enforce a minimum offcut dimension (e.g., 300mm)?

