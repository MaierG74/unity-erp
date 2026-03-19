# Shared Item Selection Dialog

**Date**: 2026-03-02
**Status**: Approved

## Problem

The Product BOM page has a basic, clunky "Add Component" dialog (no live search, manual Search button click, hand-rolled modal) while the Quote module has a polished, tabbed `ComponentSelectionDialog` with tokenized search, supplier browsing, and multiple item types. Two separate codebases doing the same thing, one much better.

## Solution

Refactor the Quote `ComponentSelectionDialog` into a shared, configurable `ItemSelectionDialog` that both Quotes and Product BOM consume.

## Design

### Tab configuration via props

```typescript
type TabId = 'manual' | 'component' | 'product' | 'cluster' | 'supplier';

// Quotes:      tabs={['manual','component','product','cluster','supplier']}
// Product BOM: tabs={['component','product','supplier']}
```

BOM = inventory items only. Manual/Cluster tabs are Quote-specific.

### Props interface

```typescript
interface ItemSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onAddComponent: (item: SelectedItem) => void;
  tabs?: TabId[];
  defaultTab?: TabId;
  requireSupplier?: boolean;
  productBomMode?: {
    productId: number;
    enableAttach?: boolean;
  };
}
```

### File changes

| File | Action |
|------|--------|
| `components/features/shared/ItemSelectionDialog.tsx` | New — extracted from `ComponentSelectionDialog` with `tabs` prop |
| `components/features/quotes/ComponentSelectionDialog.tsx` | Delete — replaced by shared |
| `components/features/quotes/QuoteItemClusterGrid.tsx` | Update import |
| `components/features/products/AddComponentDialog.tsx` | Delete |
| `components/features/products/AddProductToBOMDialog.tsx` | Delete |
| `components/features/products/product-bom.tsx` | Use shared dialog, single button, BOM-specific onAddComponent handler |

### Business rules

- BOM only accepts inventory items (components, products, supplier-linked parts)
- Non-inventory costs use overheads, not BOM
- Product tab in BOM context shows Apply/Attach mode (existing behavior)
- Product tab in Quote context shows explode/include-labour checkboxes (existing behavior)
