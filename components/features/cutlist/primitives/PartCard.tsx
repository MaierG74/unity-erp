'use client';

import { memo, DragEvent, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { CutlistPart } from '@/lib/cutlist/types';

interface PartCardProps {
  part: CutlistPart;
  onRemove?: () => void;
  showRemove?: boolean;
  className?: string;
}

/**
 * Draggable part card for the Cutlist Builder.
 * Shows part name, dimensions, quantity, and edge banding indicators.
 * Features kanban-style drag effects with visual feedback.
 */
export const PartCard = memo(function PartCard({
  part,
  onRemove,
  showRemove = false,
  className,
}: PartCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', part.id);
    e.dataTransfer.effectAllowed = 'move';
    // Small delay so browser captures drag image before visual changes
    setTimeout(() => setIsDragging(true), 0);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Edge indicators: filled circle = has banding, empty circle = no banding
  const EdgeIndicator = ({
    active,
    label,
  }: {
    active: boolean;
    label: string;
  }) => (
    <span
      className={cn(
        'w-3 h-3 rounded-full border text-[8px] flex items-center justify-center font-medium',
        active
          ? 'bg-primary border-primary text-primary-foreground'
          : 'border-muted-foreground/30 text-muted-foreground/50'
      )}
      title={`${label}: ${active ? 'Has edging' : 'No edging'}`}
    >
      {label[0]}
    </span>
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={cn(
        'group flex items-center gap-2 p-2 bg-card border rounded-md cursor-grab active:cursor-grabbing',
        'select-none',
        'transition-all duration-200 ease-out',
        // Hover lift effect to indicate draggable
        'hover:bg-accent/50 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/50',
        // Kanban-style drag effects - card left behind becomes ghost
        isDragging && [
          'opacity-40',
          'border-dashed',
          'border-primary',
          'bg-primary/10',
          'shadow-inner',
          'scale-[0.98]',
        ],
        className
      )}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate" title={part.name}>
            {part.name || 'Unnamed Part'}
          </span>
          <span className="text-xs text-muted-foreground">×{part.quantity}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground">
            {part.length_mm} × {part.width_mm}
          </span>
          {part.material_label && (
            <span className="text-xs text-muted-foreground truncate" title={part.material_label}>
              {part.material_label}
            </span>
          )}
        </div>
      </div>

      {/* Edge banding indicators */}
      <div className="flex items-center gap-0.5 flex-shrink-0" title="Edge banding (T R B L)">
        <EdgeIndicator active={part.band_edges.top} label="T" />
        <EdgeIndicator active={part.band_edges.right} label="R" />
        <EdgeIndicator active={part.band_edges.bottom} label="B" />
        <EdgeIndicator active={part.band_edges.left} label="L" />
      </div>

      {showRemove && onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
});

export default PartCard;
