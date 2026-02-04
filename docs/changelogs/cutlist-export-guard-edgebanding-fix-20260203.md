---
title: Cutlist Export Guard + Edgebanding Fix
published: 2026-02-03
---

## Summary
- Fixed edgebanding length calculations to align edge labels with part dimensions.
- Added export confirmation with replace vs keep-existing options.
- Prompted recalculation before exporting when inputs change.

## Details
- Top/bottom edges now map to part width, left/right to part length in the cutlist calculator.
- Export can replace prior cutlist costing lines or keep existing ones, with clear user prompts.
- If parts/materials change after a calculation, export now requires a fresh recalculation.
- Stabilized cutlist export callbacks to prevent render loops when recalculating layouts.
- Expanded cutlist slot validation to support dynamic edging line slots (edging_*).
- Export now writes per-material primary board lines (primary_*) so mixed-material layouts show up in costing.
- Added an edging breakdown toggle in the cutlist preview summary to show usage by edging material.
