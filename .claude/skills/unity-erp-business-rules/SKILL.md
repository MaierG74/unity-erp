---
name: unity-erp-business-rules
description: Unity ERP domain-specific business rules. Use when working on staff/attendance/payroll, time clock logic, file storage/uploads, or any module where non-obvious business logic applies.
argument-hint: "[module or feature being worked on]"
allowed-tools: Read, Grep, Glob
---

# Unity ERP Business Rules

Scope: **$ARGUMENTS**

These rules encode non-obvious domain logic. Do not guess — follow them exactly.

## Staff & Attendance

- **Tea break deductions**: Mon–Thu 30 min automatic deduction; Friday none.
- **Pay rates**: first 9 hrs regular rate, after 9 hrs overtime (1.5x), Sunday all double-time (2x).
- **Source of truth**: `time_clock_events` table.

## File Storage

- Supabase Storage, bucket `QButton`, path `Price List/{filename}`.

## Cutlist & Panel Saw Cutting

- **Continuous-rip rule**: Once a panel-saw cut starts, it must travel from one edge of the workpiece to the opposite edge — you cannot stop a cut mid-board. The "workpiece" is whatever piece is currently in the saw: every cut produces two new workpieces, and subsequent cuts on either of them are edge-to-edge of that smaller piece. Both `guillotinePacker.ts` and `stripPacker.ts` produce layouts that are physically valid under this rule (guillotine packing is the algorithmic model of this exact constraint); no special audit needed.
- **Implication for offcut sizing**: Reusable-offcut dimensions reported by the packer must subtract the kerf padding on any edge that abuts a cut. A free rect that the packer represents as 753 × 824 mm with a 3 mm kerf reserved on its right edge is physically a 750 × 824 mm offcut after the operator makes the rip — the kerf is consumed wherever the cut lands. Do NOT report the optimistic kerf-inclusive width; operators expect the post-cut physical size.
- **Default kerf**: 3 mm (strip packer) / 4 mm (guillotine packer fallback) when `stock.kerf_mm` is not set.
