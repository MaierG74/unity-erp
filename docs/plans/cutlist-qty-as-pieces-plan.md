# Cutlist: Qty = Pieces to Cut (Option B)

> **Status**: Planning
> **Created**: 2026-01-25

---

## Overview

Change the cutlist system so that **Qty always means "pieces to cut"**, not "finished assemblies". Lamination becomes assembly metadata that affects edge thickness calculation but does NOT multiply quantities.

### Why This Change?

**Current Problem:**
- CSV import contains actual cut pieces (e.g., 4 pieces for 2 laminated legs)
- If user sets "Same Board" lamination, system doubles to 8 pieces (incorrect)
- Two mental models cause confusion:
  - CSV: Qty = pieces to cut
  - Manual with lamination: Qty = finished assemblies (then doubled)

**Solution:**
- One consistent model: Qty always = pieces to cut
- Lamination = "how will these pieces be assembled" (metadata)
- No automatic quantity multiplication
- CSV and manual entry work identically

---

## Example: 32mm Desk Legs

**Scenario:** 2 finished desk legs, each made from 2 × 16mm boards laminated together.

| Approach | User Enters | System Calculates |
|----------|-------------|-------------------|
| **Before (Current)** | Qty=2, Lam="Same Board" | 2 × 2 = 4 pieces |
| **After (Option B)** | Qty=4, Lam="Same Board" | 4 pieces (no multiplication) |
| **CSV Import** | CSV has 4 pieces | 4 pieces (works correctly) |

**UI Enhancement:** Show derived info like "→ 2 finished assemblies"

---

## Technical Changes

### 1. `expandPartsWithLamination()` - Remove Quantity Doubling

**File:** `lib/cutlist/boardCalculator.ts`

**Before:**
```typescript
case 'same-board': {
  // 2× same board - doubled primary quantity
  const expandedPart = toExpandedPart(part, baseQty * 2, { materialId: materialKey });
  addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
  totalPrimaryParts += baseQty * 2;
}
```

**After:**
```typescript
case 'same-board': {
  // Same board lamination - pieces are paired during assembly
  // Qty represents actual pieces to cut, NOT finished assemblies
  const expandedPart = toExpandedPart(part, baseQty, { materialId: materialKey });
  addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
  totalPrimaryParts += baseQty;
}
```

### 2. Edge Thickness - Keep As-Is

Edge thickness calculation remains unchanged:
- `none` → 16mm edge
- `same-board` → 32mm edge
- `with-backer` → 32mm edge
- `custom` → based on config

This is correct because the finished part thickness determines edging width.

### 3. `with-backer` Behavior - Review

**Current:** Creates 1× primary + 1× backer (same qty for both)

**Question:** Should this change?
- If user enters Qty=4 with "With Backer", do they mean:
  - A) 4 primary + 4 backer pieces (8 total)? ← Current behavior
  - B) 4 pieces total (2 primary + 2 backer)?

**Recommendation:** Keep current behavior (Option A). User specifies how many of the primary material they need, and the system adds matching backer pieces. This is intuitive: "I need 4 visible tops, each needs a backer."

### 4. UI Enhancement - Show Finished Assemblies (Optional)

Add derived display in CompactPartsTable:

```typescript
function getFinishedAssemblies(qty: number, laminationType: LaminationType): string | null {
  switch (laminationType) {
    case 'same-board':
      return qty >= 2 ? `→ ${Math.floor(qty / 2)} finished` : null;
    case 'with-backer':
      return `→ ${qty} finished (+ backer)`;
    case 'custom':
      // Calculate based on layer count
      return null;
    default:
      return null;
  }
}
```

**Display:** Small muted text next to Qty or in a tooltip.

### 5. Remove `is_pre_expanded` Flag

This flag is no longer needed since there's no quantity doubling to skip.

---

## Files to Modify

| File | Change |
|------|--------|
| `lib/cutlist/boardCalculator.ts` | Remove `baseQty * 2` for same-board |
| `components/features/cutlist/primitives/CompactPartsTable.tsx` | Optional: show finished assemblies hint |
| `docs/plans/cutlist-improvements.md` | Update to reflect new approach |
| `docs/features/cutlist-calculator.md` | Update lamination documentation |

---

## Testing Checklist

- [ ] Manual entry: Qty=4 with "Same Board" → 4 pieces calculated
- [ ] Manual entry: Qty=4 with "With Backer" → 4 primary + 4 backer
- [ ] CSV import: 4 pieces → 4 pieces (no change)
- [ ] CSV import + set "Same Board" → still 4 pieces (no doubling)
- [ ] Edge thickness: "Same Board" → 32mm edging calculated
- [ ] Edge thickness: "None" → 16mm edging calculated
- [ ] Custom lamination: edge thickness based on config
- [ ] Board nesting: correct number of parts placed on sheets

---

## Migration Notes

**Breaking Change:** Users who relied on quantity doubling will need to adjust.

However, this is actually a **clarification** more than a breaking change:
- If users entered Qty=2 expecting 2 finished legs, they now enter Qty=4
- The old behavior was ambiguous and error-prone
- New behavior is explicit and matches what the factory actually cuts

---

## Implementation Order

1. Modify `expandPartsWithLamination()` to remove doubling
2. Update documentation
3. Optional: Add finished assemblies hint in UI
4. Test all scenarios

---

*Created: 2026-01-25*
