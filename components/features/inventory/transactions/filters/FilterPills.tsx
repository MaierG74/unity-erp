'use client';

import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import type { ComposableFilter, FilterCondition, FilterGroup } from './filter-types';
import { getFieldDef, getOperatorLabel, operatorNeedsValue } from './filter-field-defs';

type Props = {
  filter: ComposableFilter;
  onRemoveCondition: (conditionId: string) => void;
};

function flattenConditions(group: FilterGroup): FilterCondition[] {
  return [
    ...group.conditions,
    ...group.groups.flatMap((g) => flattenConditions(g)),
  ];
}

function formatConditionLabel(c: FilterCondition): string {
  const field = getFieldDef(c.field);
  const fieldLabel = field?.label || c.field;
  const opLabel = getOperatorLabel(c.operator);

  if (!operatorNeedsValue(c.operator)) {
    return `${fieldLabel} ${opLabel}`;
  }

  const valueStr = Array.isArray(c.value)
    ? c.value.join(', ')
    : c.value != null ? String(c.value) : '';

  return `${fieldLabel} ${opLabel} ${valueStr}`;
}

export function FilterPills({ filter, onRemoveCondition }: Props) {
  const conditions = flattenConditions(filter.root);
  if (conditions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {conditions.map((c) => (
        <Badge
          key={c.id}
          variant="secondary"
          className="gap-1 pr-1 cursor-pointer hover:bg-destructive/10 text-[10px] h-5"
          onClick={() => onRemoveCondition(c.id)}
        >
          <span className="max-w-[200px] truncate">{formatConditionLabel(c)}</span>
          <X className="h-2.5 w-2.5 shrink-0" />
        </Badge>
      ))}
    </div>
  );
}
