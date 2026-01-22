'use client';

import { memo, DragEvent, useState } from 'react';
import { Trash2, ChevronDown, Package, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { PartCard } from './PartCard';
import {
  type CutlistGroup,
  type CutlistPart,
  type BoardType,
  getBoardTypeLabel,
  getBoardTypeDescription,
} from '@/lib/cutlist/boardCalculator';

interface MaterialOption {
  id: string;
  code: string;
  description: string | null;
}

interface GroupCardProps {
  group: CutlistGroup;
  materials: MaterialOption[];
  onNameChange: (name: string) => void;
  onBoardTypeChange: (boardType: BoardType) => void;
  onPrimaryMaterialChange: (materialId: string | undefined, materialName: string | undefined) => void;
  onBackerMaterialChange: (materialId: string | undefined, materialName: string | undefined) => void;
  onRemovePart: (partId: string) => void;
  onDeleteGroup: () => void;
  onDropPart: (partId: string) => void;
  className?: string;
}

/**
 * Group card with drop zone for the Cutlist Builder.
 * Shows group name, board type selector, material pickers, and parts list.
 */
export const GroupCard = memo(function GroupCard({
  group,
  materials,
  onNameChange,
  onBoardTypeChange,
  onPrimaryMaterialChange,
  onBackerMaterialChange,
  onRemovePart,
  onDeleteGroup,
  onDropPart,
  className,
}: GroupCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [backerOpen, setBackerOpen] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const partId = e.dataTransfer.getData('text/plain');
    if (partId) {
      onDropPart(partId);
    }
  };

  const showBackerMaterial = group.boardType === '32mm-backer';

  const selectedPrimaryMaterial = materials.find((m) => m.id === group.primaryMaterialId);
  const selectedBackerMaterial = materials.find((m) => m.id === group.backerMaterialId);

  return (
    <div
      className={cn(
        'border rounded-lg bg-card p-3 space-y-3',
        isDragOver && 'ring-2 ring-primary border-primary',
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header: Name + Delete */}
      <div className="flex items-center gap-2">
        <Input
          value={group.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Group name..."
          className="h-8 text-sm font-medium"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDeleteGroup}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Board Type Selector */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Board Type</Label>
        <Select
          value={group.boardType}
          onValueChange={(value) => onBoardTypeChange(value as BoardType)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['16mm', '32mm-both', '32mm-backer'] as BoardType[]).map((type) => (
              <SelectItem key={type} value={type}>
                <div className="flex flex-col">
                  <span>{getBoardTypeLabel(type)}</span>
                  <span className="text-xs text-muted-foreground">
                    {getBoardTypeDescription(type)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Primary Material Picker */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <Package className="h-3 w-3" />
          Primary Material
        </Label>
        <Popover open={primaryOpen} onOpenChange={setPrimaryOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={primaryOpen}
              className="w-full h-8 justify-between text-sm"
            >
              <span className="truncate">
                {selectedPrimaryMaterial
                  ? `${selectedPrimaryMaterial.code}${selectedPrimaryMaterial.description ? ` - ${selectedPrimaryMaterial.description}` : ''}`
                  : 'Select material...'}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search materials..." />
              <CommandList className="max-h-[200px]">
                <CommandEmpty>No material found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="no-material-none"
                    onSelect={() => {
                      onPrimaryMaterialChange(undefined, undefined);
                      setPrimaryOpen(false);
                    }}
                  >
                    <span className="text-muted-foreground">No material</span>
                  </CommandItem>
                  {materials.map((material) => (
                    <CommandItem
                      key={material.id}
                      value={`${material.code} ${material.description || ''}`}
                      onSelect={() => {
                        onPrimaryMaterialChange(
                          material.id,
                          `${material.code}${material.description ? ` - ${material.description}` : ''}`
                        );
                        setPrimaryOpen(false);
                      }}
                    >
                      <span className="font-medium">{material.code}</span>
                      {material.description && (
                        <span className="ml-2 text-muted-foreground truncate">
                          {material.description}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Backer Material Picker (only for 32mm-backer) */}
      {showBackerMaterial && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Backer Material
          </Label>
          <Popover open={backerOpen} onOpenChange={setBackerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={backerOpen}
                className="w-full h-8 justify-between text-sm"
              >
                <span className="truncate">
                  {selectedBackerMaterial
                    ? `${selectedBackerMaterial.code}${selectedBackerMaterial.description ? ` - ${selectedBackerMaterial.description}` : ''}`
                    : 'Select backer material...'}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search materials..." />
                <CommandList className="max-h-[200px]">
                  <CommandEmpty>No material found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="same-as-primary-backer"
                      onSelect={() => {
                        onBackerMaterialChange(undefined, undefined);
                        setBackerOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">Same as primary</span>
                    </CommandItem>
                    {materials.map((material) => (
                      <CommandItem
                        key={material.id}
                        value={`${material.code} ${material.description || ''}`}
                        onSelect={() => {
                          onBackerMaterialChange(
                            material.id,
                            `${material.code}${material.description ? ` - ${material.description}` : ''}`
                          );
                          setBackerOpen(false);
                        }}
                      >
                        <span className="font-medium">{material.code}</span>
                        {material.description && (
                          <span className="ml-2 text-muted-foreground truncate">
                            {material.description}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Parts List */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Parts ({group.parts.length})
        </Label>
        <div className="space-y-1.5 min-h-[60px]">
          {group.parts.length === 0 ? (
            <div
              className={cn(
                'border-2 border-dashed rounded-md p-4 text-center text-sm text-muted-foreground',
                isDragOver ? 'border-primary bg-primary/5' : 'border-muted'
              )}
            >
              Drop parts here...
            </div>
          ) : (
            group.parts.map((part) => (
              <PartCard
                key={part.id}
                part={part}
                showRemove
                onRemove={() => onRemovePart(part.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export default GroupCard;
