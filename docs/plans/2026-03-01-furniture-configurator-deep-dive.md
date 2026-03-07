# Furniture Configurator Deep Dive & Roadmap

> **Date**: 2026-03-01
> **Status**: Research complete, awaiting review
> **Scope**: Comprehensive analysis of the Furniture Configurator feature, its integration with the broader ERP system, and a phased development plan for expansion.

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [How Everything Connects Today](#2-how-everything-connects-today)
3. [Key Gaps Identified](#3-key-gaps-identified)
4. [Furniture Part Naming & Categorization](#4-furniture-part-naming--categorization)
5. [Edge Banding: Current State & Improvements](#5-edge-banding-current-state--improvements)
6. [Assembly Drawing Generation](#6-assembly-drawing-generation)
7. [Configurator-to-Job-Card Pipeline](#7-configurator-to-job-card-pipeline)
8. [New Templates: Pedestal, Bookcase, Table, Desk](#8-new-templates-pedestal-bookcase-table-desk)
9. [Phased Implementation Plan](#9-phased-implementation-plan)
10. [Database Changes Required](#10-database-changes-required)
11. [UX Wireframes & Flow Diagrams](#11-ux-wireframes--flow-diagrams)
12. [Open Questions](#12-open-questions)

---

## 1. Current State Summary

### What Exists

The Furniture Configurator is a **parametric design tool** at `/products/[productId]/configurator` that auto-generates cutlist parts from dimension inputs. It replaces the SketchUp workflow for standard melamine furniture.

| Component | Status | File |
|-----------|--------|------|
| Cupboard template | Complete (POC) | `lib/configurator/templates/cupboard.ts` |
| Template interface (`FurnitureTemplate<T>`) | Complete | `lib/configurator/templates/types.ts` |
| Template registry | Complete | `lib/configurator/templates/index.ts` |
| Configuration form | Complete | `components/features/configurator/CupboardForm.tsx` |
| SVG 2D preview (front + side) | Complete | `components/features/configurator/CupboardPreview.tsx` |
| Orchestrator (form + preview + parts table) | Complete | `components/features/configurator/FurnitureConfigurator.tsx` |
| Save to product cutlist groups | Complete | API: `POST /api/products/:id/cutlist-groups` |
| Save & open Cutlist Builder | Complete | Navigation + auto-load |
| Module entitlement gating | Complete | `furniture_configurator` module key |

### Current Cupboard Template Capabilities

**Parameters**: Width (100-3600mm), Height (100-3600mm), Depth (50-1200mm), Board thickness (16/18/25mm), Shelf count (0-10), Door style (none/single/double), Back panel toggle, Back thickness (3mm hardboard / 16mm melamine), plus advanced options (adjuster height, overhangs, slot depth, door gap, shelf setback).

**Generated Parts**: Top (laminated pair), Base (laminated pair), Left Side, Right Side, Shelves (x N), Back, Door Left/Right. Each part includes dimensions, grain direction, quantity, edge banding, and lamination type.

**Edge Banding Assignment**:
- Top/Base: All 4 edges (T,R,B,L) — fully visible
- Left Side: Right edge only (R) — front face
- Right Side: Left edge only (L) — front face
- Shelves: Top edge only (T) — front face
- Back: None — interior panel
- Doors: All 4 edges (T,R,B,L) — fully visible

### The Full Data Flow Today

```
Product Detail Page → "Design with Configurator" button
  ↓
Configurator Page (form + live SVG preview)
  ↓
generateCupboardParts(config) → CutlistPart[]
  ↓
"Save to Product" → POST /api/products/:id/cutlist-groups
  ↓  (parts stored as JSONB in product_cutlist_groups table)
"Save & Open Cutlist Builder" → /products/:id/cutlist-builder
  ↓
Cutlist Builder loads groups → flattens to CompactPart[]
  ↓
User assigns materials, optimizes packing
  ↓
Cutting Diagram PDF generated for shop floor
```

---

## 2. How Everything Connects Today

### The Manufacturing Pipeline

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│   PRODUCT    │────>│   ORDER      │────>│  ISSUE STOCK  │
│  (with BOM,  │     │ (line items  │     │  (components   │
│   cutlist,   │     │  + delivery  │     │   from BOM to  │
│   config)    │     │    date)     │     │   shop floor)  │
└─────────────┘     └──────────────┘     └───────────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌───────────────┐
                    │  JOB CARDS   │────>│ FACTORY FLOOR  │
                    │ (work orders │     │ (execute, pause │
                    │  from BOL,   │     │  complete,      │
                    │  piece rates)│     │  transfer)      │
                    └──────────────┘     └───────────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌───────────────┐
                    │   PAYROLL    │<────│  COMPLETION    │
                    │ (piecework   │     │ (qty confirmed, │
                    │  earnings)   │     │  time tracked)  │
                    └──────────────┘     └───────────────┘
```

### Where the Configurator Fits (Current)

The configurator currently **only feeds the cutlist**. It has no connection to:
- Job cards (no auto-generation of manufacturing work orders)
- Assembly drawings (no PDF/image generation for shop floor reference)
- Furniture naming/categorization (parts are generic: "Top", "Left Side", etc.)
- Order fulfillment tracking (no link from configured product to order execution)

### What the Configurator Should Feed (Future)

```
Configurator
  ├─> Cutlist Groups (existing) → Cutting Optimization → Cutting Diagrams
  ├─> Assembly Drawing (new) → Job Card PDF → Staff on Shop Floor
  ├─> Part Naming (new) → "Bookcase Shelf #3" instead of "Shelves"
  ├─> Edge Banding Config (enhanced) → Reset/override per part
  └─> Job Card Template (new) → Auto-create work orders for assembly
```

---

## 3. Key Gaps Identified

### Gap 1: No Furniture Type Naming

**Problem**: Parts are generated with generic names ("Top", "Shelves", "Left Side"). When a shop floor worker sees a cutting diagram with parts from multiple furniture pieces in one order, they can't tell which "Left Side" belongs to which piece.

**Solution**: Add a **furniture piece name** that prefixes all generated part names. Examples:
- "Reception Cupboard - Left Side"
- "Filing Pedestal - Drawer Front"
- "Corner Bookcase - Shelf"

### Gap 2: No Assembly Drawing Generation

**Problem**: The configurator generates a live SVG preview, but this drawing isn't saved anywhere. When a job card is printed for assembly, there's no visual reference for the worker.

**Solution**: Convert the SVG preview to a storable image (PNG data URL or stored file) and attach it to the job card PDF. The `JobCardPDFDocument.tsx` **already has a `drawingUrl` prop** and renders it — the infrastructure is 95% there.

### Gap 3: No Edge Banding Reset/Override from Configurator

**Problem**: The configurator assigns edge banding based on furniture design rules (visible edges get banded). But sometimes the user needs to override this — e.g., a shelf that will be visible from the side needs additional edge banding.

**Solution**: Add an edge banding editing step in the configurator's parts table (before saving to cutlist). The `EdgeBandingPopover` component already exists and works perfectly for this.

### Gap 4: No Configurator-to-Job-Card Pipeline

**Problem**: After configuring furniture and optimizing the cutlist, the user must manually create job cards. There's no automated path from "configured product" to "issued work order with assembly instructions."

**Solution**: Add a "Generate Job Card" action from the configurator or product page that:
1. Creates a job card with assembly/finishing jobs from the product's BOL
2. Attaches the assembly drawing
3. Includes the parts list as reference
4. Optionally includes the cutting diagram

### Gap 5: Only One Template (Cupboard)

**Problem**: The template system is extensible but only has one implementation.

**Solution**: Add templates for the most common furniture types: pedestal, bookcase, table, desk.

---

## 4. Furniture Part Naming & Categorization

### Proposed Architecture

#### A. Furniture Piece Name (User Input)

Add a **name field** to the configurator that the user fills in before (or after) configuring. This name prefixes all generated part names.

```typescript
// Enhanced config
interface ConfiguratorState {
  templateId: string;           // 'cupboard', 'pedestal', etc.
  pieceName: string;            // 'Reception Cupboard', 'Filing Pedestal'
  config: CupboardConfig;       // Template-specific config
}
```

**Generated part names become:**
- `${pieceName} - Top (laminated pair)` → "Reception Cupboard - Top (laminated pair)"
- `${pieceName} - Left Side` → "Reception Cupboard - Left Side"
- `${pieceName} - Shelves` → "Reception Cupboard - Shelves"

#### B. Furniture Type Categories

For quick selection and consistent naming, provide preset categories:

| Category | Templates | Typical Jobs |
|----------|-----------|-------------|
| **Cupboard** | Standard, Corner, Wall-mounted | Cut, Edge, Assemble, Install Doors |
| **Pedestal** | 3-Drawer, File Drawer, Mobile | Cut, Edge, Assemble, Install Drawers, Install Castors |
| **Bookcase** | Open, With Doors, Corner | Cut, Edge, Assemble, (Optional: Install Doors) |
| **Table** | Desk, Conference, Coffee | Cut, Edge, Assemble Legs, Attach Top |
| **Vanity** | Bathroom, Kitchen | Cut, Edge, Assemble, Plumbing Cutouts |

#### C. Implementation Approach

**Option A (Recommended): Code-based categories, user-named pieces**
- Categories are implicit in the template system (each template = a category)
- User provides a custom piece name per configuration
- No new database table needed for categories
- Template registry already provides `name` and `description`

**Option B: Database-backed furniture types**
- New `furniture_types` table with org-scoped custom types
- More flexible but adds complexity
- Could be a Phase 2 enhancement if users want custom categories

### Part Name Format Convention

```
[Piece Name] - [Part Type] [(qualifier)]

Examples:
  "CEO Desk - Top (laminated pair)"
  "Filing Pedestal - Drawer Front"
  "Reception Bookcase - Shelf"
  "Corner Cupboard - Door Left"
  "Coffee Table - Leg" (if table template has legs)
```

---

## 5. Edge Banding: Current State & Improvements

### Current System

**Storage**: `BandEdges { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean }` on each `CutlistPart`.

**Editing**: The `EdgeBandingPopover` component provides:
- Visual rectangle with clickable edges
- Toggle all / clear all
- Active count indicator
- Per-part edging material override
- Keyboard shortcuts (arrow keys for individual edges, 'A' for all)

**In Cutlist Builder**: Full editing via `CompactPartsTable` — click the edge indicator to open the popover. Batch operations available ("Apply material to all rows").

### Proposed Improvements

#### 5a. Edge Banding Editing in Configurator

**Current**: Parts table in configurator shows edge banding as read-only badges (T, R, B, L).

**Proposed**: Make the edge banding column in the configurator's parts table interactive using the existing `EdgeBandingPopover`. This allows users to adjust banding before saving to the cutlist.

**Implementation**:
1. Import `EdgeBandingPopover` into `FurnitureConfigurator.tsx`
2. Replace the static badge display with the interactive popover
3. Store overrides in local state (the `CutlistPart[]` array is already mutable)
4. Overrides persist when saving to cutlist groups

#### 5b. "Reset Edge Banding" Action

**Use case**: User has edited edge banding in the cutlist builder and wants to revert to the configurator's default assignment.

**Implementation**:
1. Add a "Reset to Default" button in the edge banding popover (when part originated from configurator)
2. Store the original `band_edges` from the template as `default_band_edges` on the part
3. Reset action: `part.band_edges = part.default_band_edges`

#### 5c. Quick Edge Banding Presets

Common patterns that could be one-click:
- **All edges** (doors, tops)
- **Front only** (shelves, partitions)
- **Front + top** (visible shelves)
- **None** (backs, hidden panels)

These could appear as buttons in the popover: "All", "Front Only", "Visible", "None".

#### 5d. Edge Banding Summary in Configurator

Show total edging meters at the bottom of the parts table:
```
Total edge banding: 12.4m (16mm) + 8.2m (32mm)
```

This gives immediate feedback when toggling edges.

---

## 6. Assembly Drawing Generation

### Infrastructure Already Available

| Capability | Component | Status |
|-----------|-----------|--------|
| SVG preview generation | `CupboardPreview.tsx` | Complete |
| SVG-in-PDF rendering | `CuttingDiagramPDF.tsx` uses `@react-pdf/renderer` SVG | Complete |
| Job card PDF with drawing section | `JobCardPDFDocument.tsx` has `drawingUrl` prop | Complete |
| QR code as data URL | `JobCardPDFDownload.tsx` uses `qrcode.toDataURL()` | Complete |
| Canvas-based image capture | `app/scan/jc/[id]/page.tsx` video frame capture | Pattern exists |
| File attachment storage | PO attachments, Quote attachments patterns | Complete |

### Proposed Drawing Types

#### Type 1: Assembly Drawing (Priority)

A technical 2D drawing showing the furniture piece with:
- Front and side elevation views (already in CupboardPreview)
- Dimension annotations (already rendered)
- Part labels identifying each panel
- Edge banding indicators (colored edge marks)
- Assembly sequence numbering (new)

**Generation approach**: Render the existing SVG to a canvas, export as PNG data URL, embed in job card PDF.

```typescript
// SVG-to-PNG conversion utility
async function svgToDataUrl(svgElement: SVGElement): Promise<string> {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgElement);
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * 2;  // 2x for retina
      canvas.height = img.naturalHeight * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = url;
  });
}
```

#### Type 2: Exploded Assembly View (Phase 2)

A more detailed drawing showing panels separated with arrows indicating assembly order. This would require a dedicated SVG generator but builds on the same dimension/annotation patterns.

#### Type 3: Cutting Layout Reference (Already Exists)

The cutting diagram PDF from the cutlist builder already serves as a shop floor reference for cutting. This doesn't need to be duplicated — just linked.

### Drawing Storage Options

**Option A (Recommended for MVP): Data URL in product_cutlist_groups**
- Store the PNG data URL alongside the parts JSONB
- Add a `drawing_data_url` TEXT column to `product_cutlist_groups`
- Pro: No additional storage infrastructure needed
- Con: Large base64 strings in database (but manageable for single images)

**Option B: Supabase Storage**
- Upload PNG to storage bucket: `configurator-drawings/{productId}/{timestamp}.png`
- Store the file URL in the cutlist groups record
- Pro: Proper file storage, CDN-served
- Con: Requires storage bucket setup and cleanup

**Option C: Generated on-demand**
- Re-render the SVG from stored config whenever needed
- Store the config JSON (already in parts JSONB), regenerate drawing at PDF time
- Pro: No image storage needed
- Con: Requires the config to be preserved alongside parts

**Recommendation**: Option C for MVP (regenerate from config), Option B for production (stored images for reliability and caching).

### Drawing-to-Job-Card Flow

```
Configurator → Generate SVG → Convert to PNG data URL
  ↓
Store config + data URL with cutlist groups
  ↓
Job Card Creation → Fetch drawing from product/cutlist data
  ↓
JobCardPDFDocument receives drawingUrl → Renders in "Product Drawing" section
  ↓
Printed job card includes assembly drawing with dimensions
```

---

## 7. Configurator-to-Job-Card Pipeline

### Current Job Card Creation Flow

1. Go to Order → Job Cards tab
2. Click "Add Job" or "Generate from BOL"
3. Select jobs from product's Bill of Labour
4. Assign staff, set quantities and piece rates
5. Print PDF with QR code

### Proposed Enhanced Flow

```
Configurator → Configure furniture piece
  ↓
"Save & Generate Job Card" (new button)
  ↓
Pre-populated Job Card Creation:
  - Product: auto-selected
  - Piece name: from configurator
  - Jobs: auto-populated from product BOL
    - Cutting (with cutting diagram reference)
    - Edge banding (with edge banding summary)
    - Assembly (with assembly drawing attached)
    - Finishing (if applicable)
  - Drawing: auto-attached from configurator SVG
  - Piece rates: auto-filled from piece_work_rates table
  ↓
User reviews, assigns staff, adjusts quantities
  ↓
Print Job Card PDF (includes assembly drawing + QR)
  ↓
Staff scans QR → Mobile page shows drawing + progress
```

### Job Card Enhancements for Configurator Integration

#### A. Drawing Attachment on Job Cards

**New table**: `job_card_attachments`
```sql
CREATE TABLE job_card_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_card_id INTEGER REFERENCES job_cards(job_card_id),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  attachment_type TEXT CHECK (attachment_type IN (
    'assembly_drawing', 'cutting_diagram', 'reference_image', 'specification'
  )),
  org_id UUID NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### B. Configuration Snapshot on Job Card

Store the configurator config as metadata on the job card for traceability:

```sql
ALTER TABLE job_cards ADD COLUMN configurator_config JSONB;
-- Stores: { templateId, pieceName, config: {...}, generatedAt }
```

This allows:
- Regenerating the drawing on demand
- Viewing the original configuration
- Change order tracking (compare old vs new config)

#### C. Mobile Scan Page Drawing Display

The mobile scan page (`/scan/jc/[id]`) should show the assembly drawing:
- Fetch from `job_card_attachments` where `attachment_type = 'assembly_drawing'`
- Display as expandable image (tap to zoom)
- Place above the items list for immediate reference

---

## 8. New Templates: Pedestal, Bookcase, Table, Desk

### Template Architecture (Existing Pattern)

Each template requires:
1. **Config interface + defaults** in `types.ts`
2. **Generator function** in `{templateName}.ts`
3. **Form component** `{TemplateName}Form.tsx`
4. **Preview component** `{TemplateName}Preview.tsx`
5. **Registration** in `index.ts`

### 8a. Pedestal Template

**Use case**: 3-drawer mobile pedestals, file drawer units under desks.

**Config**:
```typescript
interface PedestalConfig {
  width: number;           // 400-600mm (default 450)
  height: number;          // 500-750mm (default 680)
  depth: number;           // 400-600mm (default 500)
  materialThickness: 16 | 18 | 25;
  drawerCount: 2 | 3;     // 2 (file + box) or 3 (all box)
  hasFileDrawer: boolean;  // Bottom drawer double-height for files
  hasTop: boolean;         // Enclosed top or open top
  hasCastors: boolean;     // Mobile on wheels
  castorHeight: number;    // 50mm default
  drawerSlideType: 'ball-bearing' | 'roller';
  drawerGap: number;       // 3mm default between drawers
  handleStyle: 'cutout' | 'attached' | 'none';
  hasBack: boolean;
  backThickness: 3 | 16;
  hasLock: boolean;        // Lock mechanism cutout
}
```

**Generated Parts**:
- Left Side, Right Side
- Top (if enclosed)
- Base (with castor mounting points)
- Back panel
- Drawer fronts (x drawerCount)
- Drawer sides (x drawerCount x 2)
- Drawer backs (x drawerCount)
- Drawer bases (x drawerCount, typically 3mm hardboard)
- Drawer runners/rails (hardware, not cut parts — noted in BOM)

**Edge Banding**:
- Sides: Front edge only
- Drawer fronts: All 4 edges
- Drawer sides/backs: Top edge only
- Top: All 4 edges (if present)

### 8b. Bookcase Template

**Use case**: Open shelving units, with optional doors on lower section.

**Config**:
```typescript
interface BookcaseConfig {
  width: number;           // 600-1200mm (default 800)
  height: number;          // 800-2400mm (default 1800)
  depth: number;           // 250-400mm (default 300)
  materialThickness: 16 | 18 | 25;
  shelfCount: number;      // 2-8 (default 4)
  adjustableShelves: boolean;  // Shelf pin holes vs fixed
  hasBase: boolean;        // Plinth base or floor-standing
  baseHeight: number;      // 80mm default
  doorStyle: 'none' | 'lower-half' | 'full';
  doorCount: 1 | 2;       // Single or double doors
  doorHeight: number;      // Height of door section (if lower-half)
  hasBack: boolean;
  backThickness: 3 | 16;
  hasDivider: boolean;     // Vertical center divider
  topStyle: 'flush' | 'overhang';
}
```

**Generated Parts**:
- Left Side, Right Side
- Top (flush or overhang)
- Base/Plinth (if hasBase)
- Fixed shelves (always: top, bottom, plus optional divider shelf)
- Adjustable shelves (no edge banding, pin-supported)
- Back panel
- Doors (if applicable)
- Vertical divider (if hasDivider)

### 8c. Table Template

**Use case**: Desks, conference tables, coffee tables.

**Config**:
```typescript
interface TableConfig {
  width: number;           // 600-3000mm (default 1400)
  depth: number;           // 400-1200mm (default 700)
  materialThickness: 16 | 18 | 25;
  topStyle: 'single' | 'laminated';  // Single layer or 32mm laminated
  legStyle: 'panel' | 'frame' | 'none';  // Panel legs, frame legs, or wall-mounted
  legInset: number;        // How far legs sit from edges (0-100mm)
  hasModestyPanel: boolean;  // Front panel between legs
  modestyPanelHeight: number;
  hasCablePort: boolean;   // Cable management hole
  cablePortPosition: 'center' | 'left' | 'right';
  hasDrawerPedestal: boolean;  // Attach pedestal under desk
  pedestalSide: 'left' | 'right';
  edgeProfile: 'square' | 'rounded';  // Affects edge banding visibility
  heightFromFloor: number;  // 450mm (coffee) to 750mm (desk)
}
```

**Generated Parts**:
- Top (single or laminated pair)
- Legs (2x panel legs, or 4x frame components)
- Modesty panel (if applicable)
- Cross rails (structural)
- Cable port ring (hardware reference)

### 8d. Template Selection UX

When the user opens the configurator, instead of immediately showing the cupboard form, show a **template picker**:

```
┌─────────────────────────────────────────────────┐
│  Choose Furniture Type                           │
│                                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐        │
│  │  📦  │  │  🗄️  │  │  📚  │  │  🪑  │        │
│  │Cupb- │  │Pedes-│  │Book- │  │Table/│        │
│  │oard  │  │tal   │  │case  │  │ Desk │        │
│  └──────┘  └──────┘  └──────┘  └──────┘        │
│                                                  │
│  Piece Name: [________________________]          │
│                                                  │
└─────────────────────────────────────────────────┘
```

After selecting a type and entering a name, the form switches to the template-specific configuration.

---

## 9. Phased Implementation Plan

### Phase 1: Configurator Enhancements (Core UX) — ~3-5 days

**1.1 Furniture Piece Naming**
- Add "Piece Name" text input above the configuration form
- Prefix all generated part names with the piece name
- Store piece name in cutlist group name: `"{PieceName} Laminated (W×H×D)"`
- Default: template name + dimensions (current behavior) if no name entered

**1.2 Edge Banding Editing in Configurator**
- Replace static edge badges with interactive `EdgeBandingPopover` in parts table
- Add "Reset to Default" action per part
- Add edge banding presets: All, Front Only, None
- Show total edging meters summary below parts table

**1.3 Template Selector**
- Convert configurator page from single-template to multi-template
- Template picker grid at top of page
- Dynamic form/preview switching based on selected template
- Persist selected template in URL or state

### Phase 2: Assembly Drawing Generation — ~2-3 days

**2.1 SVG-to-PNG Conversion**
- Create `lib/configurator/drawingExport.ts` utility
- Convert CupboardPreview SVG to PNG data URL
- Support configurable resolution (1x for screen, 2x for print)

**2.2 Drawing Storage**
- Add `configurator_snapshot` JSONB column to `product_cutlist_groups`
- Store: `{ templateId, pieceName, config, drawingDataUrl, generatedAt }`
- Generate and store drawing on save

**2.3 Drawing Display**
- Show stored drawing on product detail page (Cutlist tab)
- Allow regeneration from stored config
- "Download Drawing" button (PNG export)

### Phase 3: Job Card Integration — ~3-4 days

**3.1 Job Card Attachments Table**
- Migration: Create `job_card_attachments` table with RLS
- API: CRUD endpoints for attachments
- Storage: Use Supabase Storage bucket for files

**3.2 Auto-Attach Drawing to Job Card**
- When creating a job card for a configured product, auto-fetch the drawing
- Store as job card attachment (type: 'assembly_drawing')
- Pass `drawingUrl` to `JobCardPDFDocument` for PDF embedding

**3.3 Mobile Scan Drawing Display**
- Fetch `job_card_attachments` on mobile scan page
- Show assembly drawing as expandable image
- Place in dedicated section between info cards and items list

**3.4 "Generate Job Card from Configurator" Button**
- New button on configurator: "Generate Job Card"
- Pre-populates job card creation with:
  - Product from current page
  - Jobs from product BOL
  - Drawing attachment
  - Config snapshot for traceability
- Redirects to job card creation/edit page

### Phase 4: New Templates — ~2-3 days each

**4.1 Pedestal Template**
- Config interface, generator function
- Form with drawer options, castor toggle, lock cutout
- SVG preview: front + side with drawer divisions
- Edge banding rules for drawer components

**4.2 Bookcase Template**
- Config interface, generator function
- Form with shelf count, door options, divider
- SVG preview: front + side with shelves and optional doors
- Edge banding rules for open vs enclosed shelving

**4.3 Table/Desk Template**
- Config interface, generator function
- Form with leg style, modesty panel, cable ports
- SVG preview: front + side with legs and rails
- Edge banding rules for table top and legs

### Phase 5: Advanced Features (Future) — scope TBD

**5.1 Configuration History**
- Track all saved configurations per product
- Version comparison (diff configs)
- Change order workflow (new config → new job card)

**5.2 Multi-Piece Configurator**
- Configure multiple furniture pieces in one session
- E.g., "Reception Desk" = desk + pedestal + bookcase
- Shared material selection across pieces
- Combined cutlist optimization

**5.3 3D Preview**
- Three.js-based 3D visualization
- Orbit camera, material textures
- Exploded assembly view

**5.4 Quoting Integration**
- Design furniture directly from quote line items
- Auto-cost based on materials + labor
- Configuration attached to quote for customer approval

---

## 10. Database Changes Required

### Phase 1 (No schema changes)
- All changes are UI-only
- Piece name stored in existing `product_cutlist_groups.name` field
- Edge banding edits stored in existing `parts` JSONB

### Phase 2

```sql
-- Add configurator snapshot to cutlist groups
ALTER TABLE product_cutlist_groups
  ADD COLUMN configurator_snapshot JSONB;
-- Stores: { templateId, pieceName, config, drawingDataUrl, generatedAt }
```

### Phase 3

```sql
-- Job card attachments
CREATE TABLE job_card_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_card_id INTEGER NOT NULL REFERENCES job_cards(job_card_id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN (
    'assembly_drawing', 'cutting_diagram', 'reference_image', 'specification'
  )),
  org_id UUID NOT NULL REFERENCES organizations(id),
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_job_card_attachments_job_card_id
  ON job_card_attachments(job_card_id);

-- RLS
ALTER TABLE job_card_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view attachments in their org"
  ON job_card_attachments FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert attachments in their org"
  ON job_card_attachments FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete attachments in their org"
  ON job_card_attachments FOR DELETE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Add configurator config to job cards for traceability
ALTER TABLE job_cards ADD COLUMN configurator_config JSONB;
```

---

## 11. UX Wireframes & Flow Diagrams

### Enhanced Configurator Page Layout

```
┌────────────────────────────────────────────────────────────────┐
│  ← Back to Product                                             │
│  Furniture Configurator                                        │
│                                                                │
│  ┌─ Template ──────────────────────────────────────────────┐   │
│  │  [Cupboard ✓]  [Pedestal]  [Bookcase]  [Table/Desk]    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  Piece Name: [Filing Cupboard for Reception________]           │
│                                                                │
│  ┌─ Configuration ─────────────┐  ┌─ Preview ────────────┐    │
│  │                             │  │                       │    │
│  │  Overall Dimensions         │  │   ┌──────┐ ┌────┐    │    │
│  │  Width: [900]  Height:...   │  │   │      │ │    │    │    │
│  │                             │  │   │      │ │    │    │    │
│  │  Construction               │  │   │      │ │    │    │    │
│  │  Board Thickness: [16mm ▾]  │  │   │      │ │    │    │    │
│  │  Shelves: [3]               │  │   └──────┘ └────┘    │    │
│  │                             │  │   900mm      500mm    │    │
│  │  Doors: [Double ▾]         │  │                       │    │
│  │  Back Panel: [On]          │  │                       │    │
│  │                             │  │                       │    │
│  │  ▸ Advanced Options         │  │                       │    │
│  └─────────────────────────────┘  └───────────────────────┘    │
│                                                                │
│  ┌─ Generated Parts (12 panels) ──────────────────────────┐    │
│  │ Part                  Length  Width  Qty  Grain  Edge   │    │
│  │ Filing Cupboard - Top   900    500    2   Len   [TRBL] │    │
│  │ Filing Cupboard - Base  900    500    2   Len   [TRBL] │    │
│  │ Filing Cupboard - L.S  1726    490    1   Len   [_R__] │    │
│  │ Filing Cupboard - R.S  1726    490    1   Len   [__B_] │    │
│  │ ...                                                     │    │
│  │                                                         │    │
│  │ Edge Banding Total: 14.2m (16mm) + 9.6m (32mm)        │    │
│  │                                                         │    │
│  │ [Save to Product]  [Save & Open Cutlist]  [Gen Job Card]│   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### Job Card with Assembly Drawing

```
┌─────────────────────────────────────────────┐
│  JOB CARD #127                    [QR Code] │
│  Filing Cupboard for Reception              │
│  Issue Date: 2026-03-01                     │
│                                             │
│  Staff: John Smith    Order: #ORD-456       │
│  Due: 2026-03-05      Priority: Medium      │
│                                             │
│  ┌─ Assembly Drawing ─────────────────────┐ │
│  │                                        │ │
│  │   ┌──────┐ ┌────┐                     │ │
│  │   │      │ │    │   900 × 1800 × 500  │ │
│  │   │      │ │    │   16mm Melamine      │ │
│  │   │      │ │    │   3 Shelves          │ │
│  │   │      │ │    │   Double Doors       │ │
│  │   └──────┘ └────┘                     │ │
│  │   Front        Side                    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌─ Work Items ───────────────────────────┐ │
│  │ Product           Job      Qty  Rate   │ │
│  │ Filing Cupboard   Cut       1   R45    │ │
│  │ Filing Cupboard   Edge      1   R25    │ │
│  │ Filing Cupboard   Assemble  1   R80    │ │
│  │                            Total: R150 │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌─ Work Log ─────────────────────────────┐ │
│  │ Start: ________  End: ________         │ │
│  │ Qty Completed: ___  Rejected: ___      │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## 12. Open Questions

### For Discussion in Morning Session

1. **Piece naming enforcement**: Should the piece name be required, or optional with a fallback to template + dimensions?

2. **Template selection persistence**: When configuring a product, should the selected template be saved permanently (one template per product) or allow switching?

3. **Multi-piece orders**: If an order has 5x of the same configured cupboard, should the configurator handle quantity, or should that be managed at the order level (as it is today)?

4. **Drawing format preference**: PNG data URL (simple) vs Supabase Storage file (proper) vs regenerate-on-demand from config (no storage needed)?

5. **Edge banding presets**: Should there be org-level default edge banding rules per template, or always start from the template defaults?

6. **Job card auto-generation**: Should "Generate Job Card" create an unassigned card (needs staff later) or prompt for staff selection inline?

7. **Template priority**: Which template should we build next after confirming the cupboard enhancements work? (Pedestal seems most requested based on the user's list.)

8. **Drawer components**: For the pedestal template, should drawer internals (sides, backs, bases) be separate parts in the cutlist, or grouped as a single "drawer box" unit?

9. **Hardware items**: Should the configurator track non-panel items (handles, hinges, drawer slides, castors) as BOM references, or only focus on cut panels?

10. **Cutlist group naming**: When a product has multiple configured pieces (e.g., a desk AND a pedestal), how should the cutlist groups be organized? Per piece? Combined?

---

## Summary

The Furniture Configurator is a strong POC that needs **three key enhancements** to become a production powerhouse:

1. **Naming** — Give furniture pieces identity so parts are traceable on the shop floor
2. **Drawings** — Generate and attach assembly drawings to job cards for staff reference
3. **Pipeline** — Connect the configurator output directly to job card creation

The infrastructure for all three is largely in place. The template system is extensible, the edge banding editor exists, the job card PDF already has a drawing section, and the factory floor already tracks job completion. The work is primarily **wiring things together** and **adding new templates**.

Estimated total effort: ~15-20 days across all 4 phases, with Phase 1 deliverable in a week.
