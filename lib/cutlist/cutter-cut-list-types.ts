import type { SheetLayout } from '@/lib/cutlist/types';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';

export type CutterCutListRunKind = 'primary' | 'backer';

export interface CutterCutListPdfData {
  orderNumber: string;
  customerName: string;
  generatedAt: string;
  group: CuttingPlanMaterialGroup;
  runKind: CutterCutListRunKind;
  materialName: string;
  materialColor: string;
  sheetsRequired: number;
  layouts: SheetLayout[];
  partLabelEntries: Array<[string, string]>;
}
