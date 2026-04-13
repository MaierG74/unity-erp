'use client';

import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { BoardComponent } from '@/hooks/useBoardComponents';
import { filterByBoardType } from '@/hooks/useBoardComponents';

interface BoardMaterialComboboxProps {
  boards: BoardComponent[];
  /** When set, filters boards to matching thickness. When null, shows all boards (for backers). */
  boardType: string | null;
  value: number | null;
  onChange: (componentId: number, componentName: string) => void;
  placeholder?: string;
  className?: string;
}

export default function BoardMaterialCombobox({
  boards,
  boardType,
  value,
  onChange,
  placeholder = 'Select material…',
  className,
}: BoardMaterialComboboxProps) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => (boardType ? filterByBoardType(boards, boardType) : boards),
    [boards, boardType],
  );

  const selected = filtered.find((b) => b.component_id === value);
  const label = selected ? selected.description || selected.internal_code : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'justify-between font-normal',
            !label && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search boards…" />
          <CommandList>
            <CommandEmpty>No boards found.</CommandEmpty>
            {filtered.map((board) => (
              <CommandItem
                key={board.component_id}
                value={`${board.internal_code} ${board.description}`}
                onSelect={() => {
                  onChange(board.component_id, board.description || board.internal_code);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-3 w-3',
                    value === board.component_id ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div className="flex flex-col">
                  <span className="text-sm">{board.description || board.internal_code}</span>
                  {board.description && board.internal_code && (
                    <span className="text-xs text-muted-foreground">{board.internal_code}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
