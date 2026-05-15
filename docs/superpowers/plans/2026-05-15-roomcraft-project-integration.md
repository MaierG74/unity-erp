# RoomCraft Project Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the RoomCraft → Configurator → RoomCraft loop: projects as first-class entities with customer attachment, blocks that map one-to-one to configured furniture pieces, and a project-scoped configure route that feeds back into the canvas renderers.

**Architecture:** A `lib/roomcraft/project-store.ts` repository layer (localStorage today, Supabase later) holds project envelopes and pieces separately from the canvas FloorPlan state (which continues to live in its own localStorage key via `RoomContext`). The canvas route moves to `/roomcraft/[projectId]`; the index at `/roomcraft` lists projects. The configure route at `/roomcraft/[projectId]/configure` wraps its own `RoomProvider` (same storageKey) to read/write block metadata, and embeds a lightly refactored `FurnitureConfigurator` that calls an `onSaveSuccess` callback instead of POSTing to the product API.

**Tech Stack:** Next.js 14 App Router, TypeScript, React, localStorage (repository pattern), TanStack Query (customers), existing `RoomContext`/`blockReducer`, existing `FurnitureConfigurator`, shadcn/ui, Tailwind CSS v4, vitest (via `npx tsx --test`)

---

## Design decisions in force

See `C:\Users\benma\Downloads\ROOMCRAFT_INTEGRATION_CONTEXT.md` for full rationale. Key decisions:
- Customer always required; house-account customer = real Supabase row (must exist before this ships)
- All reads/writes go through `project-store.ts`; components never touch localStorage keys directly
- `crypto.randomUUID()` for all IDs from day one
- Block dimensions pre-fill Configurator; piece wins on mismatch; block resizes on save
- One-to-one block-to-piece; no run concept in v1
- `productId` query-string flow on RoomCraft is retired after draft migration

---

## File map

### New files
| Path | Purpose |
|------|---------|
| `lib/roomcraft/types.ts` | Project, piece, status types |
| `lib/roomcraft/project-store.ts` | localStorage repository |
| `tests/roomcraft-project-store.test.ts` | Unit tests for store |
| `app/roomcraft/[projectId]/page.tsx` | Canvas route (moved from `app/roomcraft/page.tsx`) |
| `app/roomcraft/[projectId]/configure/page.tsx` | Configure route entry |
| `components/features/roomcraft/ProjectIndex.tsx` | Project list page |
| `components/features/roomcraft/CreateProjectModal.tsx` | New-project dialog |
| `components/features/roomcraft/DraftMigrationPrompt.tsx` | One-time legacy-draft migration |
| `components/features/roomcraft/configure/ConfigureShell.tsx` | Configure route shell with RoomProvider |
| `components/features/roomcraft/configure/BlockList.tsx` | Sidebar block list with status badges |
| `components/features/roomcraft/configure/TemplatePicker.tsx` | Template selection for unconfigured blocks |
| `hooks/use-customers-list.ts` | TanStack Query hook for customer dropdown |

### Modified files
| Path | Change |
|------|--------|
| `app/roomcraft/page.tsx` | Replace canvas with `<ProjectIndex />` |
| `components/features/roomcraft/types/room.ts` | Add `furnitureType?` and `configuredPieceId?` to `RoomItem` |
| `components/features/roomcraft/context/RoomContext.tsx` | Add two new `RoomAction` union members |
| `components/features/roomcraft/context/blockReducer.ts` | Add two new reducer cases |
| `components/features/configurator/FurnitureConfigurator.tsx` | Add `onSaveSuccess`, `initialTemplateId`, `initialConfig` props; make `productId` optional |
| `components/features/roomcraft/components/canvas/RoomCanvas.tsx` | Top-down configured-piece rendering |
| `components/features/roomcraft/hooks/useIsometricRenderer.ts` | Isometric configured-piece rendering |

---

## Task 1: Project and piece types

**Files:**
- Create: `lib/roomcraft/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// lib/roomcraft/types.ts
import type { CupboardConfig, PigeonholeConfig, PedestalConfig } from '@/lib/configurator/templates/types';
import type { CutlistPart } from '@/lib/cutlist/types';

export type FurnitureType = 'cupboard' | 'pigeonhole' | 'pedestal';

export type ConfiguratorConfig = CupboardConfig | PigeonholeConfig | PedestalConfig;

export type ProjectStatus = 'draft' | 'configuring' | 'ready' | 'converted';

export interface ProjectPiece {
  id: string;
  blockId: string;
  roomId: string;
  furnitureType: FurnitureType;
  config: ConfiguratorConfig;
  parts: CutlistPart[];
  savedAt: string; // ISO 8601
}

export interface RoomCraftProject {
  id: string;
  customerId: number;
  customerName: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  pieces: ProjectPiece[];
}

export function deriveProjectStatus(
  project: RoomCraftProject,
  allBlockIds: string[],
): ProjectStatus {
  if (project.pieces.length === 0) return 'draft';
  const configuredIds = new Set(project.pieces.map((p) => p.blockId));
  const allConfigured =
    allBlockIds.length > 0 && allBlockIds.every((id) => configuredIds.has(id));
  return allConfigured ? 'ready' : 'configuring';
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly for this file**

```
cd unity-erp
npx tsc --noEmit 2>&1 | grep "lib/roomcraft/types"
```

Expected: no output (no errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add lib/roomcraft/types.ts
git commit -m "feat(roomcraft): add project and piece types with status derivation"
```

---

## Task 2: Project store

**Files:**
- Create: `lib/roomcraft/project-store.ts`
- Create: `tests/roomcraft-project-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/roomcraft-project-store.test.ts
import { describe, it, beforeEach, assert } from 'node:test';
import type { RoomCraftProject, ProjectPiece } from '../lib/roomcraft/types';

// Stub localStorage for Node environment
const store: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  key: (i: number) => Object.keys(store)[i] ?? null,
  length: 0,
} as unknown as Storage;

import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  addPieceToProject,
  canvasStorageKey,
} from '../lib/roomcraft/project-store';

function makeProject(overrides: Partial<RoomCraftProject> = {}): RoomCraftProject {
  return {
    id: crypto.randomUUID(),
    customerId: 1,
    customerName: 'Acme',
    reference: 'Test project',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pieces: [],
    ...overrides,
  };
}

describe('project-store', () => {
  beforeEach(() => localStorage.clear());

  it('listProjects returns empty array when nothing saved', () => {
    assert.deepStrictEqual(listProjects(), []);
  });

  it('saveProject persists and getProject retrieves it', () => {
    const p = makeProject();
    saveProject(p);
    const fetched = getProject(p.id);
    assert.strictEqual(fetched?.id, p.id);
    assert.strictEqual(fetched?.reference, 'Test project');
  });

  it('listProjects returns all saved projects', () => {
    const a = makeProject({ reference: 'A' });
    const b = makeProject({ reference: 'B' });
    saveProject(a);
    saveProject(b);
    const list = listProjects();
    assert.strictEqual(list.length, 2);
  });

  it('saveProject updates an existing project', () => {
    const p = makeProject();
    saveProject(p);
    saveProject({ ...p, reference: 'Updated' });
    assert.strictEqual(getProject(p.id)?.reference, 'Updated');
    assert.strictEqual(listProjects().length, 1);
  });

  it('deleteProject removes it', () => {
    const p = makeProject();
    saveProject(p);
    deleteProject(p.id);
    assert.strictEqual(getProject(p.id), null);
    assert.strictEqual(listProjects().length, 0);
  });

  it('addPieceToProject appends piece and returns updated project', () => {
    const p = makeProject();
    saveProject(p);
    const piece: ProjectPiece = {
      id: crypto.randomUUID(),
      blockId: 'block-1',
      roomId: 'room-1',
      furnitureType: 'cupboard',
      config: { width: 900, height: 1800, depth: 500 } as any,
      parts: [],
      savedAt: new Date().toISOString(),
    };
    const updated = addPieceToProject(p.id, piece);
    assert.strictEqual(updated.pieces.length, 1);
    assert.strictEqual(getProject(p.id)?.pieces.length, 1);
  });

  it('addPieceToProject replaces existing piece for same blockId', () => {
    const p = makeProject();
    saveProject(p);
    const piece: ProjectPiece = {
      id: crypto.randomUUID(),
      blockId: 'block-1',
      roomId: 'room-1',
      furnitureType: 'cupboard',
      config: { width: 900, height: 1800, depth: 500 } as any,
      parts: [],
      savedAt: new Date().toISOString(),
    };
    addPieceToProject(p.id, piece);
    const updated = addPieceToProject(p.id, { ...piece, id: crypto.randomUUID(), furnitureType: 'pedestal' });
    const saved = getProject(p.id)!;
    assert.strictEqual(saved.pieces.length, 1);
    assert.strictEqual(saved.pieces[0].furnitureType, 'pedestal');
  });

  it('canvasStorageKey returns correct key', () => {
    assert.strictEqual(canvasStorageKey('abc-123'), 'unity-roomcraft:project:abc-123');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx tsx --test tests/roomcraft-project-store.test.ts
```

Expected: errors — module not found.

- [ ] **Step 3: Implement the store**

```typescript
// lib/roomcraft/project-store.ts
import type { RoomCraftProject, ProjectPiece } from './types';

const STORAGE_KEY = 'unity-roomcraft:projects';

export function canvasStorageKey(projectId: string): string {
  return `unity-roomcraft:project:${projectId}`;
}

export function listProjects(): RoomCraftProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RoomCraftProject[];
  } catch {
    return [];
  }
}

export function getProject(id: string): RoomCraftProject | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function saveProject(project: RoomCraftProject): void {
  const projects = listProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  const updated = { ...project, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    projects[idx] = updated;
  } else {
    projects.push(updated);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function deleteProject(id: string): void {
  const projects = listProjects().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  localStorage.removeItem(canvasStorageKey(id));
}

export function addPieceToProject(projectId: string, piece: ProjectPiece): RoomCraftProject {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const pieces = [
    ...project.pieces.filter((p) => p.blockId !== piece.blockId),
    piece,
  ];
  const updated = { ...project, pieces };
  saveProject(updated);
  return updated;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx tsx --test tests/roomcraft-project-store.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/roomcraft/project-store.ts tests/roomcraft-project-store.test.ts
git commit -m "feat(roomcraft): add project-store localStorage repository with tests"
```

---

## Task 3: RoomItem schema additions and new block actions

**Files:**
- Modify: `components/features/roomcraft/types/room.ts`
- Modify: `components/features/roomcraft/context/RoomContext.tsx`
- Modify: `components/features/roomcraft/context/blockReducer.ts`

- [ ] **Step 1: Add fields to RoomItem**

In `components/features/roomcraft/types/room.ts`, add two optional fields to `RoomItem` after the existing `color?` field:

```typescript
// Add after: color?: string;  (line 67)
  furnitureType?: import('@/lib/roomcraft/types').FurnitureType;
  configuredPieceId?: string;
```

Full updated interface:
```typescript
export interface RoomItem {
  id: string;
  label: string;
  layerId: string;
  groupId?: string;
  x: number;
  y: number;
  length: number;
  depth: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  anchor: BlockAnchor;
  color?: string;
  furnitureType?: import('@/lib/roomcraft/types').FurnitureType;
  configuredPieceId?: string;
}
```

- [ ] **Step 2: Add new action types to RoomContext.tsx**

In `components/features/roomcraft/context/RoomContext.tsx`, add two new members to the `RoomAction` union (after the last existing action, before the closing `};`):

```typescript
  | { type: 'SET_BLOCK_FURNITURE_TYPE'; payload: { roomId: string; id: string; furnitureType: import('@/lib/roomcraft/types').FurnitureType } }
  | { type: 'SET_BLOCK_CONFIGURED_PIECE'; payload: { roomId: string; id: string; configuredPieceId: string } };
```

- [ ] **Step 3: Add reducer cases to blockReducer.ts**

In `components/features/roomcraft/context/blockReducer.ts`, add two new cases inside the `switch` statement (before the default/closing brace):

```typescript
    case 'SET_BLOCK_FURNITURE_TYPE': {
      if (!state.floorPlan) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) =>
            i.id === action.payload.id
              ? { ...i, furnitureType: action.payload.furnitureType }
              : i,
          ),
        }),
      );
    }
    case 'SET_BLOCK_CONFIGURED_PIECE': {
      if (!state.floorPlan) return state;
      return updateRoom(state, action.payload.roomId, (room) =>
        touchMetadata({
          ...room,
          items: room.items.map((i) =>
            i.id === action.payload.id
              ? { ...i, configuredPieceId: action.payload.configuredPieceId }
              : i,
          ),
        }),
      );
    }
```

- [ ] **Step 4: Type-check the touched files**

```
npx tsc --noEmit 2>&1 | grep -E "types/room|RoomContext|blockReducer"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add components/features/roomcraft/types/room.ts \
        components/features/roomcraft/context/RoomContext.tsx \
        components/features/roomcraft/context/blockReducer.ts
git commit -m "feat(roomcraft): add furnitureType and configuredPieceId to RoomItem with new actions"
```

---

## Task 4: FurnitureConfigurator refactor — make it embeddable

**Files:**
- Modify: `components/features/configurator/FurnitureConfigurator.tsx`

The goal: add `onSaveSuccess`, `initialTemplateId`, and `initialConfig` props. When `onSaveSuccess` is provided the component calls it (with the active config and final parts) instead of POSTing to the product API. `productId` becomes optional.

- [ ] **Step 1: Update the props interface**

Replace the existing `FurnitureConfiguratorProps` interface (lines 38–40) with:

```typescript
type TemplateId = 'cupboard' | 'pigeonhole' | 'pedestal';

interface FurnitureConfiguratorProps {
  productId?: number;
  initialTemplateId?: TemplateId;
  initialConfig?: CupboardConfig | PigeonholeConfig | PedestalConfig;
  onSaveSuccess?: (config: CupboardConfig | PigeonholeConfig | PedestalConfig, parts: CutlistPart[]) => void;
}
```

Note: the `type TemplateId` declaration that already exists at line 68 should be removed — move it above the interface so both share it.

- [ ] **Step 2: Apply initialTemplateId and initialConfig on mount**

Inside `FurnitureConfigurator`, the `templateId` state initialises to `'cupboard'`. Change the `useState` call and add a one-time effect for `initialConfig`:

```typescript
// Replace:
const [templateId, setTemplateId] = React.useState<TemplateId>('cupboard');
const [cupboardConfig, setCupboardConfig] = React.useState<CupboardConfig>(DEFAULT_CUPBOARD_CONFIG);
const [pigeonholeConfig, setPigeonholeConfig] = React.useState<PigeonholeConfig>(DEFAULT_PIGEONHOLE_CONFIG);
const [pedestalConfig, setPedestalConfig] = React.useState<PedestalConfig>(DEFAULT_PEDESTAL_CONFIG);

// With:
const [templateId, setTemplateId] = React.useState<TemplateId>(initialTemplateId ?? 'cupboard');
const [cupboardConfig, setCupboardConfig] = React.useState<CupboardConfig>(DEFAULT_CUPBOARD_CONFIG);
const [pigeonholeConfig, setPigeonholeConfig] = React.useState<PigeonholeConfig>(DEFAULT_PIGEONHOLE_CONFIG);
const [pedestalConfig, setPedestalConfig] = React.useState<PedestalConfig>(DEFAULT_PEDESTAL_CONFIG);
const [initialConfigApplied, setInitialConfigApplied] = React.useState(false);

// Add this effect after the existing org-defaults effect:
React.useEffect(() => {
  if (initialConfig && !initialConfigApplied) {
    if (initialTemplateId === 'cupboard') setCupboardConfig(initialConfig as CupboardConfig);
    else if (initialTemplateId === 'pigeonhole') setPigeonholeConfig(initialConfig as PigeonholeConfig);
    else if (initialTemplateId === 'pedestal') setPedestalConfig(initialConfig as PedestalConfig);
    setInitialConfigApplied(true);
  }
}, [initialConfig, initialTemplateId, initialConfigApplied]);
```

- [ ] **Step 3: Update saveParts to support the callback path**

Replace the existing `saveParts` callback (lines 136–198) with:

```typescript
const saveParts = React.useCallback(
  async (navigateToBuilder: boolean) => {
    setSaving(true);
    try {
      const { width, height, depth, materialThickness: thickness } = activeConfig as {
        width: number; height: number; depth: number; materialThickness: number;
      };
      const configLabel = `${width} × ${height} × ${depth}`;
      const laminatedParts = finalParts.filter((p) => p.lamination_type === 'same-board');
      const standardParts = finalParts.filter((p) => p.lamination_type !== 'same-board');

      // Callback path — used by RoomCraft configure route
      if (onSaveSuccess) {
        onSaveSuccess(activeConfig, finalParts);
        toast.success('Piece saved');
        return;
      }

      // Product path — original behaviour
      if (!productId) throw new Error('productId required when onSaveSuccess is not provided');

      const groups: { name: string; board_type: string; parts: CutlistPart[]; sort_order: number }[] = [];
      if (laminatedParts.length > 0) {
        groups.push({
          name: `${templateName} Laminated (${configLabel})`,
          board_type: `${thickness * 2}mm-both`,
          parts: laminatedParts,
          sort_order: 0,
        });
      }
      if (standardParts.length > 0) {
        groups.push({
          name: `${templateName} Panels (${configLabel})`,
          board_type: `${thickness}mm`,
          parts: standardParts,
          sort_order: groups.length,
        });
      }

      const res = await authorizedFetch(
        `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.FURNITURE_CONFIGURATOR}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groups }) },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      toast.success('Parts saved to product');

      if (previewRef.current) {
        try {
          await captureAndUploadProductDrawing(previewRef.current, productId);
        } catch (captureError) {
          console.error('Product drawing capture failed:', captureError);
          toast.warning('Parts saved, but reference drawing capture failed');
        }
      }
      if (navigateToBuilder) {
        router.push(`/products/${productId}/cutlist-builder`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save parts');
    } finally {
      setSaving(false);
    }
  },
  [activeConfig, finalParts, onSaveSuccess, productId, router, templateName],
);
```

- [ ] **Step 4: Update the Save button label**

In the JSX, find the "Save & go to Cutlist Builder" button. Conditionally render it only when `!onSaveSuccess`, and show a "Save piece" button when `onSaveSuccess` is provided:

Find the button that calls `saveParts(true)` and add a guard. The full button area should become:

```tsx
{onSaveSuccess ? (
  <Button onClick={() => saveParts(false)} disabled={saving} size="sm">
    {saving ? 'Saving…' : 'Save piece'}
  </Button>
) : (
  <>
    <Button onClick={() => saveParts(false)} disabled={saving} size="sm" variant="outline">
      {saving ? 'Saving…' : 'Save'}
    </Button>
    <Button onClick={() => saveParts(true)} disabled={saving} size="sm">
      {saving ? 'Saving…' : 'Save & go to Cutlist Builder'}
      <ArrowRight className="ml-1 h-3 w-3" />
    </Button>
  </>
)}
```

- [ ] **Step 5: Verify existing product route still works**

The existing route at `app/products/[productId]/configurator/page.tsx` passes `productId` as a number. Confirm it still receives the required prop and the type still compiles:

```
npx tsc --noEmit 2>&1 | grep -E "FurnitureConfigurator|configurator/page"
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add components/features/configurator/FurnitureConfigurator.tsx
git commit -m "feat(configurator): add onSaveSuccess/initialConfig/initialTemplateId props for embeddable use"
```

---

## Task 5: Canvas route at `/roomcraft/[projectId]`

**Files:**
- Create: `app/roomcraft/[projectId]/page.tsx`

The canvas route moves from `app/roomcraft/page.tsx` (which becomes the index in Task 6). The only change is how the `storageKey` is derived — from the `[projectId]` URL param instead of the `?productId` query string.

- [ ] **Step 1: Create the new canvas route**

```typescript
// app/roomcraft/[projectId]/page.tsx
'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';

const RoomCraftApp = dynamic(
  () => import('@/components/features/roomcraft/RoomCraftApp'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading RoomCraft...
      </div>
    ),
  }
);

export default function RoomCraftProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const storageKey = `unity-roomcraft:project:${projectId}`;

  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <RoomCraftApp storageKey={storageKey} projectId={projectId} />
    </div>
  );
}
```

- [ ] **Step 2: Update RoomCraftApp to accept storageKey and projectId props**

In `components/features/roomcraft/RoomCraftApp.tsx`, replace the `useSearchParams`-based logic with props:

```typescript
// components/features/roomcraft/RoomCraftApp.tsx
'use client';

import { RoomProvider } from './context/RoomContext';
import { AppShell } from './components/layout/AppShell';
import { Sidebar } from './components/ui/Sidebar';
import { RoomCanvas } from './components/canvas/RoomCanvas';
import { ToastProvider } from './components/ui/Toast';
import { PlacementProvider } from './context/PlacementContext';

interface RoomCraftAppProps {
  storageKey: string;
  projectId?: string;
}

function RoomCraftApp({ storageKey, projectId }: RoomCraftAppProps) {
  return (
    <ToastProvider>
      <RoomProvider storageKey={storageKey}>
        <PlacementProvider>
          <AppShell sidebar={<Sidebar />}>
            <RoomCanvas projectId={projectId} />
          </AppShell>
        </PlacementProvider>
      </RoomProvider>
    </ToastProvider>
  );
}

export default RoomCraftApp;
```

Note: `RoomCanvas` receives `projectId` as a prop for future renderer lookups (Tasks 11–12). If `RoomCanvas` doesn't accept this prop yet, add `projectId?: string` to its props interface and ignore it for now.

- [ ] **Step 3: Verify the canvas route renders at /roomcraft/test-id**

```
npm run dev
```

Navigate to `http://localhost:3000/roomcraft/test-id` — should render the RoomCraft canvas (empty room, no errors in console).

- [ ] **Step 4: Commit**

```bash
git add app/roomcraft/[projectId]/page.tsx components/features/roomcraft/RoomCraftApp.tsx
git commit -m "feat(roomcraft): add project-scoped canvas route at /roomcraft/[projectId]"
```

---

## Task 6: Customer list hook

**Files:**
- Create: `hooks/use-customers-list.ts`

Needed by the create-project modal and the project index display.

- [ ] **Step 1: Create the hook**

```typescript
// hooks/use-customers-list.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@/types/orders';

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function useCustomersList() {
  return useQuery<Customer[]>({
    queryKey: ['customers-list'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit 2>&1 | grep "use-customers-list"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-customers-list.ts
git commit -m "feat(roomcraft): add useCustomersList hook for customer dropdown"
```

---

## Task 7: Project index page and create-project modal

**Files:**
- Create: `components/features/roomcraft/CreateProjectModal.tsx`
- Create: `components/features/roomcraft/ProjectIndex.tsx`
- Modify: `app/roomcraft/page.tsx`

- [ ] **Step 1: Create the modal**

```typescript
// components/features/roomcraft/CreateProjectModal.tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useCustomersList } from '@/hooks/use-customers-list';
import { saveProject } from '@/lib/roomcraft/project-store';
import type { RoomCraftProject } from '@/lib/roomcraft/types';

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectModal({ open, onOpenChange }: CreateProjectModalProps) {
  const router = useRouter();
  const { data: customers = [], isLoading } = useCustomersList();
  const [reference, setReference] = React.useState('');
  const [customerId, setCustomerId] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);

  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim() || !customerId) return;
    setSubmitting(true);

    const now = new Date().toISOString();
    const project: RoomCraftProject = {
      id: crypto.randomUUID(),
      customerId: Number(customerId),
      customerName: selectedCustomer?.name ?? '',
      reference: reference.trim(),
      createdAt: now,
      updatedAt: now,
      pieces: [],
    };

    saveProject(project);
    onOpenChange(false);
    router.push(`/roomcraft/${project.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reference">Reference</Label>
            <Input
              id="reference"
              placeholder="e.g. Smith kitchen renovation"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer">Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId} required>
              <SelectTrigger id="customer">
                <SelectValue placeholder={isLoading ? 'Loading…' : 'Select customer'} />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !reference.trim() || !customerId}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create ProjectIndex**

```typescript
// components/features/roomcraft/ProjectIndex.tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Folder } from 'lucide-react';
import { listProjects } from '@/lib/roomcraft/project-store';
import type { RoomCraftProject, ProjectStatus } from '@/lib/roomcraft/types';
import { CreateProjectModal } from './CreateProjectModal';

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft',
  configuring: 'Configuring',
  ready: 'Ready',
  converted: 'Converted',
};

const STATUS_VARIANTS: Record<ProjectStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  configuring: 'default',
  ready: 'outline',
  converted: 'secondary',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ProjectIndex() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<RoomCraftProject[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  React.useEffect(() => {
    setProjects(listProjects().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, [modalOpen]);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">RoomCraft Projects</h1>
        <Button onClick={() => setModalOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
          <Folder className="h-10 w-10 opacity-30" />
          <p className="text-sm">No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="divide-y border rounded-lg overflow-hidden">
          {projects.map((p) => (
            <button
              key={p.id}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              onClick={() => router.push(`/roomcraft/${p.id}`)}
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{p.reference}</p>
                <p className="text-xs text-muted-foreground">{p.customerName}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatDate(p.updatedAt)}</span>
                <Badge variant={STATUS_VARIANTS[p.pieces.length === 0 ? 'draft' : 'configuring']}>
                  {STATUS_LABELS[p.pieces.length === 0 ? 'draft' : 'configuring']}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateProjectModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite app/roomcraft/page.tsx as the index**

```typescript
// app/roomcraft/page.tsx
import { ProjectIndex } from '@/components/features/roomcraft/ProjectIndex';

export default function RoomCraftIndexPage() {
  return <ProjectIndex />;
}
```

- [ ] **Step 4: Browser verify — navigate to /roomcraft**

```
npm run dev
```

Visit `http://localhost:3000/roomcraft`. Should show the empty project index with a "New project" button. Click the button — dialog opens with a customer dropdown and reference field. Submit — should navigate to `/roomcraft/<new-uuid>` and show the canvas.

- [ ] **Step 5: Commit**

```bash
git add app/roomcraft/page.tsx \
        components/features/roomcraft/ProjectIndex.tsx \
        components/features/roomcraft/CreateProjectModal.tsx
git commit -m "feat(roomcraft): add project index page and create-project modal"
```

---

## Task 8: Draft migration prompt

**Files:**
- Create: `components/features/roomcraft/DraftMigrationPrompt.tsx`
- Modify: `components/features/roomcraft/ProjectIndex.tsx`

Detects old `unity-roomcraft:draft` or `unity-roomcraft:product:*` keys on first load and offers to convert them.

- [ ] **Step 1: Create the migration prompt component**

```typescript
// components/features/roomcraft/DraftMigrationPrompt.tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert, AlertDescription,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { saveProject } from '@/lib/roomcraft/project-store';
import type { RoomCraftProject } from '@/lib/roomcraft/types';

const MIGRATION_DISMISSED_KEY = 'unity-roomcraft:migration-dismissed';

function findLegacyKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k === 'unity-roomcraft:draft') keys.push(k);
    if (k.startsWith('unity-roomcraft:product:')) keys.push(k);
  }
  return keys;
}

interface DraftMigrationPromptProps {
  houseAccountCustomerId: number;
  houseAccountCustomerName: string;
}

export function DraftMigrationPrompt({
  houseAccountCustomerId,
  houseAccountCustomerName,
}: DraftMigrationPromptProps) {
  const router = useRouter();
  const [legacyKeys, setLegacyKeys] = React.useState<string[]>([]);

  React.useEffect(() => {
    const dismissed = localStorage.getItem(MIGRATION_DISMISSED_KEY);
    if (!dismissed) {
      setLegacyKeys(findLegacyKeys());
    }
  }, []);

  if (legacyKeys.length === 0) return null;

  function handleMigrate() {
    legacyKeys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const now = new Date().toISOString();
      const project: RoomCraftProject = {
        id: crypto.randomUUID(),
        customerId: houseAccountCustomerId,
        customerName: houseAccountCustomerName,
        reference: 'Untitled draft',
        createdAt: now,
        updatedAt: now,
        pieces: [],
      };
      // Move canvas data to project-scoped key
      localStorage.setItem(`unity-roomcraft:project:${project.id}`, raw);
      localStorage.removeItem(key);
      saveProject(project);
    });
    localStorage.setItem(MIGRATION_DISMISSED_KEY, 'true');
    setLegacyKeys([]);
    // Reload to pick up new projects
    router.refresh();
  }

  function handleDismiss() {
    legacyKeys.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(MIGRATION_DISMISSED_KEY, 'true');
    setLegacyKeys([]);
  }

  return (
    <Alert className="mb-4">
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm">
          {legacyKeys.length === 1
            ? 'You have an unsaved RoomCraft draft.'
            : `You have ${legacyKeys.length} unsaved RoomCraft drafts.`}{' '}
          Convert to a project?
        </span>
        <div className="flex gap-2 flex-shrink-0">
          <Button size="sm" onClick={handleMigrate}>Convert</Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>Discard</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 2: Add DraftMigrationPrompt to ProjectIndex**

In `components/features/roomcraft/ProjectIndex.tsx`, import `DraftMigrationPrompt` and add it above the project list. The house account values need to come from somewhere — use a constant for now that the implementer must verify exists:

```typescript
// Add import
import { DraftMigrationPrompt } from './DraftMigrationPrompt';

// Add constant (implementer: verify this customer exists in your Supabase DB)
const HOUSE_ACCOUNT_CUSTOMER_ID = 1; // TODO: replace with actual house-account customer ID
const HOUSE_ACCOUNT_CUSTOMER_NAME = 'House Account';
```

Then in the JSX, between the header row and the empty state / project list:

```tsx
<DraftMigrationPrompt
  houseAccountCustomerId={HOUSE_ACCOUNT_CUSTOMER_ID}
  houseAccountCustomerName={HOUSE_ACCOUNT_CUSTOMER_NAME}
/>
```

> **Important:** Before this ships, confirm the house-account customer row exists in the Supabase `customers` table. If it doesn't, create it via the Customers UI or a direct SQL insert. Update `HOUSE_ACCOUNT_CUSTOMER_ID` to match the real row ID.

- [ ] **Step 3: Commit**

```bash
git add components/features/roomcraft/DraftMigrationPrompt.tsx \
        components/features/roomcraft/ProjectIndex.tsx
git commit -m "feat(roomcraft): add one-time draft migration prompt"
```

---

## Task 9: Configure route — shell and block list

**Files:**
- Create: `app/roomcraft/[projectId]/configure/page.tsx`
- Create: `components/features/roomcraft/configure/ConfigureShell.tsx`
- Create: `components/features/roomcraft/configure/BlockList.tsx`

The configure route wraps its own `RoomProvider` (same storageKey as the canvas) to read block data and dispatch type/piece updates.

- [ ] **Step 1: Create BlockList component**

```typescript
// components/features/roomcraft/configure/BlockList.tsx
'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useRoomContext } from '@/components/features/roomcraft/context/RoomContext';
import type { RoomItem } from '@/components/features/roomcraft/types/room';
import type { ProjectPiece } from '@/lib/roomcraft/types';

interface BlockListItem {
  item: RoomItem;
  roomId: string;
  roomName: string;
  piece: ProjectPiece | undefined;
}

interface BlockListProps {
  pieces: ProjectPiece[];
  selectedBlockId: string | null;
  onSelectBlock: (item: RoomItem, roomId: string) => void;
}

export function BlockList({ pieces, selectedBlockId, onSelectBlock }: BlockListProps) {
  const { state } = useRoomContext();
  const pieceByBlockId = new Map(pieces.map((p) => [p.blockId, p]));

  const allBlocks: BlockListItem[] = (state.floorPlan?.rooms ?? []).flatMap(({ room }) =>
    room.items.map((item) => ({
      item,
      roomId: room.id,
      roomName: room.name,
      piece: pieceByBlockId.get(item.id),
    })),
  );

  if (allBlocks.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No blocks in this project. Add blocks on the canvas first.
      </div>
    );
  }

  return (
    <div className="divide-y text-sm">
      {allBlocks.map(({ item, roomId, roomName, piece }) => (
        <button
          key={item.id}
          className={cn(
            'w-full flex items-start justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors',
            selectedBlockId === item.id && 'bg-muted',
          )}
          onClick={() => onSelectBlock(item, roomId)}
        >
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium truncate">{item.label || `Block`}</p>
            <p className="text-xs text-muted-foreground">{roomName}</p>
          </div>
          <Badge
            variant={piece ? 'default' : 'secondary'}
            className="ml-2 flex-shrink-0 text-[10px]"
          >
            {piece ? piece.furnitureType : 'unconfigured'}
          </Badge>
        </button>
      ))}
    </div>
  );
}
```

Also export `useRoomContext` from `RoomContext.tsx` if not already exported. Check the file — add at the bottom if missing:

```typescript
// Add to RoomContext.tsx if not present:
export function useRoomContext() {
  const ctx = React.useContext(RoomContext);
  if (!ctx) throw new Error('useRoomContext must be used inside RoomProvider');
  return ctx;
}
```

- [ ] **Step 2: Create ConfigureShell**

```typescript
// components/features/roomcraft/configure/ConfigureShell.tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RoomProvider } from '@/components/features/roomcraft/context/RoomContext';
import { useRoomContext } from '@/components/features/roomcraft/context/RoomContext';
import { BlockList } from './BlockList';
import { TemplatePicker } from './TemplatePicker';
import { getProject, addPieceToProject } from '@/lib/roomcraft/project-store';
import { canvasStorageKey } from '@/lib/roomcraft/project-store';
import type { RoomCraftProject, ProjectPiece, FurnitureType, ConfiguratorConfig } from '@/lib/roomcraft/types';
import type { RoomItem } from '@/components/features/roomcraft/types/room';
import type { CutlistPart } from '@/lib/cutlist/types';
import { FurnitureConfigurator } from '@/components/features/configurator/FurnitureConfigurator';
import {
  DEFAULT_CUPBOARD_CONFIG,
  DEFAULT_PIGEONHOLE_CONFIG,
  DEFAULT_PEDESTAL_CONFIG,
} from '@/lib/configurator/templates/types';

interface ConfigureShellProps {
  projectId: string;
}

function ConfigureContent({ projectId }: ConfigureShellProps) {
  const { dispatch } = useRoomContext();
  const [project, setProject] = React.useState<RoomCraftProject | null>(null);
  const [selectedItem, setSelectedItem] = React.useState<RoomItem | null>(null);
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProject(getProject(projectId));
  }, [projectId]);

  const pieces = project?.pieces ?? [];

  function handleSelectBlock(item: RoomItem, roomId: string) {
    setSelectedItem(item);
    setSelectedRoomId(roomId);
  }

  function handleSaveSuccess(config: ConfiguratorConfig, parts: CutlistPart[]) {
    if (!selectedItem || !selectedRoomId || !project) return;
    const furnitureType = selectedItem.furnitureType ?? 'cupboard';
    const piece: ProjectPiece = {
      id: crypto.randomUUID(),
      blockId: selectedItem.id,
      roomId: selectedRoomId,
      furnitureType,
      config,
      parts,
      savedAt: new Date().toISOString(),
    };
    const updated = addPieceToProject(projectId, piece);
    setProject(updated);

    // Sync furnitureType and configuredPieceId back to canvas state
    dispatch({ type: 'SET_BLOCK_FURNITURE_TYPE', payload: { roomId: selectedRoomId, id: selectedItem.id, furnitureType } });
    dispatch({ type: 'SET_BLOCK_CONFIGURED_PIECE', payload: { roomId: selectedRoomId, id: selectedItem.id, configuredPieceId: piece.id } });

    // Resize block to match piece dimensions (piece wins on mismatch — design decision)
    const cfg = config as { width: number; depth: number; height: number };
    const dimChanged =
      Math.abs(cfg.width - selectedItem.length) > 1 ||
      Math.abs(cfg.depth - selectedItem.depth) > 1 ||
      Math.abs(cfg.height - selectedItem.height) > 1;
    if (dimChanged) {
      dispatch({
        type: 'RESIZE_BLOCK',
        payload: { roomId: selectedRoomId, id: selectedItem.id, length: cfg.width, depth: cfg.depth, height: cfg.height },
      });
    }
  }

  const existingPiece = selectedItem
    ? pieces.find((p) => p.blockId === selectedItem.id)
    : undefined;

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Link href={`/roomcraft/${projectId}`}>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <span className="text-sm font-medium truncate">
            {project?.reference ?? 'Configure'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <BlockList
            pieces={pieces}
            selectedBlockId={selectedItem?.id ?? null}
            onSelectBlock={handleSelectBlock}
          />
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedItem ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a block from the list to configure it.
          </div>
        ) : !selectedItem.furnitureType && !existingPiece ? (
          <TemplatePicker
            item={selectedItem}
            roomId={selectedRoomId!}
            onSelect={(furnitureType) => {
              dispatch({
                type: 'SET_BLOCK_FURNITURE_TYPE',
                payload: { roomId: selectedRoomId!, id: selectedItem.id, furnitureType },
              });
              setSelectedItem({ ...selectedItem, furnitureType });
            }}
          />
        ) : (
          <FurnitureConfigurator
            key={selectedItem.id}
            initialTemplateId={existingPiece?.furnitureType ?? selectedItem.furnitureType ?? 'cupboard'}
            initialConfig={(() => {
              // Re-configure: restore saved config
              if (existingPiece?.config) return existingPiece.config;
              // First-time configure: pre-fill dimensions from block (design decision: block dims are defaults)
              const type = selectedItem.furnitureType ?? 'cupboard';
              const base =
                type === 'cupboard' ? DEFAULT_CUPBOARD_CONFIG
                : type === 'pigeonhole' ? DEFAULT_PIGEONHOLE_CONFIG
                : DEFAULT_PEDESTAL_CONFIG;
              return { ...base, width: selectedItem.length, depth: selectedItem.depth, height: selectedItem.height };
            })()}
            onSaveSuccess={handleSaveSuccess}
          />
        )}
      </div>
    </div>
  );
}

export function ConfigureShell({ projectId }: ConfigureShellProps) {
  return (
    <RoomProvider storageKey={canvasStorageKey(projectId)}>
      <ConfigureContent projectId={projectId} />
    </RoomProvider>
  );
}
```

- [ ] **Step 3: Create the route page**

```typescript
// app/roomcraft/[projectId]/configure/page.tsx
import { use } from 'react';
import { ConfigureShell } from '@/components/features/roomcraft/configure/ConfigureShell';

export default function ConfigurePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return (
    <div className="h-full min-h-0 flex flex-col">
      <ConfigureShell projectId={projectId} />
    </div>
  );
}
```

- [ ] **Step 4: Verify types compile**

```
npx tsc --noEmit 2>&1 | grep -E "configure/ConfigureShell|configure/BlockList|configure/page"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/roomcraft/[projectId]/configure/page.tsx \
        components/features/roomcraft/configure/ConfigureShell.tsx \
        components/features/roomcraft/configure/BlockList.tsx
git commit -m "feat(roomcraft): add configure route shell and block list sidebar"
```

---

## Task 10: Template picker

**Files:**
- Create: `components/features/roomcraft/configure/TemplatePicker.tsx`

Shown when a block has no `furnitureType`. Designer picks the template; it's dispatched to RoomContext and the configurator opens.

- [ ] **Step 1: Create TemplatePicker**

```typescript
// components/features/roomcraft/configure/TemplatePicker.tsx
'use client';

import { Button } from '@/components/ui/button';
import { getTemplateList } from '@/lib/configurator/templates';
import type { RoomItem } from '@/components/features/roomcraft/types/room';
import type { FurnitureType } from '@/lib/roomcraft/types';

interface TemplatePickerProps {
  item: RoomItem;
  roomId: string;
  onSelect: (furnitureType: FurnitureType) => void;
}

export function TemplatePicker({ item, onSelect }: TemplatePickerProps) {
  const templates = getTemplateList();

  return (
    <div className="space-y-4 max-w-sm">
      <div>
        <h2 className="text-sm font-semibold">What is &ldquo;{item.label || 'this block'}&rdquo;?</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Choose the furniture type to configure for this block.
        </p>
      </div>
      <div className="space-y-2">
        {templates.map((t) => (
          <Button
            key={t.id}
            variant="outline"
            className="w-full justify-start"
            onClick={() => onSelect(t.id as FurnitureType)}
          >
            {t.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Browser-verify the full configure flow**

1. Start dev server: `npm run dev`
2. Go to `/roomcraft`, create a project.
3. On the canvas, add a block.
4. Navigate to `/roomcraft/<projectId>/configure`.
5. The block appears in the sidebar as "unconfigured".
6. Click the block → TemplatePicker appears.
7. Select "Cupboard" → FurnitureConfigurator opens pre-populated with block dimensions.
8. Click "Save piece" → piece appears in BlockList as "cupboard" (configured).
9. Return to canvas (`/roomcraft/<projectId>`) — block still exists. No console errors.

- [ ] **Step 3: Commit**

```bash
git add components/features/roomcraft/configure/TemplatePicker.tsx
git commit -m "feat(roomcraft): add template picker for unconfigured blocks"
```

---

## Task 11: Top-down renderer — configured block detail

**Files:**
- Modify: `components/features/roomcraft/components/canvas/RoomCanvas.tsx`

For blocks with a `configuredPieceId`, draw interior lines showing door/drawer divisions in the top-down 2D view.

- [ ] **Step 1: Understand the current block-drawing path in RoomCanvas**

Read `components/features/roomcraft/components/canvas/RoomCanvas.tsx` and find where blocks (RoomItems) are drawn in 2D. Identify the canvas `fillRect`/`strokeRect` calls for items. The addition goes after the existing block fill — draw dividing lines on top.

- [ ] **Step 2: Add a helper function for drawing configured block detail**

Add this helper near the block-drawing code in `RoomCanvas.tsx`:

```typescript
import { getProject } from '@/lib/roomcraft/project-store';
import type { ProjectPiece } from '@/lib/roomcraft/types';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

function drawConfiguredBlockDetail(
  ctx: CanvasRenderingContext2D,
  item: import('@/components/features/roomcraft/types/room').RoomItem,
  piece: ProjectPiece,
  screenX: number,
  screenY: number,
  screenLength: number,
  screenDepth: number,
): void {
  if (piece.furnitureType !== 'cupboard') return; // extend for other types later
  const config = piece.config as CupboardConfig;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.5;

  // Door division line(s)
  if (config.doorStyle === 'double') {
    // Vertical centre line
    ctx.beginPath();
    ctx.moveTo(screenX + screenLength / 2, screenY + 2);
    ctx.lineTo(screenX + screenLength / 2, screenY + screenDepth - 2);
    ctx.stroke();
  }

  // Door swing arc (single door) — small quarter circle at hinge side
  if (config.doorStyle === 'single') {
    const r = Math.min(screenLength, screenDepth) * 0.4;
    ctx.beginPath();
    ctx.arc(screenX, screenY + screenDepth, r, -Math.PI / 2, 0);
    ctx.stroke();
  }

  ctx.restore();
}
```

- [ ] **Step 3: Load pieces from project store in RoomCanvas**

`RoomCanvas` already receives `projectId?: string` (added in Task 5). Load the project inside the canvas render loop (or via a `useMemo`):

```typescript
// Near the top of the canvas rendering logic, after existing state reads:
const pieceMap = React.useMemo(() => {
  if (!projectId) return new Map<string, ProjectPiece>();
  const project = getProject(projectId);
  return new Map((project?.pieces ?? []).map((p) => [p.blockId, p]));
}, [projectId]);
```

Then, where blocks are rendered in the 2D canvas draw loop, after drawing the block fill call `drawConfiguredBlockDetail` if the piece exists:

```typescript
// Immediately after existing block fill/stroke for each item:
const piece = pieceMap.get(item.id);
if (piece) {
  drawConfiguredBlockDetail(ctx, item, piece, screenX, screenY, screenLength, screenDepth);
}
```

Note: `screenX`, `screenY`, `screenLength`, `screenDepth` are the canvas-coordinate values computed for the item in the existing draw loop. Locate these variables in the existing code and use their names as-is.

- [ ] **Step 4: Browser verify**

1. Configure a cupboard piece for a block (see Task 10 flow).
2. Return to the canvas.
3. The block should now show a door-division line (double-door) or swing arc (single-door) on top of the existing fill.

- [ ] **Step 5: Commit**

```bash
git add components/features/roomcraft/components/canvas/RoomCanvas.tsx
git commit -m "feat(roomcraft): draw door divisions on configured blocks in top-down view"
```

---

## Task 12: Isometric renderer — configured block detail

**Files:**
- Modify: `components/features/roomcraft/hooks/useIsometricRenderer.ts`

For configured cupboard blocks, draw a door-face panel as a slightly proud quad on the visible front face, divided according to `doorStyle`.

- [ ] **Step 1: Add drawConfiguredBlockIso helper**

Add this function in `useIsometricRenderer.ts`, after the existing `drawBlock` function:

```typescript
import type { ProjectPiece } from '@/lib/roomcraft/types';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

export function drawConfiguredBlockIso(
  ctx: CanvasRenderingContext2D,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  zBase: number,
  zTop: number,
  layout: IsoLayout,
  color: string,
  cameraFlipped: boolean,
  piece: ProjectPiece,
): void {
  // Draw the base block first
  drawBlock(ctx, minX, maxX, minY, maxY, zBase, zTop, layout, color, cameraFlipped);

  if (piece.furnitureType !== 'cupboard') return;
  const config = piece.config as CupboardConfig;
  if (config.doorStyle === 'none') return;

  const p = (rx: number, ry: number, rz: number) => project(rx, ry, rz, layout, cameraFlipped);

  // The visible front face is along the Y-axis (the darker side, 60% shade)
  const visibleY = cameraFlipped ? minY : maxY;
  const proud = 8; // mm — doors sit slightly proud of the carcass

  // Inset door frame: 2% each side
  const insetX = (maxX - minX) * 0.02;
  const insetZ = (zTop - zBase) * 0.02;
  const dX0 = minX + insetX;
  const dX1 = maxX - insetX;
  const dZ0 = zBase + insetZ;
  const dZ1 = zTop - insetZ;
  const doorY = visibleY + (cameraFlipped ? -proud : proud);

  const doorColor = shadeColor(color, 0.65); // slightly darker than Y-face

  if (config.doorStyle === 'double') {
    const midX = (dX0 + dX1) / 2;
    const gap = 2;
    // Left door
    ctx.fillStyle = doorColor;
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(midX - gap / 2, visibleY, dZ0), p(midX - gap / 2, doorY, dZ0), p(dX0, doorY, dZ0));
    fillQuad(ctx, p(dX0, doorY, dZ0), p(midX - gap / 2, doorY, dZ0), p(midX - gap / 2, doorY, dZ1), p(dX0, doorY, dZ1));
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(dX0, visibleY, dZ1), p(dX0, doorY, dZ1), p(dX0, doorY, dZ0));
    // Right door
    fillQuad(ctx, p(midX + gap / 2, visibleY, dZ0), p(dX1, visibleY, dZ0), p(dX1, doorY, dZ0), p(midX + gap / 2, doorY, dZ0));
    fillQuad(ctx, p(midX + gap / 2, doorY, dZ0), p(dX1, doorY, dZ0), p(dX1, doorY, dZ1), p(midX + gap / 2, doorY, dZ1));
    fillQuad(ctx, p(dX1, visibleY, dZ0), p(dX1, visibleY, dZ1), p(dX1, doorY, dZ1), p(dX1, doorY, dZ0));
  } else {
    // Single door
    ctx.fillStyle = doorColor;
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(dX1, visibleY, dZ0), p(dX1, doorY, dZ0), p(dX0, doorY, dZ0));
    fillQuad(ctx, p(dX0, doorY, dZ0), p(dX1, doorY, dZ0), p(dX1, doorY, dZ1), p(dX0, doorY, dZ1));
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(dX0, visibleY, dZ1), p(dX0, doorY, dZ1), p(dX0, doorY, dZ0));
    fillQuad(ctx, p(dX1, visibleY, dZ0), p(dX1, visibleY, dZ1), p(dX1, doorY, dZ1), p(dX1, doorY, dZ0));
  }
}
```

- [ ] **Step 2: Wire into renderIsometricView**

In `renderIsometricView`, the loop that calls `drawBlock` for each item:

```typescript
// Replace:
drawBlock(ctx, aabb.minX, aabb.maxX, aabb.minY, aabb.maxY, layer.z, layer.z + item.height, layout, color, cameraFlipped);

// With:
const piece = pieceMap?.get(item.id);
if (piece) {
  drawConfiguredBlockIso(ctx, aabb.minX, aabb.maxX, aabb.minY, aabb.maxY, layer.z, layer.z + item.height, layout, color, cameraFlipped, piece);
} else {
  drawBlock(ctx, aabb.minX, aabb.maxX, aabb.minY, aabb.maxY, layer.z, layer.z + item.height, layout, color, cameraFlipped);
}
```

Update the `renderIsometricView` signature to accept `pieceMap`:

```typescript
export function renderIsometricView(
  ctx: CanvasRenderingContext2D,
  room: Room,
  layers: Layer[],
  canvasW: number,
  canvasH: number,
  cameraFlipped: boolean,
  pieceMap?: Map<string, ProjectPiece>,
): void {
```

Update all callers of `renderIsometricView` in `RoomCanvas.tsx` to pass the pieceMap as the 7th argument (pass `undefined` if not available). The `pieceMap` is already computed in Task 11.

- [ ] **Step 3: Browser verify isometric**

1. Configure a cupboard block with `doorStyle: 'double'`.
2. Open the isometric view.
3. The block should show two door-face panels protruding from the front face, divided at centre.
4. Click the rotate button — panels should appear on the correct face in both SE and NW views.

- [ ] **Step 4: Lint and type check**

```
npm run lint
npx tsc --noEmit 2>&1 | grep "useIsometricRenderer"
```

Expected: no new errors (pre-existing tsc errors in unrelated modules are acceptable).

- [ ] **Step 5: Commit**

```bash
git add components/features/roomcraft/hooks/useIsometricRenderer.ts
git commit -m "feat(roomcraft): render door faces on configured blocks in isometric view"
```

---

## Add configure button to canvas

**Files:**
- Modify: `components/features/roomcraft/components/ui/Sidebar.tsx`

A "Configure furniture" button in the RoomCraft sidebar that navigates to the configure route.

- [ ] **Step 1: Add the button to the Sidebar**

In `components/features/roomcraft/components/ui/Sidebar.tsx`, import `useRouter` and add a button. The `projectId` needs to be accessible — pass it as a prop to Sidebar (it flows down from `RoomCraftApp`).

Update `RoomCraftApp` to pass `projectId` to `<Sidebar>`:

```typescript
// In RoomCraftApp.tsx:
<AppShell sidebar={<Sidebar projectId={projectId} />}>
```

In `Sidebar.tsx`, add to the props interface:

```typescript
interface SidebarProps {
  projectId?: string;
}
```

Then add a "Configure furniture" button at the bottom of the sidebar (or in a logical location like the Objects & Layers section):

```tsx
{projectId && (
  <div className="px-3 pb-3">
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={() => router.push(`/roomcraft/${projectId}/configure`)}
    >
      Configure furniture
    </Button>
  </div>
)}
```

- [ ] **Step 2: Browser verify**

On the canvas at `/roomcraft/<projectId>`, the "Configure furniture" button should appear in the sidebar and navigate to the configure route.

- [ ] **Step 3: Commit**

```bash
git add components/features/roomcraft/components/ui/Sidebar.tsx \
        components/features/roomcraft/RoomCraftApp.tsx
git commit -m "feat(roomcraft): add configure furniture button to canvas sidebar"
```

---

## Final verification

- [ ] Run lint across the project: `npm run lint`
- [ ] Run type check: `npx tsc --noEmit 2>&1 | grep -v "node_modules"` (pre-existing errors in unrelated modules are acceptable; no new errors in `lib/roomcraft`, `app/roomcraft`, `components/features/roomcraft`, `components/features/configurator`, `hooks/use-customers-list`)
- [ ] Run project-store tests: `npx tsx --test tests/roomcraft-project-store.test.ts`
- [ ] End-of-session git check: `git status`, `git stash list`, `git branch --show-current`, `git log codex/integration..origin/codex/integration --oneline`, `git log origin/codex/integration..codex/integration --oneline`, `git worktree list`

---

## Out of scope (v1)

- Supabase migration for project/piece storage (localStorage only in this plan)
- "Out of sync" mismatch flag and resolution flow (dimension delta > 1mm)
- "Split block into N" ergonomic action
- Pedestal/pigeonhole rendering in top-down and isometric views (cupboard only in Tasks 11–12; extend following the same pattern)
- Project → quote generation
- Block count display on project index
- Summary-only print from configure route
