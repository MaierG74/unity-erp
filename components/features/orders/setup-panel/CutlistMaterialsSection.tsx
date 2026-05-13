'use client';

import React from 'react';
import { ChevronRight, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CutlistMaterialDialog } from '@/components/features/shared/CutlistMaterialDialog';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
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
  isOpen: boolean;
  onToggle: () => void;
}

const BOARD_TYPE_LABEL: Record<string, string> = {
  '16mm-single': '16mm Single',
  '32mm-both': '32mm Laminated',
  '32mm-backer': '32mm With Backer',
};

function boardTypeLabel(kind: string): string {
  return BOARD_TYPE_LABEL[kind] ?? kind;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function namesFromGroup(group: any): { primary: string[]; backer: string | null; edging: string[] } {
  const parts: any[] = Array.isArray(group?.parts) ? group.parts : [];
  const boardNames = uniqueStrings(parts.map((p) => p?.effective_board_name));
  const edgingNames = uniqueStrings(parts.map((p) => p?.effective_edging_name));

  if (boardNames.length === 0 && typeof group?.primary_material_name === 'string' && group.primary_material_name.trim()) {
    boardNames.push(group.primary_material_name.trim());
  }

  return {
    primary: boardNames,
    backer: group?.effective_backer_name ?? group?.backer_material_name ?? null,
    edging: edgingNames,
  };
}

export function CutlistMaterialsSection({ detail, applying, onApply, isOpen, onToggle }: CutlistMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const groups: CutlistSnapshotGroup[] = Array.isArray(detail?.cutlist_material_snapshot)
    ? detail.cutlist_material_snapshot
    : [];
  const overrideCount = Array.isArray(detail?.cutlist_part_overrides) ? detail.cutlist_part_overrides.length : 0;
  const surcharge = Number(detail?.cutlist_surcharge_resolved ?? 0);

  let pill: React.ReactNode = null;
  if (groups.length > 0) {
    if (overrideCount > 0) {
      pill = <Badge variant="outline" className="h-5 text-[10px]">{overrideCount} override{overrideCount === 1 ? '' : 's'}</Badge>;
    } else {
      const firstPrimary = namesFromGroup(groups[0]).primary[0];
      if (firstPrimary) {
        pill = <Badge variant="outline" className="h-5 text-[10px]">{firstPrimary}</Badge>;
      }
    }
    if (!detail?.cutlist_primary_material_id) {
      pill = <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground/70">Not configured</Badge>;
    }
  }

  return (
    <>
      <section className="border-b border-border/60">
        <header className="flex items-center justify-between gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 flex-1 text-left"
            aria-expanded={isOpen}
            aria-controls="setup-panel-materials-body"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cutlist materials</h3>
            {pill}
          </button>
          {groups.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={(event) => { event.stopPropagation(); setDialogOpen(true); }}
              data-row-action
            >
              <Pencil className="h-3 w-3" />
              Edit materials
            </Button>
          )}
        </header>

        {isOpen && (
          <div id="setup-panel-materials-body" className="px-5 pb-5 space-y-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">This product has no cutlist parts.</p>
            ) : (
              <>
                {groups.map((group: any, idx: number) => {
                  const partsCount = Array.isArray(group.parts) ? group.parts.length : 0;
                  const names = namesFromGroup(group);
                  const primaryLine = names.primary.length === 0 ? 'Primary not set' : names.primary.join(' · ');
                  const edgingLine = names.edging.length === 0 ? null : names.edging.join(' · ');
                  return (
                    <div key={`${group.board_type ?? 'group'}-${idx}`} className="text-sm">
                      <p className="text-xs font-medium text-muted-foreground">
                        {boardTypeLabel(group.board_type)} · {partsCount} part{partsCount === 1 ? '' : 's'}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">{primaryLine}</p>
                      {names.backer && <p className="text-xs text-muted-foreground">+ Backer: {names.backer}</p>}
                      {edgingLine && <p className="text-xs text-muted-foreground">Edging: {edgingLine}</p>}
                    </div>
                  );
                })}
                {(overrideCount > 0 || surcharge !== 0) && (
                  <div className="mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground space-y-0.5">
                    {overrideCount > 0 && <p>{overrideCount} part override{overrideCount === 1 ? '' : 's'}</p>}
                    {surcharge !== 0 && (
                      <p>{surcharge > 0 ? '+' : '-'}{formatCurrency(Math.abs(surcharge))} line surcharge</p>
                    )}
                  </div>
                )}
              </>
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
