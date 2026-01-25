'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
// Note: Using native radio inputs instead of RadioGroup to maintain valid table HTML structure
import { Label } from '@/components/ui/label';
import { Trash2, Plus, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a board material (primary or backer).
 */
export interface BoardMaterial {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  cost: number;
  isDefault: boolean;
  isPinned?: boolean; // If true, persists across sessions
  component_id?: number;
}

/**
 * Represents an edging material with thickness variants.
 */
export interface EdgingMaterial {
  id: string;
  name: string;
  thickness_mm: number; // 16, 32, 48
  width_mm: number; // 1, 2, etc
  cost_per_meter: number;
  isDefaultForThickness: boolean;
  isPinned?: boolean; // If true, persists across sessions
  component_id?: number;
}

/**
 * Props for the MaterialsPanel component.
 */
export interface MaterialsPanelProps {
  primaryBoards: BoardMaterial[];
  backerBoards: BoardMaterial[];
  edging: EdgingMaterial[];
  kerf: number;
  onPrimaryBoardsChange: (boards: BoardMaterial[]) => void;
  onBackerBoardsChange: (boards: BoardMaterial[]) => void;
  onEdgingChange: (edging: EdgingMaterial[]) => void;
  onKerfChange: (kerf: number) => void;
  onAddPrimaryBoard: () => void;
  onAddBackerBoard: () => void;
  onAddEdging: () => void;
  className?: string;
}

// =============================================================================
// Section Header Component
// =============================================================================

interface SectionHeaderProps {
  title: string;
  onAdd: () => void;
  addLabel?: string;
}

function SectionHeader({ title, onAdd, addLabel = 'Add' }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between bg-muted/30 px-3 py-2 rounded-t-lg border-b">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAdd}
        className="h-7 gap-1 text-xs"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </Button>
    </div>
  );
}

// =============================================================================
// Board Table Component
// =============================================================================

interface BoardTableProps {
  boards: BoardMaterial[];
  onBoardsChange: (boards: BoardMaterial[]) => void;
  onAdd: () => void;
  title: string;
}

function BoardTable({ boards, onBoardsChange, onAdd, title }: BoardTableProps) {
  const updateBoard = (id: string, updates: Partial<BoardMaterial>) => {
    onBoardsChange(
      boards.map((board) => (board.id === id ? { ...board, ...updates } : board))
    );
  };

  const deleteBoard = (id: string) => {
    const remaining = boards.filter((board) => board.id !== id);
    // If we deleted the default, make the first remaining board the default
    if (remaining.length > 0 && !remaining.some((b) => b.isDefault)) {
      remaining[0].isDefault = true;
    }
    onBoardsChange(remaining);
  };

  const setDefault = (id: string) => {
    onBoardsChange(
      boards.map((board) => ({
        ...board,
        isDefault: board.id === id,
      }))
    );
  };

  const defaultId = boards.find((b) => b.isDefault)?.id ?? boards[0]?.id ?? '';

  return (
    <div className="rounded-lg border bg-card/40 overflow-hidden">
      <SectionHeader title={title} onAdd={onAdd} />
      {boards.length === 0 ? (
        <div className="px-4 py-3 text-center text-sm text-muted-foreground">
          No boards added. Click + Add to select from inventory.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="h-10">
              <TableHead className="h-10 px-2 text-xs w-[40px]"></TableHead>
              <TableHead className="h-10 px-3 text-xs">Name</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[140px]">Size (L x W mm)</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[110px]">Cost/Sheet</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[70px] text-center">Default</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {boards.map((board) => (
              <TableRow key={board.id} className={cn('h-10', !board.isPinned && 'bg-muted/20')}>
                <TableCell className="px-2 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => updateBoard(board.id, { isPinned: !board.isPinned })}
                    className={cn(
                      'h-7 w-7',
                      board.isPinned
                        ? 'text-primary hover:text-primary/80'
                        : 'text-muted-foreground/50 hover:text-muted-foreground'
                    )}
                    aria-label={board.isPinned ? 'Unpin (remove from defaults)' : 'Pin (save to defaults)'}
                    title={board.isPinned ? 'Pinned - click to unpin' : 'Click to pin as default'}
                  >
                    {board.isPinned ? (
                      <Pin className="h-3.5 w-3.5" />
                    ) : (
                      <PinOff className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TableCell>
                <TableCell className="px-3 py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{board.name}</span>
                    {board.component_id && (
                      <span className="text-xs text-muted-foreground">
                        #{board.component_id}
                      </span>
                    )}
                    {!board.isPinned && (
                      <span className="text-[10px] text-muted-foreground/70 italic">
                        (session)
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-1">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={board.length_mm}
                      onChange={(e) =>
                        updateBoard(board.id, { length_mm: Number(e.target.value) || 0 })
                      }
                      onFocus={(e) => e.target.select()}
                      className="h-7 w-16 text-xs px-2"
                    />
                    <span className="text-muted-foreground">x</span>
                    <Input
                      type="number"
                      value={board.width_mm}
                      onChange={(e) =>
                        updateBoard(board.id, { width_mm: Number(e.target.value) || 0 })
                      }
                      onFocus={(e) => e.target.select()}
                      className="h-7 w-16 text-xs px-2"
                    />
                  </div>
                </TableCell>
                <TableCell className="px-3 py-1">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      R
                    </span>
                    <Input
                      type="number"
                      value={board.cost}
                      onChange={(e) =>
                        updateBoard(board.id, { cost: Number(e.target.value) || 0 })
                      }
                      onFocus={(e) => e.target.select()}
                      className="h-7 w-24 text-xs pl-5 pr-2"
                    />
                  </div>
                </TableCell>
                <TableCell className="px-3 py-1 text-center">
                  <input
                    type="radio"
                    name={`board-default-${title.replace(/\s+/g, '-').toLowerCase()}`}
                    checked={board.isDefault}
                    onChange={() => setDefault(board.id)}
                    className="h-4 w-4 accent-primary cursor-pointer"
                    aria-label={`Set ${board.name} as default`}
                  />
                </TableCell>
                <TableCell className="px-3 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteBoard(board.id)}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label="Delete board"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// =============================================================================
// Edging Table Component
// =============================================================================

interface EdgingTableProps {
  edging: EdgingMaterial[];
  onEdgingChange: (edging: EdgingMaterial[]) => void;
  onAdd: () => void;
}

function EdgingTable({ edging, onEdgingChange, onAdd }: EdgingTableProps) {
  const updateEdging = (id: string, updates: Partial<EdgingMaterial>) => {
    onEdgingChange(
      edging.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  };

  const deleteEdging = (id: string) => {
    const toDelete = edging.find((e) => e.id === id);
    const remaining = edging.filter((e) => e.id !== id);

    // If we deleted a default, make another of the same thickness the default
    if (toDelete?.isDefaultForThickness) {
      const sameThickness = remaining.find((e) => e.thickness_mm === toDelete.thickness_mm);
      if (sameThickness) {
        sameThickness.isDefaultForThickness = true;
      }
    }

    onEdgingChange(remaining);
  };

  const setDefaultForThickness = (id: string, thickness: number) => {
    onEdgingChange(
      edging.map((e) => ({
        ...e,
        isDefaultForThickness:
          e.thickness_mm === thickness ? e.id === id : e.isDefaultForThickness,
      }))
    );
  };

  // Group edging by thickness for radio groups
  const thicknessGroups = edging.reduce<Record<number, EdgingMaterial[]>>((acc, e) => {
    if (!acc[e.thickness_mm]) acc[e.thickness_mm] = [];
    acc[e.thickness_mm].push(e);
    return acc;
  }, {});

  // Get default ID for each thickness
  const getDefaultForThickness = (thickness: number): string => {
    return (
      thicknessGroups[thickness]?.find((e) => e.isDefaultForThickness)?.id ??
      thicknessGroups[thickness]?.[0]?.id ??
      ''
    );
  };

  return (
    <div className="rounded-lg border bg-card/40 overflow-hidden">
      <SectionHeader title="EDGING" onAdd={onAdd} />
      {edging.length === 0 ? (
        <div className="px-4 py-3 text-center text-sm text-muted-foreground">
          No edging added. Click + Add to select from inventory.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="h-10">
              <TableHead className="h-10 px-2 text-xs w-[40px]"></TableHead>
              <TableHead className="h-10 px-3 text-xs">Name</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[100px]">Size</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[110px]">Cost/Meter</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[120px] text-center">Default for Thickness</TableHead>
              <TableHead className="h-10 px-3 text-xs w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(thicknessGroups).map(([thicknessStr, items]) => {
              const thickness = Number(thicknessStr);
              return items.map((e, idx) => (
                <TableRow
                  key={e.id}
                  className={cn(
                    'h-10',
                    !e.isPinned && 'bg-muted/20',
                    idx === 0 && Object.keys(thicknessGroups).indexOf(thicknessStr) > 0
                      ? 'border-t-2'
                      : ''
                  )}
                >
                  <TableCell className="px-2 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => updateEdging(e.id, { isPinned: !e.isPinned })}
                      className={cn(
                        'h-7 w-7',
                        e.isPinned
                          ? 'text-primary hover:text-primary/80'
                          : 'text-muted-foreground/50 hover:text-muted-foreground'
                      )}
                      aria-label={e.isPinned ? 'Unpin (remove from defaults)' : 'Pin (save to defaults)'}
                      title={e.isPinned ? 'Pinned - click to unpin' : 'Click to pin as default'}
                    >
                      {e.isPinned ? (
                        <Pin className="h-3.5 w-3.5" />
                      ) : (
                        <PinOff className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="px-3 py-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{e.name}</span>
                      {e.component_id && (
                        <span className="text-xs text-muted-foreground">
                          #{e.component_id}
                        </span>
                      )}
                      {!e.isPinned && (
                        <span className="text-[10px] text-muted-foreground/70 italic">
                          (session)
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-1">
                    <span className="text-sm text-muted-foreground">
                      {e.thickness_mm}x{e.width_mm}mm
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-1">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        R
                      </span>
                      <Input
                        type="number"
                        value={e.cost_per_meter}
                        onChange={(ev) =>
                          updateEdging(e.id, { cost_per_meter: Number(ev.target.value) || 0 })
                        }
                        onFocus={(ev) => ev.target.select()}
                        className="h-7 w-24 text-xs pl-5 pr-2"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-1 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="radio"
                        name={`edging-default-${thickness}mm`}
                        checked={e.isDefaultForThickness}
                        onChange={() => setDefaultForThickness(e.id, thickness)}
                        className="h-4 w-4 accent-primary cursor-pointer"
                        aria-label={`Set ${e.name} as default for ${thickness}mm`}
                      />
                      <span className="text-xs text-muted-foreground">
                        {e.thickness_mm}mm
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteEdging(e.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label="Delete edging"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// =============================================================================
// Settings Section Component
// =============================================================================

interface SettingsSectionProps {
  kerf: number;
  onKerfChange: (kerf: number) => void;
}

function SettingsSection({ kerf, onKerfChange }: SettingsSectionProps) {
  return (
    <div className="rounded-lg border bg-card/40 overflow-hidden">
      <div className="bg-muted/30 px-3 py-2 border-b">
        <span className="text-sm font-semibold text-foreground">SETTINGS</span>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-4">
          <Label htmlFor="kerf-input" className="text-sm whitespace-nowrap">
            Blade Kerf
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="kerf-input"
              type="number"
              value={kerf}
              onChange={(e) => onKerfChange(Number(e.target.value) || 0)}
              onFocus={(e) => e.target.select()}
              className="h-8 w-20 text-sm"
            />
            <span className="text-sm text-muted-foreground">mm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MaterialsPanel Component
// =============================================================================

/**
 * MaterialsPanel - Unified materials configuration for cutlist calculator.
 *
 * Provides three sections:
 * 1. PRIMARY BOARDS - Main sheet materials with defaults
 * 2. BACKER BOARDS - Lamination backer materials with defaults
 * 3. EDGING - Edge banding materials with per-thickness defaults
 * 4. SETTINGS - Global configuration like blade kerf
 *
 * Each section supports:
 * - Adding materials via callback (parent opens component picker)
 * - Editing costs and dimensions inline
 * - Setting defaults via radio buttons
 * - Deleting materials
 */
export function MaterialsPanel({
  primaryBoards,
  backerBoards,
  edging,
  kerf,
  onPrimaryBoardsChange,
  onBackerBoardsChange,
  onEdgingChange,
  onKerfChange,
  onAddPrimaryBoard,
  onAddBackerBoard,
  onAddEdging,
  className,
}: MaterialsPanelProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Primary Boards Section */}
      <BoardTable
        boards={primaryBoards}
        onBoardsChange={onPrimaryBoardsChange}
        onAdd={onAddPrimaryBoard}
        title="PRIMARY BOARDS"
      />

      {/* Backer Boards Section */}
      <BoardTable
        boards={backerBoards}
        onBoardsChange={onBackerBoardsChange}
        onAdd={onAddBackerBoard}
        title="BACKER BOARDS"
      />

      {/* Edging Section */}
      <EdgingTable
        edging={edging}
        onEdgingChange={onEdgingChange}
        onAdd={onAddEdging}
      />

      {/* Settings Section */}
      <SettingsSection kerf={kerf} onKerfChange={onKerfChange} />
    </div>
  );
}

export default MaterialsPanel;
