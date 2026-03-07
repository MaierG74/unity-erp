# Add Component Dialog — Facelift Design

**Date:** 2026-03-02
**Status:** Approved

## Problem

The Add/Edit Component dialog is one of the oldest UI components in Unity ERP. It has a dated layout, no image preview after drag-and-drop, excessive debug logging, and a `checkSupabasePermissions()` function that creates/deletes temp DB records on every open. It needs a visual and structural modernisation to match the rest of the app.

## Design

### Dialog Shell

- `max-w-3xl`, `max-h-[90vh]` with overflow scroll
- Clean header: bold title + muted subtitle
- Sticky footer with Cancel / Submit buttons (always visible)

### Image Section (top, full-width)

**Empty state:** Rounded drop zone with dashed border, upload icon, "Drag & drop, paste, or click to browse" text. Hover highlight on drag-over.

**With image (new file or existing URL):**

- Thumbnail preview (~160px tall, object-cover, rounded)
- Overlay action buttons on hover: Edit (crop modal), Remove (X icon)
- File name + size as subtle caption below

**Crop/Zoom modal (separate dialog):**

- Uses `react-easy-crop` (already installed, not yet wrapped)
- Zoom slider control
- Interactive crop overlay
- Apply / Cancel buttons
- Produces a cropped `File` that replaces the original

### Details Section

Two-column grid:

- **Code** — text input
- **Description** — textarea, full width
- **Unit** (select) | **Category** (select) — side by side

### Inventory Section

Three-column grid with section label:

- **Qty on Hand** | **Reorder Level** | **Location**
- Follows numeric input UX pattern: `value={x || ''}` with `placeholder="0"`, select-on-focus, onBlur reset

### Suppliers Section

- Section header with "Add Supplier" button (outline, small)
- Each supplier as a compact horizontal row (not nested bordered cards):
  - Supplier select | Component (creatable) | Price | Remove (X)
  - Single line with proper column widths
- Empty state: "No suppliers added" muted text

### Code Cleanup

- Remove ~50 `console.log` / `console.error` debug statements
- Remove `checkSupabasePermissions()` (creates temp records on every open)
- Remove `verifyDataInSupabase()` verification function
- Remove debug `useEffect` watchers for form values / selected item
- Keep error handling, toast notifications, and duplicate-code checks

### Dark/Light Mode

- All components use shadcn CSS variables
- Verify both themes visually

## Existing Assets to Reuse

| Asset | Location | Usage |
|-------|----------|-------|
| `ImagePreview` | `components/ui/image-preview.tsx` | Panzoom zoom/pan viewer reference |
| `react-easy-crop` | `package.json` | Crop modal (installed, no UI wrapper yet) |
| `react-dropzone` | Already imported | Drag-and-drop handling |
| `@panzoom/panzoom` | `package.json` | Zoom library |

## Out of Scope

- Annotation/arrow drawing (quotes-only feature)
- Multi-image support (components have a single image)
- Structural changes to the mutation/save logic (works fine, just needs logging cleanup)
