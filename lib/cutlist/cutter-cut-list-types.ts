import type { SheetLayout } from '@/lib/cutlist/types';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';

export interface CutterCutListPdfData {
  orderNumber: string;
  customerName: string;
  generatedAt: string;
  group: CuttingPlanMaterialGroup;
  materialName: string;
  materialColor: string;
  draft?: boolean;
  sheetsRequired: number;
  layouts: SheetLayout[];
  partLabelEntries: Array<[string, string]>;
}
