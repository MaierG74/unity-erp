---
name: cutlist-pdf
description: Cutting diagram PDF layout, dimension labels, and rendering. Use when fixing or enhancing the PDF cutting diagram — panel labels, dimension overlays, sheet dimensions, legend table, or SVG layout.
argument-hint: "[issue or enhancement to address]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Cutlist PDF Skill

Scope: **$ARGUMENTS**

## Key Files

| File | Purpose |
|------|---------|
| `components/features/cutlist/CuttingDiagramPDF.tsx` | Main PDF renderer (`@react-pdf/renderer`) |
| `components/features/cutlist/preview.tsx` | Interactive canvas preview — **reference implementation** for visual accuracy |
| `components/features/cutlist/primitives/CuttingDiagramButton.tsx` | Download button, lazy-imports the PDF component |
| `lib/cutlist/types.ts` | `Placement`, `SheetLayout`, and related types |

## Critical: Lazy Import Rule

`@react-pdf/renderer` **must** be dynamically imported (causes build timeouts otherwise). The button component does this via `Promise.all([import('@react-pdf/renderer'), import('../CuttingDiagramPDF')])`.

## Data Model

### Placement Type (key fields)
- `x`, `y` — position on sheet (mm, top-left origin)
- `w`, `h` — **placed** dimensions on sheet (already accounts for rotation)
- `rot` — 0 or 90
- `original_length_mm`, `original_width_mm` — part's catalog dimensions (before placement)
- `grain` — 'length' | 'width' | 'any'
- `label` — letter identifier (A, B, C...)
- `part_id` — e.g. "Left Side", "Back"

### Dimension Display Rules
- **On-panel labels** (horizontal top, vertical left): always use `p.w` and `p.h` (placed dimensions). These match what the operator sees on the sheet.
- **Legend table**: uses `original_length_mm` and `original_width_mm` (catalog spec).
- **Preview component** (`preview.tsx`) is the source of truth for visual correctness — it uses `pl.w`/`pl.h`.

## Rotation Math for Vertical Labels

The PDF uses `@react-pdf/renderer` View transforms for vertical text.

### How `-90deg` rotation works with `transformOrigin: '0 0'`
- The element's top-left corner stays fixed at `(left, top)`
- Content rotates counterclockwise, extending **upward** from the anchor point
- After rotation: visual area spans from `(left, top - width)` to `(left + height, top)`

### Positioning formula for vertical panel labels
To center rotated text within a panel spanning `v.top` to `v.top + v.height`:
```
left: v.left + v.fontSize * 0.6      // slight inset from panel left edge
top:  v.top + v.height                // anchor at bottom; text extends upward to top
width: v.height                       // becomes the visual height after rotation
height: v.fontSize + 2               // becomes the visual width (thin)
transform: 'rotate(-90deg)'
transformOrigin: '0 0'
```

### Positioning formula for sheet length label (left side)
```
left: 2
top:  DIM_OFFSET + diagramH          // anchor at bottom of diagram area
width: diagramH                       // spans full diagram height
transform: 'rotate(-90deg)'
transformOrigin: '0 0'
```

## Layout Constants
- `DIM_OFFSET = 22` — reserved space for dimension labels outside the diagram area
- `PDF_PALETTE` — array of `{ bg, text }` color pairs for part coloring
- Scale: `Math.min((diagramW) / sheetW, (diagramH) / sheetL)` fits sheet into available space
- Diagram area: `pageW - margins - DIM_OFFSET` wide, dynamically sized height

## Legend Grain Symbols
`@react-pdf/renderer` does **not** reliably render Unicode — stick to ASCII:
- Long grain (`length`) → `|`
- Cross grain (`width`) → `-`
- Any / none → `o`

## Common Pitfalls
1. **Never use `original_width_mm`/`original_length_mm` for on-panel dimension labels** — these don't account for rotation and will show swapped values for rotated parts.
2. **Vertical text positioning**: with `rotate(-90deg)` + `transformOrigin: '0 0'`, content extends upward. Set `top` to the **bottom** of the desired visual area, not the center or top.
3. **Legend table**: DO use original dimensions here (L/W columns show catalog spec regardless of placement rotation).
4. **ASCII only in PDF text**: `@react-pdf/renderer` mangles many Unicode characters (em dash, arrows, circles). Always use plain ASCII equivalents.
5. **Testing**: always compare PDF output against the interactive preview (`preview.tsx`) — they should match visually.
