# Furniture Configurator

## Overview

The Furniture Configurator is a parametric design tool that auto-generates cutlist parts from dimension inputs. It replaces the SketchUp workflow for standard melamine furniture products by letting users configure dimensions, shelves, doors, and construction options, then immediately generating a complete parts list compatible with the cutlist optimizer.

**Status**: POC complete (cupboard template). Extensible to desks, pedestals, bookshelves.

**Route**: `/products/[productId]/configurator`

## Architecture

### Template Pattern

The system uses a `FurnitureTemplate<TConfig>` interface for extensibility:

```
FurnitureTemplate<TConfig> {
  id: string
  name: string
  description: string
  defaultConfig: TConfig
  generateParts: (config: TConfig) => CutlistPart[]
}
```

Templates are registered in `lib/configurator/templates/index.ts`. Adding a new furniture type (e.g., desk) requires:
1. Define config interface and defaults in `types.ts`
2. Create generator function in a new file (e.g., `desk.ts`)
3. Register in `index.ts`
4. Create form and preview components

### File Structure

| File | Purpose |
|------|---------|
| `lib/configurator/templates/types.ts` | `CupboardConfig` interface, defaults, `FurnitureTemplate` generic |
| `lib/configurator/templates/cupboard.ts` | Pure function: config -> `CutlistPart[]` |
| `lib/configurator/templates/index.ts` | Template registry with lookup helpers |
| `components/features/configurator/CupboardForm.tsx` | Configuration form with all options |
| `components/features/configurator/CupboardPreview.tsx` | SVG 2D preview (front + side views) |
| `components/features/configurator/FurnitureConfigurator.tsx` | Orchestrator: form + preview + parts table + save |
| `app/products/[productId]/configurator/page.tsx` | Next.js page route |

### Integration Points

- **Output**: `CutlistPart[]` (same type used by existing cutlist system)
- **Save**: `POST /api/products/[productId]/cutlist-groups?module=furniture_configurator`
- **Navigation**: "Save & Open Cutlist Builder" routes to `/products/[productId]/cutlist-builder`
- **Entry**: "Design with Configurator" button on product detail page (Cutlist tab)

### Module Entitlement Gating

The configurator is now tenant-gated via module entitlements:

- **Module key**: `furniture_configurator`
- **Access check API**: `GET /api/me/module-access?module=furniture_configurator`
- **Admin toggle UI**: `/admin/modules` (Unity super admin)

Enforcement layers:
1. Product detail UI hides/disables the configurator launch button when not entitled.
2. `/products/[productId]/configurator` page checks entitlement before rendering.
3. Save calls include `module=furniture_configurator` so server-side API checks the module gate.

Implementation notes:
- Module keys are centralized in `lib/modules/keys.ts`.
- Client module-access checks are shared through `lib/hooks/use-module-access.ts` to keep product page and configurator page behavior consistent.

## Cupboard Construction Rules

Real-world melamine cupboard assembly (bottom to top):

1. **Adjusters** (default 10mm) - levelling feet at the bottom
2. **Base** (32mm laminated) - 2x 16mm sheets same colour, sits on adjusters
3. **Sides** - sit ON the base, between base and top
4. **Top** (32mm laminated) - 2x 16mm sheets same colour, sits ON TOP of sides
5. **Back panel** - sits flush on base top surface, slots into routed groove in top underside

### Key Formulas

| Dimension | Formula |
|-----------|---------|
| Carcass width | `W - max(topOverhangSides, baseOverhangSides) * 2` |
| Carcass depth | `D - max(topOverhangBack, baseOverhangBack)` |
| Side height | `H - adjusterHeight - 32mm(top) - 32mm(base)` |
| Internal width | `carcassWidth - 2T` |
| Back height | `sideHeight + backSlotDepth` |
| Top dimensions | `(carcassWidth + topOverhangSides*2) x (carcassDepth + topOverhangBack)` |
| Base dimensions | `(carcassWidth + baseOverhangSides*2) x (carcassDepth + baseOverhangBack)` |

### Configuration Parameters

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| Width | 900mm | 100-3600 | Overall external width |
| Height | 1800mm | 100-3600 | Including adjusters |
| Depth | 500mm | 50-1200 | Including overhang at back |
| Board thickness | 16mm | 16/18/25 | Material thickness |
| Shelf count | 3 | 0-10 | Evenly spaced fixed shelves |
| Door style | double | none/single/double | Overlay doors |
| Has back | true | on/off | Back panel toggle |
| Back thickness | 3mm | 3/16 | 3mm hardboard or 16mm melamine |
| Door gap | 2mm | 1-5 | Gap between doors and carcass |
| Shelf setback | 2mm | 0-10 | Shelf inset from front edge |
| Adjuster height | 10mm | 0-50 | Levelling feet height |
| Top overhang sides | 10mm | 0-30 | Top past side panels (L+R) |
| Top overhang back | 10mm | 0-30 | Top past back edge |
| Base overhang sides | 10mm | 0-30 | Base past side panels (L+R) |
| Base overhang back | 10mm | 0-30 | Base past back edge |
| Back slot depth | 8mm | 0-15 | Routed groove in top for back panel |

**Tip**: Set overhangs to 0 for side-by-side cupboard installations (flush edges).

### Generated Parts

| Part | Edge Banding | Lamination | Notes |
|------|-------------|------------|-------|
| Top (x2) | All 4 edges | same-board | 32mm laminated pair |
| Base (x2) | All 4 edges | same-board | 32mm laminated pair |
| Left Side | Front edge (right) | none | Sits between top and base |
| Right Side | Front edge (left) | none | Sits between top and base |
| Shelves (x N) | Front edge (top) | none | Evenly spaced |
| Back | None | none | Optional, hardboard or melamine |
| Door(s) | All 4 edges | none | Single or double, overlay style |

## User Workflow

1. Navigate to product detail page
2. Click "Design with Configurator" button in Cutlist tab
3. Adjust dimensions and options in the left panel
4. SVG preview updates in real-time on the right
5. Review generated parts table below
6. Click "Save to Product" or "Save & Open Cutlist Builder"
7. Parts flow into existing cutlist optimizer for sheet nesting

## Future Extensions

- **Desk template**: Fixed-height frame with drawer pedestal options
- **Pedestal template**: 3-drawer or file-drawer configurations
- **Bookshelf template**: Open shelving with optional doors
- **Quotes integration**: Design furniture directly from quote line items
- **3D preview**: Three.js-based 3D visualization (Tier 2/3)
