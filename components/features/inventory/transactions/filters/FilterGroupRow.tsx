'use client';

import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FilterGroup, FilterCondition } from './filter-types';
import { getDefaultOperator, getFieldDef } from './filter-field-defs';
import { FilterConditionRow } from './FilterConditionRow';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

type Props = {
  group: FilterGroup;
  onChange: (updated: FilterGroup) => void;
  onRemove?: () => void;
  options: Record<string, string[]>;
  depth?: number;
};

export function FilterGroupRow({ group, onChange, onRemove, options, depth = 0 }: Props) {
  const addCondition = () => {
    const newCondition: FilterCondition = {
      id: makeId(),
      field: 'component_code',
      operator: getDefaultOperator(getFieldDef('component_code')?.type || 'text'),
      value: null,
    };
    onChange({ ...group, conditions: [...group.conditions, newCondition] });
  };

  const addGroup = () => {
    const newGroup: FilterGroup = {
      id: makeId(),
      conjunction: group.conjunction === 'and' ? 'or' : 'and',
      conditions: [{
        id: makeId(),
        field: 'component_code',
        operator: getDefaultOperator(getFieldDef('component_code')?.type || 'text'),
        value: null,
      }],
      groups: [],
    };
    onChange({ ...group, groups: [...group.groups, newGroup] });
  };

  const updateCondition = (index: number, updated: FilterCondition) => {
    const conditions = [...group.conditions];
    conditions[index] = updated;
    onChange({ ...group, conditions });
  };

  const removeCondition = (index: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) });
  };

  const updateSubGroup = (index: number, updated: FilterGroup) => {
    const groups = [...group.groups];
    groups[index] = updated;
    onChange({ ...group, groups });
  };

  const removeSubGroup = (index: number) => {
    onChange({ ...group, groups: group.groups.filter((_, i) => i !== index) });
  };

  const toggleConjunction = () => {
    onChange({ ...group, conjunction: group.conjunction === 'and' ? 'or' : 'and' });
  };

  return (
    <div className={cn(
      'space-y-1.5',
      depth > 0 && 'ml-4 pl-3 border-l-2 border-primary/20 py-2'
    )}>
      {/* Conditions */}
      {group.conditions.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          {/* Conjunction label */}
          <div className="w-12 shrink-0 text-right">
            {i === 0 && depth === 0 ? (
              <span className="text-xs text-muted-foreground">Where</span>
            ) : i === 0 && depth > 0 ? (
              <span className="text-xs text-muted-foreground">&nbsp;</span>
            ) : (
              <button
                type="button"
                onClick={toggleConjunction}
                className="text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                {group.conjunction}
              </button>
            )}
          </div>
          <FilterConditionRow
            condition={c}
            onChange={(updated) => updateCondition(i, updated)}
            onRemove={() => removeCondition(i)}
            options={options}
          />
        </div>
      ))}

      {/* Nested groups */}
      {group.groups.map((subGroup, i) => (
        <div key={subGroup.id} className="flex items-start gap-2">
          <div className="w-12 shrink-0 text-right pt-1">
            <button
              type="button"
              onClick={toggleConjunction}
              className="text-xs font-medium text-primary hover:underline cursor-pointer"
            >
              {group.conjunction}
            </button>
          </div>
          <div className="flex-1">
            <FilterGroupRow
              group={subGroup}
              onChange={(updated) => updateSubGroup(i, updated)}
              onRemove={() => removeSubGroup(i)}
              options={options}
              depth={depth + 1}
            />
          </div>
        </div>
      ))}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pl-14">
        <Button variant="ghost" size="sm" className="h-6 text-xs text-primary" onClick={addCondition}>
          <Plus className="h-3 w-3 mr-1" />
          Add condition
        </Button>
        {depth === 0 && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={addGroup}>
            <Plus className="h-3 w-3 mr-1" />
            Add condition group
          </Button>
        )}
        {onRemove && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-destructive ml-auto" onClick={onRemove}>
            <Trash2 className="h-3 w-3 mr-1" />
            Remove group
          </Button>
        )}
      </div>
    </div>
  );
}
