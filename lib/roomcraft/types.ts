import type { CupboardConfig, PigeonholeConfig, PedestalConfig } from '@/lib/configurator/templates/types';
import type { CutlistPart } from '@/lib/cutlist/types';

export type FurnitureType = 'cupboard' | 'pigeonhole' | 'pedestal';

export type ConfiguratorConfig = CupboardConfig | PigeonholeConfig | PedestalConfig;

export type ProjectStatus = 'draft' | 'configuring' | 'ready' | 'converted';

export interface ProjectPiece {
  id: string;
  blockId: string;
  roomId: string;
  furnitureType: FurnitureType;
  config: ConfiguratorConfig;
  parts: CutlistPart[];
  savedAt: string; // ISO 8601
}

export interface RoomCraftProject {
  id: string;
  customerId: number;
  customerName: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  pieces: ProjectPiece[];
}

export function deriveProjectStatus(
  project: RoomCraftProject,
  allBlockIds: string[],
): ProjectStatus {
  if (project.pieces.length === 0) return 'draft';
  const configuredIds = new Set(project.pieces.map((p) => p.blockId));
  const allConfigured =
    allBlockIds.length > 0 && allBlockIds.every((id) => configuredIds.has(id));
  return allConfigured ? 'ready' : 'configuring';
}
