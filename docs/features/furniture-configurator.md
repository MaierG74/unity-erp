# Furniture Configurator

## Overview

The Furniture Configurator is a parametric design tool that auto-generates cutlist parts from dimension inputs. It replaces the SketchUp workflow for standard melamine furniture products by letting users configure dimensions, shelves, doors, and construction options, then immediately generating a complete parts list compatible with the cutlist optimizer.

**Status**: Pilot implementation live for cupboard, pigeonhole, and desk-height pedestal templates. The cupboard preview now runs on a shared SVG scene foundation for technical drawings plus a real Three.js 3D inspection view; the other templates still use older one-off preview components.

**Deep dive plan**: [`../plans/2026-03-01-furniture-configurator-manufacturing-deep-dive.md`](../plans/2026-03-01-furniture-configurator-manufacturing-deep-dive.md)

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

Templates are registered in `lib/configurator/templates/index.ts`. Adding a new furniture type requires:
1. Define config interface and defaults in `types.ts`
2. Create generator function in a new file (e.g., `desk.ts`)
3. Register in `index.ts`
4. Create form and preview scene/component wiring

### Preview Layer

The technical preview is now being split into a shared scene model plus reusable SVG renderer, rather than keeping all geometry and drawing logic embedded in each React component.

- `ConfiguratorPreviewScene` is the intermediate drawing model used by the renderer.
- `TechnicalSvgPreview` handles zoom, pan, fit-to-drawing framing, fullscreen, and SVG export.
- Template-specific scene builders convert configurator state into technical drawing nodes.
- The cupboard 3D tab is now separate from the SVG renderer and uses Three.js so the assembly can be inspected with real depth, opened doors, and an interior view mode.

The cupboard template is the first adopter of this structure and currently renders:
- front view
- side view
- top view
- assembly-order detail
- rear detail inset
- real-time 3D inspection view

### File Structure

| File | Purpose |
|------|---------|
| `lib/configurator/templates/types.ts` | `CupboardConfig` interface, defaults, `FurnitureTemplate` generic |
| `lib/configurator/templates/cupboard.ts` | Pure function: config -> `CutlistPart[]` |
| `lib/configurator/templates/cupboardGeometry.ts` | Shared derived cupboard dimensions used by cutlist and 3D preview |
| `lib/configurator/templates/index.ts` | Template registry with lookup helpers |
| `lib/configurator/render/cupboardThreeModel.ts` | Shared Three.js cupboard model builder and finish palette logic used by preview/render modes |
| `lib/configurator/preview/scene.ts` | Shared preview scene types, dimension helpers, SVG serialization/export |
| `lib/configurator/preview/cupboardScene.ts` | Cupboard technical scene builder |
| `components/features/configurator/shared/TechnicalSvgPreview.tsx` | Shared SVG renderer with pan/zoom/fit/fullscreen/export |
| `components/features/configurator/CupboardForm.tsx` | Configuration form with all options |
| `components/features/configurator/CupboardThreePreview.tsx` | Three.js-based cupboard 3D inspection preview with assembly/interior modes plus in-app path-traced render mode |
| `components/features/configurator/CupboardPreview.tsx` | Thin wrapper that switches between cupboard technical and 3D preview modes |
| `components/features/configurator/FurnitureConfigurator.tsx` | Orchestrator: form + preview + parts table + save |
| `app/products/[productId]/configurator/page.tsx` | Next.js page route |

### Integration Points

- **Output**: `CutlistPart[]` (same type used by existing cutlist system)
- **Save**: `POST /api/products/[productId]/cutlist-groups?module=furniture_configurator`
- **Navigation**: "Save & Open Cutlist Builder" routes to `/products/[productId]/cutlist-builder`
- **Entry**: "Design with Configurator" button on product detail page (Cutlist tab)
- **Reference drawing capture**: after a successful save, the technical preview is captured as a PNG under `QButton/Product Drawings/{product_id}/{uuid}.png` and persisted to `products.configurator_drawing_url`. Capture failures show a warning toast and do not block the cutlist save.

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
2. **Base** - configurable as:
   - single 16mm board
   - 32mm laminated pair (2x 16mm same-colour)
   - 32mm cleated base (1x full 16mm panel plus 100mm-wide 16mm underside cleats on all four sides)
3. **Sides** - sit ON the base, between base and top
4. **Top** - configurable as single 16mm or 32mm laminated, sits ON TOP of sides
5. **Back panel** - sits flush on base top surface, slots into routed groove in top underside

### Key Formulas

| Dimension | Formula |
|-----------|---------|
| Carcass width | `W - max(topOverhangSides, baseOverhangSides) * 2` |
| Carcass depth | `D - max(topOverhangFront, baseOverhangFront) - max(topOverhangBack, baseOverhangBack)` |
| Top thickness | `T` for `single`, `2T` for `laminated` |
| Base thickness | `T` for `single`, `2T` for `laminated` or `cleated` |
| Side height | `H - adjusterHeight - topThickness - baseThickness` |
| Internal width | `carcassWidth - 2T` |
| Back height | `sideHeight + backSlotDepth` |
| Top dimensions | `(carcassWidth + topOverhangSides*2) x (carcassDepth + topOverhangFront + topOverhangBack)` |
| Base dimensions | `(carcassWidth + baseOverhangSides*2) x (carcassDepth + baseOverhangFront + baseOverhangBack)` |
| Cleated base cleat width | `min(100, floor(min(baseWidth, baseDepth) / 2))` |

### Configuration Parameters

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| Width | 900mm | 100-3600 | Overall external width |
| Height | 1800mm | 100-3600 | Including adjusters |
| Depth | 500mm | 50-1200 | Overall outside depth including front and back overhangs |
| Board thickness | 16mm | 16/18/25 | Material thickness |
| Top build | laminated | single/laminated | Single 16mm or 32mm laminated top |
| Base build | cleated | single/laminated/cleated | Single 16mm, 32mm laminated, or 32mm cleated base |
| Shelf count | 3 | 0-10 | Evenly spaced fixed shelves |
| Door style | double | none/single/double | Overlay doors |
| Has back | true | on/off | Back panel toggle |
| Back thickness | 3mm | 3/16 | 3mm hardboard or 16mm melamine |
| Door gap | 2mm | 1-5 | Gap between doors and carcass |
| Shelf setback | 2mm | 0-10 | Shelf inset from front edge |
| Adjuster height | 10mm | 0-50 | Levelling feet height |
| Top overhang sides | 10mm | 0-30 | Top past side panels (L+R) |
| Top overhang front | 0mm | 0-30 | Top past front edge |
| Top overhang back | 10mm | 0-30 | Top past back edge |
| Base overhang sides | 10mm | 0-30 | Base past side panels (L+R) |
| Base overhang front | 0mm | 0-30 | Base past front edge |
| Base overhang back | 10mm | 0-30 | Base past back edge |
| Back slot depth | 8mm | 0-15 | Routed groove in top for back panel |

**Tip**: Set overhangs to 0 for side-by-side cupboard installations (flush edges).

### Generated Parts

| Part | Edge Banding | Lamination | Notes |
|------|-------------|------------|-------|
| Top | All 4 edges | none | Single 16mm top when `Top build = single` |
| Top (x2) | All 4 edges | same-board | 32mm laminated top when `Top build = laminated` |
| Base | All 4 edges | none | Single 16mm base when `Base build = single` |
| Base (x2) | All 4 edges | same-board | 32mm laminated base when `Base build = laminated` |
| Base Panel (cleated) | All 4 edges | none | Full 16mm panel used for a cleated base |
| Base Cleat Front/Back (x2) | None | none | 100mm-wide underside cleats for the front and rear |
| Base Cleat Sides (x2) | None | none | 100mm-wide underside side cleats, trimmed between front/rear cleats |
| Left Side | Front edge (right) | none | Sits between top and base |
| Right Side | Front edge (left) | none | Sits between top and base |
| Shelves (x N) | Front edge (top) | none | Evenly spaced |
| Back | None | none | Optional, hardboard or melamine |
| Door(s) | All 4 edges | none | Single or double, overlay style |

For the cleated base, the configurator treats the finished base as a 32mm assembly for side-height and preview purposes, but the cutlist stays true to manufacture: one full 16mm base panel plus four 16mm cleats.

## User Workflow

1. Navigate to product detail page
2. Click "Design with Configurator" button in Cutlist tab
3. Adjust dimensions and options in the left panel
4. Technical SVG preview updates in real-time on the right, with a 3D inspection tab available on the cupboard template
5. Review generated parts table below
6. Click "Save to Product" or "Save & Open Cutlist Builder"
7. Parts flow into existing cutlist optimizer for sheet nesting

For the cupboard template, the live preview now includes front, side, top, assembly-order, and rear-detail views plus a Three.js 3D tab. The 3D view supports assembly and interior inspection modes, explicit pan controls in addition to rotate/zoom, PNG download, fullscreen inspection, and a new in-app `Render` mode powered by a WebGL path tracer for higher-quality stills without leaving the browser. Render mode now uses a clean product-shot setup with a neutral background and explicit studio lights rather than a visible tinted room, keeps the preview shadow plane out of the final image, includes visible `Pause Render` / `Save PNG` controls, and exposes `Dim / Studio / Bright` lighting presets so the user can tune the shot without leaving the configurator. Entering `Render` now preserves the exact camera/view the user composed in `Preview`, and `Pause Render` freezes the traced image instead of dropping back to the live raster viewport. Preview and render now share the same cupboard scene instance, with only the lighting/path-tracing pipeline changing between modes, so repeated toggling does not reassign finishes unpredictably. The panel render path also now uses an explicit edge shell plus separate broad-face skins instead of relying on shared multi-face box materials, which keeps the Brookhill-versus-white assignment stable under the path tracer. Those broad-face skins are now oriented as true single-sided faces, and the melamine back stays opaque in interior render mode, which avoids the back-panel artifacts that showed up when the path tracer was sampling double-sided ghosted faces. Path tracing is initialized lazily when the user enters `Render`, and any renderer failure is surfaced inline instead of silently hard-disabling the control. The current 3D pilot now also supports separate `Carcass` and `Doors` finish selectors, so one pilot board decor such as Brookhill can be combined with a white front while the broader material library is still being built. Fronts are now rendered as fully opaque in that two-tone mode so the carcass finish does not bleed through the door colour during path-traced renders. The top/rear technical details now call out the back panel thickness more explicitly, keep the back strip on the true rear edge of the top view, show the top-groove capture relationship for workshop use, and keep the side-view back panel seated on the base while extending upward into the top groove. The assembly-details area has also been tightened toward shorter workshop-facing copy, and the rear inset is now a focused top-rear join detail rather than a compressed mini full-height sketch.

## Current Gaps

The current implementation is strong as a product-authoring proof of concept, but it is not yet a full manufacturing handoff.

- **Persistence stops at cutlist groups**: saving writes `product_cutlist_groups`, but does not persist a versioned configurator definition, drawing artifact, or frozen manufacturing snapshot.
- **No job-card handoff yet**: the job-card PDF can accept a drawing, but configurator-generated drawings are not yet persisted or attached to job cards.
- **Shared preview architecture is only partially adopted**: cupboard uses the new scene-based renderer, but pigeonhole and pedestal previews still need to migrate onto the same technical drawing foundation.
- **3D preview is cupboard-only and inspection-focused**: the new Three.js view solves depth and visibility problems for the cupboard, but pigeonhole and pedestal still need equivalent treatment if 3D becomes a broader paid feature.
- **Banding override flow is incomplete**: cutlist rows can be edited one-by-one, but configurator-driven work still needs better bulk controls such as reset/apply defaults for edge banding.
- **Generated parts need richer metadata**: future drawing generation, assembly instructions, and factory packets need semantic fields like `part_role`, assembly grouping, and view anchors, not only dimensions and edge flags.

See the deep-dive plan for the recommended architecture and phased rollout.

## Future Extensions

- **Desk template**: Fixed-height frame with drawer pedestal options
- **Pedestal template**: 3-drawer or file-drawer configurations
- **Bookshelf template**: Open shelving with optional doors
- **Quotes integration**: Design furniture directly from quote line items
- **Interactive 3D preview**: expand the Three.js inspection layer to pigeonhole and pedestal once the cupboard workflow is stable and manufacturing snapshots are persisted
