'use client';

import { useState } from 'react';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';
import type { LayoutResult, StockSheetSpec } from '@/lib/cutlist/types';

import dynamic from 'next/dynamic';
const SheetLayoutGrid = dynamic(
  () =>
    import('@/components/features/cutlist/primitives/SheetLayoutGrid').then(
      (m) => m.SheetLayoutGrid
    ),
  { ssr: false }
);

interface CuttingPlanViewerProps {
  materialGroups: CuttingPlanMaterialGroup[];
  onClose: () => void;
}

export default function CuttingPlanViewer({
  materialGroups,
  onClose,
}: CuttingPlanViewerProps) {
  const [selectedGroupIdx, setSelectedGroupIdx] = useState(0);
  const group = materialGroups[selectedGroupIdx];

  if (!group) return null;

  const result: LayoutResult = {
    sheets: group.layouts,
    stats: {
      used_area_mm2: 0,
      waste_area_mm2: 0,
      cuts: 0,
      cut_length_mm: 0,
    },
  };

  const stockSheet: StockSheetSpec = {
    id: 'stock',
    length_mm: group.stock_sheet_spec.length_mm,
    width_mm: group.stock_sheet_spec.width_mm,
    qty: group.sheets_required,
  };

  return (
    <div className="space-y-4">
      {materialGroups.length > 1 && (
        <div className="flex gap-2">
          {materialGroups.map((mg, i) => (
            <button
              key={`${mg.kind}-${mg.material_id}-${mg.sheet_thickness_mm}`}
              onClick={() => setSelectedGroupIdx(i)}
              className={`px-3 py-1.5 rounded-sm text-sm ${
                i === selectedGroupIdx
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {mg.material_name} {mg.sheet_thickness_mm}mm{mg.kind === 'backer' ? ' Backer' : ''} ({mg.sheets_required} sheets)
            </button>
          ))}
        </div>
      )}

      <SheetLayoutGrid
        result={result}
        stockSheet={stockSheet}
        globalFullBoard={false}
        onGlobalFullBoardChange={() => {}}
        sheetOverrides={{}}
        onSheetOverridesChange={() => {}}
      />

      <button
        onClick={onClose}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to summary
      </button>
    </div>
  );
}
