'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ComposableFilter, FilterGroup, FilterCondition } from './filter-types';
import { getDefaultOperator } from './filter-field-defs';
import { countConditions } from './filter-engine';
import { FilterGroupRow } from './FilterGroupRow';
import { FilterPills } from './FilterPills';
import { useFilterOptions } from './useFilterOptions';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function createEmptyFilter(): ComposableFilter {
  return {
    version: 2,
    root: {
      id: makeId(),
      conjunction: 'and',
      conditions: [],
      groups: [],
    },
  };
}

function removeConditionFromGroup(group: FilterGroup, condId: string): FilterGroup {
  return {
    ...group,
    conditions: group.conditions.filter((c) => c.id !== condId),
    groups: group.groups.map((g) => removeConditionFromGroup(g, condId)),
  };
}

type Props = {
  composableFilter?: ComposableFilter;
  onApply: (filter: ComposableFilter) => void;
};

export function FilterBuilder({ composableFilter, onApply }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<ComposableFilter>(() => composableFilter || createEmptyFilter());
  const options = useFilterOptions();

  const activeCount = countConditions(composableFilter);

  const handleOpen = () => {
    setDraft(composableFilter || createEmptyFilter());
    setIsOpen(true);
  };

  const handleApply = () => {
    onApply(draft);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setDraft(composableFilter || createEmptyFilter());
    setIsOpen(false);
  };

  const handleClear = () => {
    const empty = createEmptyFilter();
    setDraft(empty);
    onApply(empty);
    setIsOpen(false);
  };

  const handleRemovePill = useCallback((condId: string) => {
    if (!composableFilter) return;
    const updated: ComposableFilter = {
      ...composableFilter,
      root: removeConditionFromGroup(composableFilter.root, condId),
    };
    onApply(updated);
  }, [composableFilter, onApply]);

  const addFirstCondition = () => {
    const newCondition: FilterCondition = {
      id: makeId(),
      field: 'component_code',
      operator: getDefaultOperator('text'),
      value: null,
    };
    setDraft({
      ...draft,
      root: { ...draft.root, conditions: [...draft.root.conditions, newCondition] },
    });
  };

  return (
    <div className="space-y-1.5">
      {/* Filter toggle + pills row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className={cn('h-7 text-xs', isOpen && 'bg-accent')}
          onClick={isOpen ? handleCancel : handleOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
          Filters
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {activeCount}
            </Badge>
          )}
        </Button>

        {/* Active filter pills */}
        {composableFilter && !isOpen && (
          <FilterPills filter={composableFilter} onRemoveCondition={handleRemovePill} />
        )}
      </div>

      {/* Expanded filter builder panel */}
      {isOpen && (
        <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
          <p className="text-xs text-muted-foreground">In this view, show records matching:</p>

          {draft.root.conditions.length === 0 && draft.root.groups.length === 0 ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={addFirstCondition}>
              + Add a filter condition
            </Button>
          ) : (
            <FilterGroupRow
              group={draft.root}
              onChange={(updated) => setDraft({ ...draft, root: updated })}
              options={options}
            />
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <Button size="sm" className="h-7 text-xs" onClick={handleApply}>
              Apply
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancel}>
              Cancel
            </Button>
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground ml-auto" onClick={handleClear}>
                Clear all filters
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
