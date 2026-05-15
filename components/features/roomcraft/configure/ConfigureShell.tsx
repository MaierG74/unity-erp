'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  RoomProvider,
  useRoomContext,
} from '@/components/features/roomcraft/context/RoomContext';
import { FurnitureConfigurator } from '@/components/features/configurator/FurnitureConfigurator';
import type { RoomItem } from '@/components/features/roomcraft/types/room';
import type { CutlistPart } from '@/lib/cutlist/types';
import {
  DEFAULT_CUPBOARD_CONFIG,
  DEFAULT_PEDESTAL_CONFIG,
  DEFAULT_PIGEONHOLE_CONFIG,
} from '@/lib/configurator/templates/types';
import type {
  ConfiguratorConfig,
  ProjectPiece,
  RoomCraftProject,
} from '@/lib/roomcraft/types';
import {
  addPieceToProject,
  canvasStorageKey,
  getProject,
} from '@/lib/roomcraft/project-store';
import { BlockList } from './BlockList';

interface ConfigureShellProps {
  projectId: string;
}

function defaultConfigForItem(item: RoomItem): ConfiguratorConfig {
  const type = item.furnitureType ?? 'cupboard';
  const base =
    type === 'cupboard'
      ? DEFAULT_CUPBOARD_CONFIG
      : type === 'pigeonhole'
        ? DEFAULT_PIGEONHOLE_CONFIG
        : DEFAULT_PEDESTAL_CONFIG;

  return {
    ...base,
    width: item.length,
    depth: item.depth,
    height: item.height,
  };
}

function ConfigureContent({ projectId }: ConfigureShellProps) {
  const { dispatch } = useRoomContext();
  const [project, setProject] = React.useState<RoomCraftProject | null>(null);
  const [selectedItem, setSelectedItem] = React.useState<RoomItem | null>(null);
  const [selectedRoomId, setSelectedRoomId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProject(getProject(projectId));
  }, [projectId]);

  const pieces = project?.pieces ?? [];
  const existingPiece = selectedItem
    ? pieces.find((piece) => piece.blockId === selectedItem.id)
    : undefined;
  const selectedFurnitureType =
    existingPiece?.furnitureType ?? selectedItem?.furnitureType ?? null;

  function handleSelectBlock(item: RoomItem, roomId: string) {
    setSelectedItem(item);
    setSelectedRoomId(roomId);
  }

  function handleSaveSuccess(config: ConfiguratorConfig, parts: CutlistPart[]) {
    if (!selectedItem || !selectedRoomId || !project || !selectedFurnitureType) return;

    const piece: ProjectPiece = {
      id: crypto.randomUUID(),
      blockId: selectedItem.id,
      roomId: selectedRoomId,
      furnitureType: selectedFurnitureType,
      config,
      parts,
      savedAt: new Date().toISOString(),
    };
    const updated = addPieceToProject(projectId, piece);
    setProject(updated);

    dispatch({
      type: 'SET_BLOCK_FURNITURE_TYPE',
      payload: {
        roomId: selectedRoomId,
        id: selectedItem.id,
        furnitureType: selectedFurnitureType,
      },
    });
    dispatch({
      type: 'SET_BLOCK_CONFIGURED_PIECE',
      payload: {
        roomId: selectedRoomId,
        id: selectedItem.id,
        configuredPieceId: piece.id,
      },
    });

    const cfg = config as { width: number; depth: number; height: number };
    const dimensionChanged =
      Math.abs(cfg.width - selectedItem.length) > 1 ||
      Math.abs(cfg.depth - selectedItem.depth) > 1 ||
      Math.abs(cfg.height - selectedItem.height) > 1;

    if (dimensionChanged) {
      dispatch({
        type: 'RESIZE_BLOCK',
        payload: {
          roomId: selectedRoomId,
          id: selectedItem.id,
          length: cfg.width,
          depth: cfg.depth,
          height: cfg.height,
        },
      });
      setSelectedItem({
        ...selectedItem,
        length: cfg.width,
        depth: cfg.depth,
        height: cfg.height,
        furnitureType: selectedFurnitureType,
        configuredPieceId: piece.id,
      });
    } else {
      setSelectedItem({
        ...selectedItem,
        furnitureType: selectedFurnitureType,
        configuredPieceId: piece.id,
      });
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="h-7 w-7">
            <Link href={`/roomcraft/${projectId}`} aria-label="Back to canvas">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <span className="truncate text-sm font-medium">
            {project?.reference ?? 'Configure'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <BlockList
            pieces={pieces}
            selectedBlockId={selectedItem?.id ?? null}
            onSelectBlock={handleSelectBlock}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!selectedItem ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a block from the list to configure it.
          </div>
        ) : !selectedFurnitureType ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Choose a furniture type for this block in the next step.
          </div>
        ) : (
          <FurnitureConfigurator
            key={`${selectedItem.id}:${existingPiece?.id ?? selectedFurnitureType}`}
            initialTemplateId={selectedFurnitureType}
            initialConfig={existingPiece?.config ?? defaultConfigForItem(selectedItem)}
            onSaveSuccess={handleSaveSuccess}
          />
        )}
      </div>
    </div>
  );
}

export function ConfigureShell({ projectId }: ConfigureShellProps) {
  return (
    <RoomProvider storageKey={canvasStorageKey(projectId)}>
      <ConfigureContent projectId={projectId} />
    </RoomProvider>
  );
}
