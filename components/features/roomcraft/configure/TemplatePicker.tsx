'use client';

import { Button } from '@/components/ui/button';
import { getTemplateList } from '@/lib/configurator/templates';
import type { RoomItem } from '@/components/features/roomcraft/types/room';
import type { FurnitureType } from '@/lib/roomcraft/types';

interface TemplatePickerProps {
  item: RoomItem;
  roomId: string;
  onSelect: (furnitureType: FurnitureType) => void;
}

export function TemplatePicker({ item, onSelect }: TemplatePickerProps) {
  const templates = getTemplateList();

  return (
    <div className="max-w-sm space-y-4">
      <div>
        <h2 className="text-sm font-semibold">
          What is &ldquo;{item.label || 'this block'}&rdquo;?
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Choose the furniture type to configure for this block.
        </p>
      </div>
      <div className="space-y-2">
        {templates.map((template) => (
          <Button
            key={template.id}
            variant="outline"
            className="w-full justify-start"
            onClick={() => onSelect(template.id as FurnitureType)}
            type="button"
          >
            {template.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
