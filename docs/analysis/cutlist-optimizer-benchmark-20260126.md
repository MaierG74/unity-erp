# Cutlist Optimizer Benchmark (2026-01-26)

## Scope
Single dataset benchmark comparing Strip (default), Guillotine, and Legacy packers in Unity ERP.

## Dataset
- Sheet: 2730 x 1830 mm
- Kerf: 3 mm
- Parts:
  - 900 x 600 mm (qty 1)
  - 700 x 580 mm (qty 4)
  - 848 x 400 mm (qty 1)
- Grain: `any` for all parts

## Method
- Ran `npx tsx scripts/cutlist-benchmark.ts`.
- Runtime measured as average over 200 runs.
- Largest offcut area:
  - Strip: derived from strip layout (top remainder + per-strip right remainder).
  - Guillotine: largest free rectangle from the packer.
  - Legacy: approximate right/top remainder based on placement bounds.

## Results

| Algorithm | Sheets | Used Area (mm2) | Waste Area (mm2) | Waste % | Cuts | Cut Length (mm) | Largest Offcut (mm2) | Avg Runtime (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Strip | 1 | 2,503,200 | 2,492,700 | 49.89 | 9 | 8,908 | 947,940 | 0.03 |
| Guillotine | 1 | 2,503,200 | 2,492,700 | 49.89 | 12 | 7,868 | 1,422,827 | 0.06 |
| Legacy | 1 | 2,503,200 | 2,492,700 | 49.89 | 12 | 7,868 | 505,080 | 0.02 |

## Notes
- Guillotine produced the largest contiguous offcut in this dataset.
- Strip minimized cuts but left smaller, more fragmented offcuts.
- Offcut sizing for Legacy is approximate and should be refined if used for decisions.

