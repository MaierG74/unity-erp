'use client';

import { useState, useCallback, DragEvent } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PartCard } from './PartCard';
import { GroupCard } from './GroupCard';
import type { CutlistGroup, CutlistPart, BoardType } from '@/lib/cutlist/types';

/**
 * Material option for the material picker dropdowns.
 */
export interface MaterialOption {
  id: string;
  code: string;
  description: string | null;
}

export interface GroupedPartsPanelProps {
  /** Groups containing categorized parts */
  groups: CutlistGroup[];
  /** Parts not yet assigned to any group */
  ungroupedParts: CutlistPart[];
  /** Callback when groups change */
  onGroupsChange: (groups: CutlistGroup[]) => void;
  /** Callback when ungrouped parts change */
  onUngroupedPartsChange: (parts: CutlistPart[]) => void;
  /** Available materials for the picker */
  materials?: MaterialOption[];
  /** Custom header content for ungrouped parts section */
  ungroupedHeader?: React.ReactNode;
  /** Custom header content for groups section */
  groupsHeader?: React.ReactNode;
  /** Whether to use full-page layout with sticky columns */
  fullPage?: boolean;
  /** Additional class name */
  className?: string;
  /** Callback when any change is made (for tracking unsaved state) */
  onChangesMade?: () => void;
  /** Title for ungrouped parts section */
  ungroupedTitle?: string;
  /** Description for ungrouped parts section */
  ungroupedDescription?: string;
  /** Title for groups section */
  groupsTitle?: string;
  /** Description for groups section */
  groupsDescription?: string;
  /** Placeholder text when no ungrouped parts */
  emptyUngroupedText?: string;
  /** Placeholder text when no groups */
  emptyGroupsText?: string;
}

/**
 * Panel component for organizing cutlist parts into groups via drag-and-drop.
 *
 * Features:
 * - Two-column layout with ungrouped parts on left, groups on right
 * - Drag-and-drop parts between ungrouped area and groups
 * - Group creation, deletion, and configuration (board type, materials)
 * - Visual feedback during drag operations
 *
 * @example
 * ```tsx
 * <GroupedPartsPanel
 *   groups={groups}
 *   ungroupedParts={ungroupedParts}
 *   onGroupsChange={setGroups}
 *   onUngroupedPartsChange={setUngroupedParts}
 *   materials={materials}
 * />
 * ```
 */
export function GroupedPartsPanel({
  groups,
  ungroupedParts,
  onGroupsChange,
  onUngroupedPartsChange,
  materials = [],
  ungroupedHeader,
  groupsHeader,
  fullPage = false,
  className,
  onChangesMade,
  ungroupedTitle = 'Ungrouped Parts',
  ungroupedDescription = 'Drag parts to groups on the right',
  groupsTitle = 'Groups',
  groupsDescription = 'Group parts and set board type',
  emptyUngroupedText = 'All parts have been grouped',
  emptyGroupsText = 'Click "New Group" to create a group',
}: GroupedPartsPanelProps) {
  const [isDragOverUngrouped, setIsDragOverUngrouped] = useState(false);

  // Helper to notify parent of changes
  const notifyChange = useCallback(() => {
    onChangesMade?.();
  }, [onChangesMade]);

  // Create new group
  const createGroup = useCallback(() => {
    const newGroup: CutlistGroup = {
      id: `group-${Date.now()}`,
      name: `Group ${groups.length + 1}`,
      boardType: '16mm',
      parts: [],
    };
    onGroupsChange([...groups, newGroup]);
    notifyChange();
  }, [groups, onGroupsChange, notifyChange]);

  // Move part to a specific group
  const movePartToGroup = useCallback((partId: string, targetGroupId: string) => {
    // Check if part is in ungrouped
    const partInUngrouped = ungroupedParts.find((p) => p.id === partId);

    if (partInUngrouped) {
      // Move from ungrouped to group
      onUngroupedPartsChange(ungroupedParts.filter((p) => p.id !== partId));
      onGroupsChange(
        groups.map((group) =>
          group.id === targetGroupId
            ? { ...group, parts: [...group.parts, partInUngrouped] }
            : group
        )
      );
    } else {
      // Part is in another group - find and move it
      let foundPart: CutlistPart | undefined;

      // First pass: find and remove the part from its current group
      const afterRemove = groups.map((group) => {
        if (group.id === targetGroupId) return group; // Skip target group for now
        const partIndex = group.parts.findIndex((p) => p.id === partId);
        if (partIndex !== -1) {
          foundPart = group.parts[partIndex];
          return {
            ...group,
            parts: group.parts.filter((p) => p.id !== partId),
          };
        }
        return group;
      });

      if (!foundPart) return; // Part not found, no change

      // Second pass: add to target group
      onGroupsChange(
        afterRemove.map((group) =>
          group.id === targetGroupId
            ? { ...group, parts: [...group.parts, foundPart!] }
            : group
        )
      );
    }
    notifyChange();
  }, [ungroupedParts, groups, onUngroupedPartsChange, onGroupsChange, notifyChange]);

  // Move part back to ungrouped
  const movePartToUngrouped = useCallback((partId: string) => {
    // Find the part in groups
    let foundPart: CutlistPart | undefined;
    for (const group of groups) {
      const part = group.parts.find((p) => p.id === partId);
      if (part) {
        foundPart = part;
        break;
      }
    }

    if (!foundPart) return; // Part not found

    // Remove from groups and add to ungrouped
    onGroupsChange(
      groups.map((group) => ({
        ...group,
        parts: group.parts.filter((p) => p.id !== partId),
      }))
    );
    onUngroupedPartsChange([...ungroupedParts, foundPart]);
    notifyChange();
  }, [groups, ungroupedParts, onGroupsChange, onUngroupedPartsChange, notifyChange]);

  // Update group properties
  const updateGroup = useCallback(
    (groupId: string, updates: Partial<CutlistGroup>) => {
      onGroupsChange(
        groups.map((group) =>
          group.id === groupId ? { ...group, ...updates } : group
        )
      );
      notifyChange();
    },
    [groups, onGroupsChange, notifyChange]
  );

  // Delete group (parts go back to ungrouped)
  const deleteGroup = useCallback((groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (group && group.parts.length > 0) {
      onUngroupedPartsChange([...ungroupedParts, ...group.parts]);
    }
    onGroupsChange(groups.filter((g) => g.id !== groupId));
    notifyChange();
  }, [groups, ungroupedParts, onGroupsChange, onUngroupedPartsChange, notifyChange]);

  // Drop handler for ungrouped area
  const handleDropOnUngrouped = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverUngrouped(false);
    const partId = e.dataTransfer.getData('text/plain');
    if (partId) {
      movePartToUngrouped(partId);
    }
  }, [movePartToUngrouped]);

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-2 gap-4',
        fullPage && 'flex-1 min-h-0',
        className
      )}
    >
      {/* Left: Ungrouped Parts */}
      <div className={cn(fullPage && 'h-full overflow-hidden')}>
        <Card className={cn(fullPage && 'h-full flex flex-col')}>
          <CardHeader className="pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{ungroupedTitle}</CardTitle>
              {ungroupedHeader}
            </div>
            <CardDescription className="text-xs">
              {ungroupedDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className={cn(fullPage && 'flex-1 overflow-y-auto')}>
            <div
              className={cn(
                'space-y-2 min-h-[200px] p-2 rounded-md transition-colors',
                isDragOverUngrouped && 'bg-accent/50 ring-2 ring-primary'
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOverUngrouped(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOverUngrouped(false);
              }}
              onDrop={handleDropOnUngrouped}
            >
              {ungroupedParts.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  {emptyUngroupedText}
                </div>
              ) : (
                ungroupedParts.map((part) => (
                  <PartCard key={part.id} part={part} />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: Groups */}
      <div className={cn(fullPage && 'h-full overflow-hidden')}>
        <Card className={cn(fullPage && 'h-full flex flex-col')}>
          <CardHeader className="pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{groupsTitle}</CardTitle>
              <div className="flex items-center gap-2">
                {groupsHeader}
                <Button variant="outline" size="sm" onClick={createGroup}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Group
                </Button>
              </div>
            </div>
            <CardDescription className="text-xs">
              {groupsDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className={cn(fullPage && 'flex-1 overflow-y-auto')}>
            <div className="space-y-3 min-h-[200px]">
              {groups.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  {emptyGroupsText}
                </div>
              ) : (
                groups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    materials={materials}
                    onNameChange={(name) => updateGroup(group.id, { name })}
                    onBoardTypeChange={(boardType: BoardType) =>
                      updateGroup(group.id, { boardType })
                    }
                    onPrimaryMaterialChange={(id, name) =>
                      updateGroup(group.id, {
                        primaryMaterialId: id,
                        primaryMaterialName: name,
                      })
                    }
                    onBackerMaterialChange={(id, name) =>
                      updateGroup(group.id, {
                        backerMaterialId: id,
                        backerMaterialName: name,
                      })
                    }
                    onRemovePart={(partId) => movePartToUngrouped(partId)}
                    onDeleteGroup={() => deleteGroup(group.id)}
                    onDropPart={(partId) => movePartToGroup(partId, group.id)}
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default GroupedPartsPanel;
