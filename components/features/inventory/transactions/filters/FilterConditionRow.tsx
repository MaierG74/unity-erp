'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import type { FilterCondition, FilterOperator } from './filter-types';
import { TRANSACTION_FILTER_FIELDS, getOperatorsForType, getDefaultOperator, getFieldDef } from './filter-field-defs';
import { FilterValueInput } from './FilterValueInput';

type Props = {
  condition: FilterCondition;
  onChange: (updated: FilterCondition) => void;
  onRemove: () => void;
  options: Record<string, string[]>;
};

export function FilterConditionRow({ condition, onChange, onRemove, options }: Props) {
  const fieldDef = getFieldDef(condition.field);
  const operators = fieldDef ? getOperatorsForType(fieldDef.type) : [];
  const fieldOptions = fieldDef?.optionsQueryKey ? options[fieldDef.optionsQueryKey] || [] : [];

  const handleFieldChange = (newField: string) => {
    const newDef = getFieldDef(newField);
    const newOp = newDef ? getDefaultOperator(newDef.type) : 'contains';
    onChange({ ...condition, field: newField, operator: newOp as FilterOperator, value: null });
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Field picker */}
      <Select value={condition.field} onValueChange={handleFieldChange}>
        <SelectTrigger className="h-7 w-[130px] text-xs shrink-0">
          <SelectValue placeholder="Field..." />
        </SelectTrigger>
        <SelectContent>
          {TRANSACTION_FILTER_FIELDS.map((f) => (
            <SelectItem key={f.key} value={f.key} className="text-xs">
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator picker */}
      <Select
        value={condition.operator}
        onValueChange={(op) => onChange({ ...condition, operator: op as FilterOperator, value: null })}
      >
        <SelectTrigger className="h-7 w-[120px] text-xs shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value input */}
      {fieldDef && (
        <FilterValueInput
          fieldDef={fieldDef}
          operator={condition.operator}
          value={condition.value}
          onChange={(v) => onChange({ ...condition, value: v })}
          options={fieldOptions}
        />
      )}

      {/* Remove button */}
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
