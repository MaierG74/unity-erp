'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Check, X, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FilterFieldDef, FilterOperator } from './filter-types';
import { operatorNeedsValue, operatorIsMulti } from './filter-field-defs';

type Props = {
  fieldDef: FilterFieldDef;
  operator: FilterOperator;
  value: string | string[] | number | null;
  onChange: (value: string | string[] | number | null) => void;
  options?: string[];
};

export function FilterValueInput({ fieldDef, operator, value, onChange, options = [] }: Props) {
  if (!operatorNeedsValue(operator)) return null;

  if (fieldDef.type === 'numeric') {
    return (
      <Input
        type="number"
        className="h-7 w-24 text-xs"
        value={value ?? ''}
        placeholder="0"
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }

  if (fieldDef.type === 'select') {
    if (operatorIsMulti(operator)) {
      return <MultiSelectValue value={Array.isArray(value) ? value : []} onChange={onChange} options={options} />;
    }
    return <SingleSelectValue value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(v)} options={options} />;
  }

  // Text input
  return (
    <Input
      type="text"
      className="h-7 w-36 text-xs"
      value={typeof value === 'string' ? value : ''}
      placeholder="Value..."
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SingleSelectValue({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-40 justify-between text-xs font-normal">
          <span className="truncate">{value || 'Select...'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." className="h-8" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup className="max-h-[180px] overflow-auto">
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => { onChange(opt); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-3 w-3', value === opt ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-xs">{opt}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectValue({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((v) => (
        <Badge key={v} variant="secondary" className="text-[10px] gap-0.5 pr-0.5 h-5">
          {v}
          <button type="button" onClick={() => toggle(v)} className="ml-0.5 hover:bg-muted rounded-sm">
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2">
            + Add
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search..." className="h-8" />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup className="max-h-[180px] overflow-auto">
                {options.map((opt) => (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                    <Check className={cn('mr-2 h-3 w-3', value.includes(opt) ? 'opacity-100' : 'opacity-0')} />
                    <span className="text-xs">{opt}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
