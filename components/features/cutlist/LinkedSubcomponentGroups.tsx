'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronDown, ExternalLink } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { LinkedCutlistGroup } from '@/lib/cutlist/linkedCutlistGroups';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { cutPieceCountFromQuantity, isFinishedQtyModel } from '@/lib/cutlist/quantityModel';

interface LinkedSubcomponentGroupsProps {
  linkedGroups: LinkedCutlistGroup[];
  className?: string;
}

type SubcomponentBlock = {
  subProductId: number;
  subProductName: string;
  scale: number;
  groups: LinkedCutlistGroup[];
  partCount: number;
};

/**
 * Read-only listing of cutlist groups contributed by linked subcomponents.
 * Quantities shown are the child's own quantities; the link scale is applied
 * downstream (order snapshots) — surfaced here as the "×n" annotation.
 */
export function LinkedSubcomponentGroups({ linkedGroups, className }: LinkedSubcomponentGroupsProps) {
  const { cutlistDefaults } = useOrgSettings();
  const sameBoardFinishedQuantityModel = isFinishedQtyModel(cutlistDefaults);
  const blocks = useMemo<SubcomponentBlock[]>(() => {
    const bySub = new Map<number, SubcomponentBlock>();
    for (const group of linkedGroups) {
      let block = bySub.get(group.source_sub_product_id);
      if (!block) {
        block = {
          subProductId: group.source_sub_product_id,
          subProductName: group.source_sub_product_name,
          scale: group.link_scale,
          groups: [],
          partCount: 0,
        };
        bySub.set(group.source_sub_product_id, block);
      }
      block.groups.push(group);
      block.partCount += (group.parts ?? []).reduce(
        (sum, part) => sum + cutPieceCountFromQuantity(
          {
            qty: Number(part.quantity) || 0,
            lamination_type: part.lamination_type,
            lamination_group: part.lamination_group,
          },
          { finishedModel: sameBoardFinishedQuantityModel },
        ),
        0
      );
    }
    return Array.from(bySub.values());
  }, [linkedGroups, sameBoardFinishedQuantityModel]);

  if (blocks.length === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Subcomponents
        </h3>
        <p className="text-xs text-muted-foreground/80">
          Parts contributed by linked subcomponents. They use the subcomponent&apos;s own
          materials and are included automatically on orders — edit them on the subcomponent.
        </p>
        {blocks.map((block) => (
          <Collapsible key={block.subProductId}>
            <div className="rounded-sm border border-border/60 bg-muted/30">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  <span className="truncate text-sm text-foreground/90">
                    {block.subProductName} ×{block.scale}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {block.groups.length} group{block.groups.length === 1 ? '' : 's'},{' '}
                    {block.partCount} piece{block.partCount === 1 ? '' : 's'}
                    {block.scale !== 1
                      ? ` (×${block.scale} = ${Math.round(block.partCount * block.scale)})`
                      : ''}
                  </span>
                </CollapsibleTrigger>
                <Link
                  href={`/products/${block.subProductId}`}
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Edit in {block.subProductName}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <CollapsibleContent>
                <div className="space-y-1.5 border-t border-border/60 px-3 py-2">
                  {block.groups.map((group) => (
                    <div key={group.id} className="text-xs text-muted-foreground">
                      <span className="text-foreground/80">{group.name}</span>
                      {' — '}
                      {(group.parts ?? [])
                        .map((part) => {
                          const physicalQty = cutPieceCountFromQuantity(
                            {
                              qty: Number(part.quantity) || 0,
                              lamination_type: part.lamination_type,
                              lamination_group: part.lamination_group,
                            },
                            { finishedModel: sameBoardFinishedQuantityModel },
                          );
                          return `${part.name} ${part.length_mm}×${part.width_mm} ×${physicalQty}`;
                        })
                        .join(', ') || 'No parts'}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}

export default LinkedSubcomponentGroups;
