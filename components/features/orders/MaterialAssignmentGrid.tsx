'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import BoardMaterialCombobox from './BoardMaterialCombobox';
import type { BoardComponent } from '@/hooks/useBoardComponents';
import type { PartRole, BackerDefault } from '@/lib/orders/material-assignment-types';
import { roleFingerprint } from '@/lib/orders/material-assignment-types';

interface MaterialAssignmentGridProps {
  partRoles: PartRole[];
  boards: BoardComponent[];
  backerBoards: BoardComponent[];
  backerDefault: BackerDefault | null;
  onAssign: (
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    componentId: number,
    componentName: string,
  ) => void;
  onAssignBulk: (
    roles: Array<{ board_type: string; part_name: string; length_mm: number; width_mm: number }>,
    componentId: number,
    componentName: string,
  ) => void;
  onBackerDefaultChange: (backer: BackerDefault | null) => void;
}

export default function MaterialAssignmentGrid({
  partRoles,
  boards,
  backerBoards,
  backerDefault,
  onAssign,
  onAssignBulk,
  onBackerDefaultChange,
}: MaterialAssignmentGridProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedBoardType, setSelectedBoardType] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, PartRole[]>();
    for (const role of partRoles) {
      const existing = map.get(role.board_type);
      if (existing) existing.push(role);
      else map.set(role.board_type, [role]);
    }
    return map;
  }, [partRoles]);

  const boardTypes = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  const hasBackerTypes = boardTypes.some((bt) => bt.includes('-backer'));

  const toggleCollapse = (bt: string) => {
    setCollapsed((prev) => ({ ...prev, [bt]: !prev[bt] }));
  };

  const toggleSelect = (role: PartRole) => {
    const fp = roleFingerprint(role.board_type, role.part_name, role.length_mm, role.width_mm);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) {
        next.delete(fp);
        if (next.size === 0) setSelectedBoardType(null);
      } else {
        if (selectedBoardType && selectedBoardType !== role.board_type) {
          next.clear();
          setSelectedBoardType(role.board_type);
        } else if (!selectedBoardType) {
          setSelectedBoardType(role.board_type);
        }
        next.add(fp);
      }
      return next;
    });
  };

  const selectAllInGroup = (bt: string) => {
    const roles = grouped.get(bt) ?? [];
    const fps = roles.map((r) => roleFingerprint(r.board_type, r.part_name, r.length_mm, r.width_mm));
    const allSelected = fps.every((fp) => selected.has(fp));
    if (allSelected) {
      setSelected(new Set());
      setSelectedBoardType(null);
    } else {
      setSelected(new Set(fps));
      setSelectedBoardType(bt);
    }
  };

  const handleBulkAssign = useCallback(
    (componentId: number, componentName: string) => {
      if (!selectedBoardType) return;
      const roles = Array.from(selected).map((fp) => {
        const role = partRoles.find(
          (r) => roleFingerprint(r.board_type, r.part_name, r.length_mm, r.width_mm) === fp,
        );
        return {
          board_type: role!.board_type,
          part_name: role!.part_name,
          length_mm: role!.length_mm,
          width_mm: role!.width_mm,
        };
      });
      onAssignBulk(roles, componentId, componentName);
      setSelected(new Set());
      setSelectedBoardType(null);
    },
    [selected, selectedBoardType, partRoles, onAssignBulk],
  );

  const totalRoles = partRoles.length;
  const assignedCount = partRoles.filter((r) => r.assigned_component_id != null).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
            Material Assignments
          </CardTitle>
          <Badge variant={assignedCount === totalRoles ? 'default' : 'secondary'}>
            {assignedCount}/{totalRoles} assigned
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Backer default */}
        {hasBackerTypes && (
          <div className="flex items-center gap-3 rounded-sm border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Backer Default:
            </span>
            <BoardMaterialCombobox
              boards={backerBoards}
              boardType={null}
              value={backerDefault?.component_id ?? null}
              onChange={(id, name) => onBackerDefaultChange({ component_id: id, component_name: name })}
              placeholder="Select backer material…"
              className="h-8 w-full max-w-xs text-xs"
            />
          </div>
        )}

        {/* Bulk assign bar */}
        {selected.size > 0 && selectedBoardType && (
          <div className="flex items-center gap-3 rounded-sm border border-blue-500/50 bg-blue-500/10 px-3 py-2">
            <span className="text-xs text-blue-400">
              {selected.size} part{selected.size > 1 ? 's' : ''} selected
            </span>
            <BoardMaterialCombobox
              boards={boards}
              boardType={selectedBoardType}
              value={null}
              onChange={handleBulkAssign}
              placeholder="Assign material to selected…"
              className="h-8 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setSelected(new Set()); setSelectedBoardType(null); }}
            >
              Clear
            </Button>
          </div>
        )}

        {/* Board type groups */}
        {boardTypes.map((bt) => {
          const roles = grouped.get(bt) ?? [];
          const isCollapsed = collapsed[bt] ?? false;
          const groupAssigned = roles.filter((r) => r.assigned_component_id != null).length;

          return (
            <div key={bt} className="rounded-sm border">
              <button
                onClick={() => toggleCollapse(bt)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{bt}</span>
                <span className="text-xs text-muted-foreground">
                  {roles.length} part{roles.length > 1 ? 's' : ''}
                </span>
                <Badge
                  variant={groupAssigned === roles.length ? 'default' : 'outline'}
                  className="ml-auto text-xs"
                >
                  {groupAssigned}/{roles.length}
                </Badge>
              </button>

              {!isCollapsed && (
                <div className="border-t">
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1">
                    <Checkbox
                      checked={roles.every((r) =>
                        selected.has(roleFingerprint(r.board_type, r.part_name, r.length_mm, r.width_mm)),
                      )}
                      onCheckedChange={() => selectAllInGroup(bt)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs text-muted-foreground">Select all</span>
                  </div>

                  {roles.map((role) => {
                    const fp = roleFingerprint(role.board_type, role.part_name, role.length_mm, role.width_mm);
                    return (
                      <div
                        key={fp}
                        className="flex items-center gap-3 border-b px-3 py-1.5 last:border-0"
                      >
                        <Checkbox
                          checked={selected.has(fp)}
                          onCheckedChange={() => toggleSelect(role)}
                          className="h-3.5 w-3.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {role.part_name}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {role.length_mm}×{role.width_mm}mm
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ×{role.total_quantity}
                            </span>
                          </div>
                          {role.product_names.length > 0 && (
                            <span className="text-xs text-muted-foreground truncate block">
                              {role.product_names.join(', ')}
                            </span>
                          )}
                        </div>
                        <BoardMaterialCombobox
                          boards={boards}
                          boardType={role.board_type}
                          value={role.assigned_component_id}
                          onChange={(id, name) =>
                            onAssign(role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
                          }
                          className="h-8 w-[240px] text-xs"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
