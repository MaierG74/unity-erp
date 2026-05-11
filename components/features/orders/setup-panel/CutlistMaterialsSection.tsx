'use client';

import React from 'react';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CutlistMaterialDialog } from '@/components/features/shared/CutlistMaterialDialog';
import { formatCurrency } from '@/lib/format-utils';
import type { CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';

interface CutlistMaterialsSectionProps {
  detail: any;
  applying: boolean;
  onApply: (value: {
    cutlist_primary_material_id: number | null;
    cutlist_primary_backer_material_id: number | null;
    cutlist_primary_edging_id: number | null;
    cutlist_part_overrides: unknown[];
    cutlist_surcharge_kind: 'fixed' | 'percentage';
    cutlist_surcharge_value: number;
    cutlist_surcharge_label: string | null;
  }) => void | Promise<void>;
}

const BOARD_TYPE_LABEL: Record<string, string> = {
  '16mm-single': '16mm Single',
  '32mm-both': '32mm Laminated',
  '32mm-backer': '32mm With Backer',
};

function boardTypeLabel(kind: string): string {
  return BOARD_TYPE_LABEL[kind] ?? kind;
}

function namesFromGroup(group: any): { primary: string | null; backer: string | null; edging: string | null } {
  const firstPart = Array.isArray(group?.parts) ? group.parts[0] : null;
  return {
    primary: firstPart?.effective_board_name ?? group?.primary_material_name ?? null,
    backer: group?.effective_backer_name ?? group?.backer_material_name ?? null,
    edging: firstPart?.effective_edging_name ?? null,
  };
}

export function CutlistMaterialsSection({ detail, applying, onApply }: CutlistMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const groups: CutlistSnapshotGroup[] = Array.isArray(detail?.cutlist_material_snapshot)
    ? detail.cutlist_material_snapshot
    : [];
  const overrideCount = Array.isArray(detail?.cutlist_part_overrides) ? detail.cutlist_part_overrides.length : 0;
  const surcharge = Number(detail?.cutlist_surcharge_resolved ?? 0);

  if (groups.length === 0) {
    return (
      <section className="px-5 py-5 border-b border-border/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Cutlist materials
        </h3>
        <p className="text-sm text-muted-foreground">This product has no cutlist parts.</p>
      </section>
    );
  }

  return (
    <>
      <section className="px-5 py-5 border-b border-border/60">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cutlist materials
          </h3>
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setDialogOpen(true)}>
            <Pencil className="mr-1.5 h-3 w-3" />
            Edit materials
          </Button>
        </div>

        <div className="space-y-3">
          {groups.map((group: any, idx: number) => {
            const partsCount = Array.isArray(group.parts) ? group.parts.length : 0;
            const names = namesFromGroup(group);
            return (
              <div key={`${group.board_type ?? 'group'}-${idx}`} className="text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  {boardTypeLabel(group.board_type)} · {partsCount} part{partsCount === 1 ? '' : 's'}
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  {names.primary ?? 'Primary not set'}
                </p>
                {names.backer && (
                  <p className="text-xs text-muted-foreground">+ Backer: {names.backer}</p>
                )}
                {names.edging && (
                  <p className="text-xs text-muted-foreground">Edging: {names.edging}</p>
                )}
              </div>
            );
          })}
        </div>

        {(overrideCount > 0 || surcharge !== 0) && (
          <div className="mt-4 pt-3 border-t border-border/40 text-xs text-muted-foreground space-y-0.5">
            {overrideCount > 0 && (
              <p>{overrideCount} part override{overrideCount === 1 ? '' : 's'}</p>
            )}
            {surcharge !== 0 && (
              <p>
                {surcharge > 0 ? '+' : '-'}
                {formatCurrency(Math.abs(surcharge))} line surcharge
              </p>
            )}
          </div>
        )}
      </section>

      <CutlistMaterialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        detail={detail}
        applying={applying}
        onApply={async (value) => {
          await onApply(value);
          setDialogOpen(false);
        }}
      />
    </>
  );
}
