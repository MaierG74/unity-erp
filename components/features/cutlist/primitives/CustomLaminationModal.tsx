'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Import centralized types
import type {
  LaminationLayer,
  CustomLaminationConfig,
} from '@/lib/cutlist/types';

// Re-export types for convenience
export type { LaminationLayer };

/**
 * LaminationConfig is an alias for CustomLaminationConfig.
 * Kept for backward compatibility with components using this modal.
 */
export type LaminationConfig = CustomLaminationConfig;

export interface BoardOption {
  id: string;
  name: string;
}

export interface CustomLaminationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryBoards: BoardOption[];
  backerBoards: BoardOption[];
  initialConfig?: LaminationConfig;
  onConfirm: (config: LaminationConfig) => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const LAYER_THICKNESS_MM = 16;
const MIN_LAYERS = 3;
const MAX_LAYERS = 10;

// ──────────────────────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────────────────────

function getLayerLabel(index: number, totalLayers: number): string {
  if (index === 0) return 'Top';
  if (index === totalLayers - 1) return 'Bottom';
  return 'Middle';
}

function createDefaultLayers(
  layerCount: number,
  primaryBoards: BoardOption[],
  backerBoards: BoardOption[]
): LaminationLayer[] {
  const defaultPrimary = primaryBoards[0];
  const defaultBacker = backerBoards[0];

  return Array.from({ length: layerCount }, (_, index) => {
    // Top and bottom layers are primary, middle layers are backer
    const isOuterLayer = index === 0 || index === layerCount - 1;

    if (isOuterLayer && defaultPrimary) {
      return {
        materialId: defaultPrimary.id,
        materialName: defaultPrimary.name,
        isPrimary: true,
      };
    }

    if (defaultBacker) {
      return {
        materialId: defaultBacker.id,
        materialName: defaultBacker.name,
        isPrimary: false,
      };
    }

    // Fallback if no boards available
    return {
      materialId: '',
      materialName: 'No material',
      isPrimary: isOuterLayer,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export function CustomLaminationModal({
  open,
  onOpenChange,
  primaryBoards,
  backerBoards,
  initialConfig,
  onConfirm,
}: CustomLaminationModalProps) {
  // State for layers
  const [layers, setLayers] = React.useState<LaminationLayer[]>(() => {
    if (initialConfig?.layers && initialConfig.layers.length >= MIN_LAYERS) {
      return initialConfig.layers;
    }
    return createDefaultLayers(MIN_LAYERS, primaryBoards, backerBoards);
  });

  // Reset layers when modal opens with new initial config
  React.useEffect(() => {
    if (open) {
      if (initialConfig?.layers && initialConfig.layers.length >= MIN_LAYERS) {
        setLayers(initialConfig.layers);
      } else {
        setLayers(createDefaultLayers(MIN_LAYERS, primaryBoards, backerBoards));
      }
    }
  }, [open, initialConfig, primaryBoards, backerBoards]);

  // Combine all boards for dropdown
  const allBoards = React.useMemo(() => {
    const combined: Array<BoardOption & { isPrimary: boolean }> = [
      ...primaryBoards.map((b) => ({ ...b, isPrimary: true })),
      ...backerBoards.map((b) => ({ ...b, isPrimary: false })),
    ];
    return combined;
  }, [primaryBoards, backerBoards]);

  // Calculate thicknesses
  const finalThickness = layers.length * LAYER_THICKNESS_MM;
  const edgeThickness = finalThickness;

  // Handlers
  const handleLayerCountChange = (delta: number) => {
    const newCount = Math.min(MAX_LAYERS, Math.max(MIN_LAYERS, layers.length + delta));
    if (newCount === layers.length) return;

    if (newCount > layers.length) {
      // Adding layers - insert in the middle
      const newLayers = [...layers];
      const insertIndex = Math.floor(layers.length / 2);
      const defaultBacker = backerBoards[0];

      for (let i = 0; i < newCount - layers.length; i++) {
        const newLayer: LaminationLayer = defaultBacker
          ? {
              materialId: defaultBacker.id,
              materialName: defaultBacker.name,
              isPrimary: false,
            }
          : {
              materialId: '',
              materialName: 'No material',
              isPrimary: false,
            };
        newLayers.splice(insertIndex, 0, newLayer);
      }
      setLayers(newLayers);
    } else {
      // Removing layers - remove from the middle
      const newLayers = [...layers];
      const removeIndex = Math.floor(layers.length / 2);
      newLayers.splice(removeIndex, layers.length - newCount);
      setLayers(newLayers);
    }
  };

  const handleLayerMaterialChange = (layerIndex: number, materialId: string) => {
    const board = allBoards.find((b) => b.id === materialId);
    if (!board) return;

    setLayers((prev) =>
      prev.map((layer, idx) =>
        idx === layerIndex
          ? {
              materialId: board.id,
              materialName: board.name,
              isPrimary: board.isPrimary,
            }
          : layer
      )
    );
  };

  const handleConfirm = () => {
    const config: LaminationConfig = {
      layers,
      finalThickness,
      edgeThickness,
    };
    onConfirm(config);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Custom Lamination</DialogTitle>
          <DialogDescription>
            Configure multi-layer lamination for thick panels (48mm+).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Layer count selector */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Number of layers:</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleLayerCountChange(-1)}
                disabled={layers.length <= MIN_LAYERS}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-8 text-center text-sm font-medium tabular-nums">
                {layers.length}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleLayerCountChange(1)}
                disabled={layers.length >= MAX_LAYERS}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Layer configuration */}
          <div className="rounded-md border p-3 space-y-3">
            {layers.map((layer, index) => (
              <div key={index} className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-28 shrink-0">
                  Layer {index + 1} ({getLayerLabel(index, layers.length)}):
                </span>
                <Select
                  value={layer.materialId}
                  onValueChange={(value) => handleLayerMaterialChange(index, value)}
                >
                  <SelectTrigger className="flex-1 h-9">
                    <SelectValue placeholder="Select material" />
                  </SelectTrigger>
                  <SelectContent>
                    {primaryBoards.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          Primary Boards
                        </div>
                        {primaryBoards.map((board) => (
                          <SelectItem key={`primary-${board.id}`} value={board.id}>
                            {board.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {backerBoards.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          Backer Boards
                        </div>
                        {backerBoards.map((board) => (
                          <SelectItem key={`backer-${board.id}`} value={board.id}>
                            {board.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          {/* Thickness summary */}
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Final thickness:</span>
              <span className="font-medium">{finalThickness}mm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Edge thickness:</span>
              <span className="font-medium">{edgeThickness}mm</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={allBoards.length === 0}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CustomLaminationModal;
