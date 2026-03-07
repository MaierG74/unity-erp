import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';
import type { QuoteCutlistLayoutV2 } from '@/components/features/cutlist/adapters';
import type { CutlistLineRefs } from '@/lib/cutlist/types';
import type { EffectiveBomSeedRow } from '@/lib/cutlist/effectiveBomSeed';

export type CutlistCalculatorInitialData = Partial<CutlistCalculatorData>;

export function quoteLayoutToInitialData(layout: QuoteCutlistLayoutV2): CutlistCalculatorInitialData {
  return {
    parts: layout.parts,
    primaryBoards: layout.primaryBoards,
    backerBoards: layout.backerBoards,
    edging: layout.edging,
    kerf: layout.kerf,
    optimizationPriority: layout.optimizationPriority,
    sheetOverrides: layout.sheetOverrides,
    globalFullBoard: layout.globalFullBoard,
    backerSheetOverrides: layout.backerSheetOverrides,
    backerGlobalFullBoard: layout.backerGlobalFullBoard,
  };
}

export function cutlistDataToQuoteLayout(
  data: CutlistCalculatorData,
  lineRefs?: CutlistLineRefs
): QuoteCutlistLayoutV2 {
  return {
    version: 2,
    parts: data.parts,
    primaryBoards: data.primaryBoards,
    backerBoards: data.backerBoards,
    edging: data.edging,
    kerf: data.kerf,
    optimizationPriority: data.optimizationPriority,
    sheetOverrides: data.sheetOverrides,
    globalFullBoard: data.globalFullBoard,
    backerSheetOverrides: data.backerSheetOverrides,
    backerGlobalFullBoard: data.backerGlobalFullBoard,
    lineRefs,
  };
}

export function effectiveBomItemsToSeedRows(items: Record<string, unknown>[]): EffectiveBomSeedRow[] {
  return items
    .filter((item) => {
      const dimensions = item.cutlist_dimensions;
      return Boolean(dimensions && typeof dimensions === 'object');
    })
    .map((item, index) => {
      const dimensions = item.cutlist_dimensions as EffectiveBomSeedRow['dimensions'];
      const quantityRequired = Number(item.quantity_required ?? 0) || 0;
      const quantityPer = Number(dimensions?.quantity_per ?? 1) || 1;

      return {
        key:
          typeof item.bom_id === 'number'
            ? `bom:${item.bom_id}`
            : `computed:${String(item.component_id ?? 'part')}:${index}`,
        componentId: Number(item.component_id ?? 0),
        componentDescription:
          typeof item.component_description === 'string' ? item.component_description : null,
        dimensions,
        totalParts: quantityRequired * quantityPer,
      };
    });
}
