'use client';

import { Button } from '@/components/ui/button';
import { Pencil } from 'lucide-react';
import type { CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { cutPieceCountFromQuantity, isFinishedQtyModel } from '@/lib/cutlist/quantityModel';

type CutlistSnapshotSummaryProps = {
  groups: CutlistSnapshotGroup[];
  onEdit: () => void;
};

export function CutlistSnapshotSummary({ groups, onEdit }: CutlistSnapshotSummaryProps) {
  const { cutlistDefaults } = useOrgSettings();
  const sameBoardFinishedQuantityModel = isFinishedQtyModel(cutlistDefaults);

  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 flex-1">
          {groups.map(group => {
            const totalParts = group.parts.reduce((sum, p) => sum + cutPieceCountFromQuantity(
              {
                qty: p.quantity,
                lamination_type: p.lamination_type,
              },
              { finishedModel: sameBoardFinishedQuantityModel },
            ), 0);
            const materialName = group.primary_material_name ?? group.board_type;
            return (
              <p key={group.source_group_id} className="text-sm text-muted-foreground">
                {group.name} — {totalParts} cut pieces, {materialName}
              </p>
            );
          })}
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={onEdit}>
          <Pencil className="h-3 w-3 mr-1" />
          Edit
        </Button>
      </div>
    </div>
  );
}
