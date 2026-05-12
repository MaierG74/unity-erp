# Order Line Setup Panel — Phase 2 + Phase 3 Design Spec

- **Date:** 2026-05-12
- **Author:** Greg Maier (Claude Code, local desktop)
- **Status:** Draft for plan review
- **Related Phase 1 spec:** [docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md](2026-05-08-order-products-setup-panel-design.md)
- **Phase 1 plan:** [docs/superpowers/plans/2026-05-08-order-products-setup-panel.md](../plans/2026-05-08-order-products-setup-panel.md)
- **Live mockup (Variant 4):** [public/order-panel-v4.html](../../../public/order-panel-v4.html) — served at `http://localhost:3000/order-panel-v4.html`
- **Linear:** TBD (file under Manufacturing project after approval)

## Goal

Take the Order Line Setup panel from "functional read-only mirror" (Phase 1) to "calm by default, action-rich on demand" — the panel becomes the operator's primary action surface for any product line, not just a status read-out.

Phase 2 ships the visual + interaction polish using existing APIs only. Phase 3 adds a new per-component reservation backend so operators can reserve individual components without firing the order-wide reserve.

## Non-goals (both phases)

- **No cost numbers on the Products tab.** The rule in [docs/domains/orders/orders-master.md L69](../../domains/orders/orders-master.md) stays in force.
- **No changes to `CutlistMaterialDialog`** — still reused unchanged.
- **No inline editing of board / backer / edging** in the panel. Still Phase 4 territory.
- **No changes to the snapshot rule.** Order line owns its `bom_snapshot`, `cutlist_material_snapshot`, `cutlist_costing_snapshot`.
- **No tabbed panel.** Per GPT-5.5 Pro round-2 sign-off in Phase 1: stacked sections, not tabs.
- **No retirement of `slideOutProduct` yet.** Still Phase 4+. Stays compiled but unreachable.

## Phasing summary

| Phase | Scope | Backend changes | Branch |
|---|---|---|---|
| **2** | All-collapsed default, localStorage persistence, status in header, single-line readiness rows with code + description + tabular nums, ⟳ swap (existing), 🛒 per-row order (new wiring to existing dialog), ＋ Reserve all (existing API) | None — UI + new dialog prop only | `codex/local-order-panel-phase-2` (created by implementer) |
| **3** | Per-row ＋ reserve button wired to a new `reserve_order_component` RPC + API route | New RPC, new API route, no schema changes (table + RLS already exist) | `codex/local-order-panel-phase-3` (created by implementer) |

Phases ship as **two PRs**. Phase 2 is independently valuable and lands first. Phase 3 lands after Phase 2 merges — the per-row ＋ reserve button is added in Phase 3 alongside its backend.

## Phase 2 — UI polish + per-row order action

### Section collapse model

All four sections (Overview, Cutlist Materials, Component Readiness, Next Actions) **start collapsed** by default. The operator clicks the chevron to expand.

When collapsed, each section shows:
- Section name (e.g. `▶ COMPONENT READINESS`)
- A **summary pill** that conveys state at a glance (see "Section pills" below)
- Section-level action buttons remain visible in the header (Edit materials, Reserve all)

When expanded, the body renders. The chevron rotates 90° (CSS only, no animation library).

Persistence: a per-section collapse override is stored in `localStorage` under key `unity-erp.order-panel.sections.<sectionId>` → `'open' | 'closed'`. Smart defaults still apply when no override exists; once the operator explicitly toggles a section, their preference sticks across sessions. **No URL state** for collapse — different from the `?line=<id>` URL state that survives reload, which Phase 1 already does.

### Status sentence in header

The Overview section's status line ("1 component short" / "Ready to plan") moves into the panel header below the qty:

```
ORDER LINE SETUP                                          ✕
1500mm Cupboard
qty 1 · 1 component short                ← destructive when shortfall
```

This makes the headline answer always visible even when Overview is collapsed.

Status sentence stays the same kind set as Phase 1: `Ready to plan` / `Needs cutlist material` / `N components short`. Snapshot-stale detection remains out of scope.

### Section pills

When sections are collapsed, an at-a-glance pill in the header conveys section state without expanding:

| Section | Pill states |
|---|---|
| Overview | _(no pill — header status sentence already covers this)_ |
| Cutlist materials | `Not configured` (muted) / `<primary name>` (default) / `N overrides` (when overrides exist) |
| Component readiness | `N short` (destructive) / `All ready` (success) |
| Next actions | _(no pill)_ |

Pills are hairline-bordered, low-chroma. Color signal only when meaningful (destructive for shortfall, success for "all ready"); otherwise muted neutral.

### Component Readiness — single-line rows

Replaces the divide-y list from Phase 1's bug-fix commit. Each component is one row:

```
CODE         DESCRIPTION                     REQ  AVAIL  SHORT       ⟳  ＋  🛒
M8 GROMMETS  M8X13L Grommets ( Lipped )       4   1934      0
M8 ADJUSTER  Adjuster M8                      4   2957      0
PIN67        Clear Shelf pin                  8    766      0
RIH1516      Hollow SSS Bar Handle Clover...  2      0      2        ← destructive tint
```

Grid: `110px 1fr 32px 50px 32px 22px 22px 22px` with 6px column gap.

- **Code column** (110px, bold, ellipsis truncation, tooltip on hover) — fits `M8 GROMMETS` (11 chars) intact.
- **Description column** (`1fr`, muted, ellipsis truncation, tooltip on hover).
- **Three number columns** right-aligned, tabular-nums: Required, Available, Shortfall.
- **Three icon columns** at the right edge: swap, reserve, order.
- **Zebra striping** via `nth-child(even)` at ~3% black overlay.
- **Shortfall row tint** (`bg-destructive/5`) extends edge-to-edge of the section.
- Row click handler exists only to keep action-button clicks from bubbling. **Clicking the row body itself is a no-op in Phase 2.** The "expand for full breakdown" interaction (In stock / Reserved / On order / Global shortfall on row click) is deferred to Phase 4.

### Per-row action icons (Phase 2)

Three icon buttons per row, state-aware:

| Icon | Color | Enabled when | Action |
|---|---|---|---|
| ⟳ Swap | Muted | Snapshot entry exists | Opens existing same-category swap dialog via `setSwapTarget` (Phase 1 wiring) |
| ＋ Reserve | Workshop Teal | _(Phase 3 — visible but **omitted in Phase 2**)_ | _(Phase 3 wiring)_ |
| 🛒 Order | Amber | `shortfall > 0` | Opens existing `OrderComponentsDialog` with `initialFocusComponentId={component_id}` |

**Phase 2 omits the ＋ Reserve column entirely** until Phase 3 lands. The grid becomes `110px 1fr 32px 50px 32px 22px 22px` (7 columns, no reserve slot) for Phase 2, then expands to 8 columns when Phase 3 ships. This avoids shipping a disabled-and-greyed button that trains operators to ignore that slot.

Disabled state for 🛒 (when no shortfall): 28% opacity, no hover effect, tooltip explains.

### `OrderComponentsDialog` — new prop

Extend `components/features/orders/OrderComponentsDialog.tsx` with a single new prop:

```ts
interface OrderComponentsDialogProps {
  orderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /** When set, on open the dialog scrolls to this component, expands its supplier group, and pre-checks it. */
  initialFocusComponentId?: number;
}
```

Behavior:
- On open with `initialFocusComponentId` set: find the row, scroll-into-view, expand if collapsed, pre-check the checkbox.
- If the component isn't in the dialog's data (e.g. fully covered by stock), surface a toast: "Component covered by stock — no shortfall to order."
- When prop not set: no change to current behavior.

### Reserve all button (Phase 2)

A teal button in the Component Readiness section header (visible regardless of section collapse state):

- **Visible when** any BOM component on the order has `available > 0` and `qty_reserved_for_this_order < required`. Equivalently, when there's stock available to reserve that isn't already reserved.
- **Hidden when** no row has reservable stock (nothing to reserve).
- **Action**: calls existing `reserveComponentsMutation.mutateAsync()` → `POST /api/orders/[orderId]/reserve-components` → existing `reserve_order_components` RPC.
- Loading spinner while pending; disabled during the mutation.

### Next actions section (Phase 2)

Becomes collapsible like the others, defaulted collapsed. When expanded, lists the same four actions from Phase 1 (Reserve order components / Generate cutting plan / Issue stock / Create job cards).

Honest naming: rename "Reserve order components" entry to **"Procure shortfalls"** since the action that operators actually need most often when expanding this section is the order flow, not the reserve flow (Reserve all is already in the section header above). The action navigates to `?tab=procurement` like before.

Actually — **keep the four actions as-is for Phase 2**. Renaming during a polish phase confuses muscle memory. Revisit naming in Phase 4 when inline editing arrives.

## Phase 3 — Per-component reservation backend

### New RPC: `reserve_order_component_single`

```sql
CREATE OR REPLACE FUNCTION public.reserve_order_component_single(
  p_order_id INT,
  p_component_id INT,
  p_org_id UUID
)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC, qty_available NUMERIC, qty_required NUMERIC)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_required NUMERIC;
  v_available NUMERIC;
  v_other_reserved NUMERIC;
  v_reservable NUMERIC;
BEGIN
  -- Required quantity for this component on this order (sum across all order_details × BOM quantities)
  SELECT COALESCE(SUM(bom.quantity_required * od.quantity), 0)::NUMERIC
  INTO v_required
  FROM public.order_details od
  JOIN public.billofmaterials bom ON od.product_id = bom.product_id
  WHERE od.order_id = p_order_id AND bom.component_id = p_component_id;

  -- Inventory on hand
  SELECT COALESCE(quantity_on_hand, 0)::NUMERIC
  INTO v_available
  FROM public.inventory
  WHERE component_id = p_component_id;

  -- Other orders' active reservations for this component (this org only)
  SELECT COALESCE(SUM(qty_reserved), 0)::NUMERIC
  INTO v_other_reserved
  FROM public.component_reservations
  WHERE component_id = p_component_id
    AND order_id <> p_order_id
    AND org_id = p_org_id;

  v_reservable := GREATEST(0, LEAST(v_required, COALESCE(v_available, 0) - COALESCE(v_other_reserved, 0)));

  -- Important: `component_reservations.qty_reserved` has a CHECK (qty_reserved > 0).
  -- If the computed reservable is 0 we MUST delete any existing row instead of
  -- upserting a zero — otherwise the CHECK constraint trips.
  IF v_reservable > 0 THEN
    INSERT INTO public.component_reservations (order_id, component_id, qty_reserved, org_id)
    VALUES (p_order_id, p_component_id, v_reservable, p_org_id)
    ON CONFLICT (order_id, component_id) DO UPDATE
      SET qty_reserved = EXCLUDED.qty_reserved;
  ELSE
    -- Nothing reservable now (stock depleted, or already covered elsewhere).
    -- Drop any stale existing reservation for this (order_id, component_id) pair.
    DELETE FROM public.component_reservations
    WHERE order_id = p_order_id AND component_id = p_component_id;
  END IF;

  RETURN QUERY
  SELECT
    p_component_id,
    v_reservable,
    COALESCE(v_available, 0),
    COALESCE(v_required, 0);
END;
$function$;
```

**Why a new RPC instead of extending `reserve_order_components`?**
- The existing RPC does a delete-then-insert for the *entire order*. Calling it per-component would reset reservations for components the operator didn't touch.
- The per-component RPC is upsert-on-conflict, so it preserves the other components' state.
- Both RPCs can coexist; the order page Reserve all button keeps using the existing one.

**Auto-release trigger:** the existing `trg_auto_release_component_reservations` (per [orders-master.md L50](../../domains/orders/orders-master.md)) already deletes per-order reservations when the order moves to Completed/Cancelled. No trigger change needed for the new RPC.

### New API route

`POST /api/orders/[orderId]/reserve-component/[componentId]/route.ts`

- Auth: `requireModuleAccess` with `MODULE_KEYS.ORDERS_FULFILLMENT` (matches the existing reserve-components route).
- Org-scoping: pulls `orgId` from the access result.
- Validates: `orderId` and `componentId` parse as positive integers.
- Calls: `supabaseAdmin.rpc('reserve_order_component_single', { p_order_id, p_component_id, p_org_id })`.
- Returns: `{ component_id, qty_reserved, qty_available, qty_required }` and a 200 on success.
- Errors: standard pattern matching `reserve-components` route — 400 on bad input, 403 on missing module / org, 500 on RPC failure.

### Migration

Single file: `supabase/migrations/2026<MMDDHHMMSS>_reserve_order_component_single.sql`.

Contains: the RPC function only. No schema changes (the `component_reservations` table already has `(order_id, component_id)` as a unique key per [20260303085534_component_reservations_table.sql](../../../supabase/migrations/20260303085534_component_reservations_table.sql)). No RLS changes — the existing `component_reservations_insert_org_member` and `_update_org_member` policies cover the new RPC's writes.

**Migration discipline checklist:**
1. File at `supabase/migrations/<timestamp>_reserve_order_component_single.sql`
2. `mcp__supabase__apply_migration` with matching name
3. `mcp__supabase__list_migrations` reconciliation (must include the new entry)
4. `docs/operations/migration-status.md` update
5. `mcp__supabase__get_advisors --type security` post-apply — zero warnings expected; the function inherits the same security posture as `reserve_order_components`.

### Phase 3 UI wiring

- Add the ＋ Reserve column back to the readiness grid (`110px 1fr 32px 50px 32px 22px 22px 22px`).
- Per-row ＋ reserve button:
  - **Enabled when** `available > 0` AND `qty_reserved_for_this_component_on_this_order < required`
  - **Disabled when** `available = 0` (tooltip: "Nothing in stock to reserve — order instead")
  - **Disabled when** already fully reserved (tooltip: "Already reserved")
- Click handler: `reserveComponentMutation.mutateAsync({ componentId })` → new API route → on success, invalidate the order's component-requirements query so the UI refreshes Reserved/Avail/Short numbers.

### New TanStack Query mutation

`hooks/useReserveOrderComponent.ts` (new file):

```ts
export function useReserveOrderComponent(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (componentId: number) => {
      const response = await authorizedFetch(`/api/orders/${orderId}/reserve-component/${componentId}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to reserve component');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
    },
  });
}
```

## Data dependencies

### Already available

- All Phase 1 data (panel reads existing queries; nothing new for Phase 2 except the dialog focus prop)
- `component_reservations` table with `(order_id, component_id)` unique constraint
- `inventory` table for `quantity_on_hand`
- `billofmaterials` for `quantity_required`
- `order_details` for line `quantity`
- `organization_members` for RLS check
- Existing `OrderComponentsDialog` and its data fetch path

### Needed (Phase 3 only)

- New `reserve_order_component_single` RPC
- New API route `/api/orders/[orderId]/reserve-component/[componentId]`
- New `useReserveOrderComponent` hook

### Definitely not needed

- New schema (table, column, view)
- New RLS policies (existing component_reservations RLS already covers writes through the new RPC)
- New migrations beyond the single RPC migration
- Per-line reservation logic (reservations stay component-scoped; "this order × this component" is the unit)

## Files likely touched

### Phase 2

| File | Change |
|---|---|
| `components/features/orders/OrderLineSetupPanel.tsx` | Section collapse state, localStorage persistence, header status sentence, section pills |
| `components/features/orders/setup-panel/OverviewSection.tsx` | Remove status line (moves to panel header); add collapse wrapper |
| `components/features/orders/setup-panel/CutlistMaterialsSection.tsx` | Collapsed-default wrapper, "Edit materials" stays in header |
| `components/features/orders/setup-panel/ComponentReadinessSection.tsx` | Replace divide-y list with single-line rows; add ⟳ + 🛒 action icons; integrate "Reserve all" button in section header |
| `components/features/orders/setup-panel/NextActionsSection.tsx` | Collapsed-default wrapper |
| `components/features/orders/setup-panel/ReadinessRow.tsx` | **New.** Single-line row component (code + desc + numbers + actions). |
| `components/features/orders/OrderComponentsDialog.tsx` | Add `initialFocusComponentId` prop; on-open focus/scroll/check logic |
| `app/orders/[orderId]/page.tsx` | Wire the panel's 🛒 click → `setOrderComponentsOpen(true)` + `setOrderComponentsFocus(componentId)` |
| `lib/orders/panel-collapse.ts` | **New.** Pure helper for localStorage read/write with safe defaults |
| `lib/orders/panel-collapse.test.ts` | **New.** Vitest unit tests |

Approximate Phase 2: ~400 LOC new, ~250 LOC modified.

### Phase 3

| File | Change |
|---|---|
| `supabase/migrations/<timestamp>_reserve_order_component_single.sql` | **New.** RPC function |
| `app/api/orders/[orderId]/reserve-component/[componentId]/route.ts` | **New.** POST handler |
| `hooks/useReserveOrderComponent.ts` | **New.** Mutation hook |
| `components/features/orders/setup-panel/ComponentReadinessSection.tsx` | Add ＋ reserve column to grid; wire to new hook |
| `components/features/orders/setup-panel/ReadinessRow.tsx` | Add ＋ reserve button slot |
| `components/features/orders/OrderLineSetupPanel.tsx` | Pass mutation hook through to rows |
| `docs/operations/migration-status.md` | Append new migration |

Approximate Phase 3: ~250 LOC new, ~80 LOC modified.

## Visual treatment

- Sections separated by hairline borders, no nested cards.
- No shadows on resting surfaces.
- Status sentence in header is text, not a pill — destructive color when shortfall, success color when ready, default fg when neutral.
- Section pills are hairline-bordered, low-chroma. Use the destructive-bg / success-bg variants from Phase 1's MaterialChip / pill conventions.
- Per-row action icons: 22×22px, transparent background, rounded-sm hover. Hover background uses the icon's role color at low chroma (teal for reserve, amber for order).
- Zebra striping is subtle — `bg-black/12` on even rows. Shortfall row tint takes precedence over zebra.
- Row click expands to detail breakdown (Phase 4 scope — leave the handler stubbed in Phase 2).

## Risks / edge cases

| Risk | Mitigation |
|---|---|
| Operator collapses every section once; the next operator on the same machine sees collapsed-by-default and forgets state lives in localStorage. | localStorage is per-browser-profile by design. We're matching the [list-state-persistence rule](../../../.claude/projects/-Users-gregorymaier-developer-unity-erp/memory/feedback_list_state_persistence.md). |
| `OrderComponentsDialog` doesn't have the row because the shortfall has since been covered by stock (race condition between panel render and dialog fetch). | Toast "Component covered by stock — no shortfall to order" + open dialog normally; operator can dismiss. |
| Per-row reserve race: two operators reserve the same component on different orders simultaneously. | RPC reads `inventory.on_hand` and `SUM(other orders' reservations)` at evaluation time. Concurrent operators may see different `v_reservable` values; the second to commit gets the smaller share. No advisory lock — matches the existing `reserve_order_components` behavior. Phase 3 does NOT introduce row-level locking. |
| Reserve all + per-row reserve interact unpredictably. | Per-row uses upsert-on-conflict; Reserve all does delete-then-insert. If operator clicks per-row then Reserve all, the per-row reservation gets wiped and re-created from scratch (probably to the same value). Acceptable — the operator's intent in either case is "reserve what we can." Documented in the Phase 3 PR description. |
| Migration rollback: if Phase 3 RPC has a bug post-deploy, the existing per-order Reserve all still works (no shared code path). | Rollback is `DROP FUNCTION reserve_order_component_single`. UI degrades gracefully to "Reserve all only" if the per-row button hits the rolled-back endpoint (toast on 404). |
| The Phase 2 PR ships before Phase 3 — operators won't see a per-row reserve button. | Documented intentionally. Greg knows; OPs not yet expecting it. Phase 2 release notes say "per-row reserve coming in Phase 3 once backend lands." |
| Component readiness row click handler conflicts with action button clicks. | Use the existing row-click guardrail pattern from Phase 1 (`event.target.closest('button, a, input, ...')` early return). |

## Acceptance criteria

### Phase 2

- [ ] All four sections start collapsed on first visit; operator's toggle state persists in localStorage.
- [ ] Status sentence (`Ready to plan` / `Needs cutlist material` / `N components short`) appears in the panel header next to the qty.
- [ ] Section pills appear in collapsed-state headers: Cutlist materials shows primary material name or override count; Component readiness shows `N short` or `All ready`.
- [ ] Component Readiness section uses single-line rows with code + description side-by-side, Req/Avail/Short tabular columns, ⟳ + 🛒 action icons.
- [ ] Zebra striping on alternating rows; destructive tint on shortfall rows.
- [ ] 🛒 button enabled only when `shortfall > 0`; click opens `OrderComponentsDialog` with that component pre-focused (scrolled into view, expanded supplier group, pre-checked).
- [ ] ＋ Reserve all button visible in Component Readiness section header when reservable stock exists across the order.
- [ ] No new queries or API routes introduced.
- [ ] No schema/RLS/migration changes.
- [ ] `CutlistMaterialDialog` unchanged.

### Phase 3

- [ ] Migration `<timestamp>_reserve_order_component_single.sql` applied to live (live project ref `ttlyfhkrsjjrzxiagzpb`).
- [ ] `list_migrations` shows the new entry; `get_advisors --type security` returns zero new warnings.
- [ ] `docs/operations/migration-status.md` updated.
- [ ] New API route `POST /api/orders/[orderId]/reserve-component/[componentId]` returns 200 with the RPC result on happy path.
- [ ] New `useReserveOrderComponent` hook invalidates the right query keys on success.
- [ ] ＋ reserve button appears in each readiness row; enabled when `available > 0` and not fully reserved; click reserves up to `min(required, available - other_reserved)`.
- [ ] Per-row reserve does NOT wipe other components' reservations (verified with browser smoke).
- [ ] Reserve all still works (verified with browser smoke).

## Verification commands

### Phase 2

- `npx vitest run lib/orders/panel-collapse.test.ts` (expect ≥4 tests PASS)
- `npm run lint` (clean for touched files; pre-existing warnings unchanged)
- `npx tsc --noEmit` (clean for new files)
- Browser smoke via preview MCP on order with shortfall: click 🛒 → dialog opens with row pre-focused; click ＋ Reserve all → all reservable components get reserved; reload page → collapse state persists; switch tabs → collapse state still there.

### Phase 3

- `mcp__supabase__apply_migration` for the new migration file
- `mcp__supabase__list_migrations` — confirm new entry
- `mcp__supabase__get_advisors --type security` — zero new warnings
- `mcp__supabase__execute_sql` with a test invocation of the new RPC (read-only test, then a real reserve, then verify with a SELECT, then release)
- Browser smoke: click per-row ＋ reserve → row's Reserved value updates, Avail drops, Short stays the same (since reserve doesn't change demand); other components untouched; Reserve all continues to work; release_order_components clears everything correctly.

## Out-of-scope reminders for the implementer

- Do not modify `CutlistMaterialDialog.tsx`.
- Do not surface cost numbers on the Products tab.
- Do not change snapshot semantics on `order_details`.
- Do not delete or rewrite `slideOutProduct` state — still compiled-but-unreachable.
- Do not introduce row-level locking on `component_reservations` in Phase 3 (matches existing API behavior; no advisory lock requested).
- Do not extend the existing `reserve_order_components` RPC to take a component_id — the per-component path is a NEW RPC.
- Do not add a new column to `component_reservations` — the existing `(order_id, component_id, qty_reserved, org_id)` shape is sufficient.

## Open questions / future decisions

- **Phase 4: row click → expanded breakdown UI.** The row click handler exists in Phase 2 but doesn't expand anything yet. Phase 4 wires the breakdown view.
- **Phase 4: inline editing of board/backer/edging.** Still deferred.
- **Future: undo / "Release this component" per row.** Phase 3 doesn't add a per-row release. Operators use the existing order-level Release button or the per-row reserve will compute `qty_reserved = 0` if state changes.
- **Future: collapse state sync across browser profiles.** Out of scope; localStorage is per-profile by design.

## Preflight findings baked into this spec

- `reserve_order_components` RPC body inspected — delete-then-insert pattern, returns rows from `RETURNING`. Per-component RPC uses upsert-on-conflict instead to coexist cleanly.
- `component_reservations` table confirmed to have `UNIQUE (order_id, component_id)` constraint per `20260303085534_component_reservations_table.sql:10`.
- **CHECK constraint gotcha:** `component_reservations.qty_reserved` has `CHECK (qty_reserved > 0)` (strictly positive). The per-component RPC must branch on `v_reservable > 0` and DELETE the row when reservable is 0 — naive upsert would throw a CHECK violation. Already baked into the RPC body above.
- RLS on `component_reservations` migrated from `profiles.org_id` to the standard `organization_members` pattern in `20260303151451_component_reservations_rls_and_indexes.sql`. New RPC works under those policies; no policy changes needed.
- Auto-release trigger `trg_auto_release_component_reservations` deletes per-order reservations when `orders.status_id` transitions to Completed/Cancelled. Confirmed in `20260303085743_auto_release_component_reservations_trigger.sql`. The new RPC inherits this behavior — no trigger changes needed.
- `OrderComponentsDialog` doesn't currently accept a pre-selected component — Phase 2 adds the `initialFocusComponentId` prop additively.
- `requireModuleAccess` middleware with `MODULE_KEYS.ORDERS_FULFILLMENT` is the existing auth pattern for `/api/orders/[orderId]/reserve-components` — Phase 3 route follows the same pattern verbatim.
- `inventory.quantity_on_hand` and `billofmaterials.quantity_required` confirmed as the data the existing `reserve_order_components` reads. The new RPC follows the same conventions.

## Standing rules respected

- **LOCAL DESKTOP ONLY** for Codex execution (Phase 3 migration applies to live; this branch is desktop-only).
- **`delegate=null`** on any Linear issue filed against this spec (Cloud auto-pickup remains revoked).
- **Wage-table safety** — not relevant (no wage tables touched).
- **Migration discipline** — Phase 3 follows the four-step ritual (file + apply + list + status doc).
- **View drift** — not relevant (no columns added to base tables).
- **Browser smoke is reviewer responsibility** when Codex skips.
