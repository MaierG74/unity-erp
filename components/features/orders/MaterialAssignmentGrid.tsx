'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Layers, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import BoardMaterialCombobox from './BoardMaterialCombobox';
import type { BoardComponent } from '@/hooks/useBoardComponents';
import type { PartRole, BackerDefault, EdgingDefault, EdgingOverride } from '@/lib/orders/material-assignment-types';
import { roleFingerprint } from '@/lib/orders/material-assignment-types';

interface MaterialAssignmentGridProps {
  partRoles: PartRole[];
  boards: BoardComponent[];
  backerBoards: BoardComponent[];
  backerDefault: BackerDefault | null;
  onAssign: (
    orderDetailId: number,
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    componentId: number,
    componentName: string,
  ) => void;
  onAssignBulk: (
    roles: Array<{ order_detail_id: number; board_type: string; part_name: string; length_mm: number; width_mm: number }>,
    componentId: number,
    componentName: string,
  ) => void;
  onBackerDefaultChange: (backer: BackerDefault | null) => void;
  edgingComponents: BoardComponent[];
  edgingDefaults: EdgingDefault[];
  edgingOverrides: EdgingOverride[];
  onEdgingDefault: (boardComponentId: number, edgingComponentId: number, edgingComponentName: string) => void;
  onEdgingOverride: (
    orderDetailId: number,
    boardType: string,
    partName: string,
    lengthMm: number,
    widthMm: number,
    edgingComponentId: number,
    edgingComponentName: string,
  ) => void;
}

export default function MaterialAssignmentGrid({
  partRoles,
  boards,
  backerBoards,
  backerDefault,
  onAssign,
  onAssignBulk,
  onBackerDefaultChange,
  edgingComponents,
  edgingDefaults,
  edgingOverrides,
  onEdgingDefault,
  onEdgingOverride,
}: MaterialAssignmentGridProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedLines, setCollapsedLines] = useState<Record<number, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedBoardType, setSelectedBoardType] = useState<string | null>(null);
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<string, Map<number, PartRole[]>>();
    for (const role of partRoles) {
      let btMap = map.get(role.board_type);
      if (!btMap) {
        btMap = new Map();
        map.set(role.board_type, btMap);
      }
      const existing = btMap.get(role.order_detail_id);
      if (existing) existing.push(role);
      else btMap.set(role.order_detail_id, [role]);
    }
    return map;
  }, [partRoles]);

  const boardTypes = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  const hasBackerTypes = boardTypes.some((bt) => bt.includes('-backer'));

  const toggleCollapse = (bt: string) => {
    setCollapsed((prev) => ({ ...prev, [bt]: !prev[bt] }));
  };

  const toggleSelect = (role: PartRole) => {
    const fp = roleFingerprint(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm);
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
    const subGroups = grouped.get(bt);
    if (!subGroups) return;
    const allRoles = Array.from(subGroups.values()).flat();
    const fps = allRoles.map((r) => roleFingerprint(r.order_detail_id, r.board_type, r.part_name, r.length_mm, r.width_mm));
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
          (r) => roleFingerprint(r.order_detail_id, r.board_type, r.part_name, r.length_mm, r.width_mm) === fp,
        );
        return {
          order_detail_id: role!.order_detail_id,
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
          const subGroups = grouped.get(bt)!;
          const allRoles = Array.from(subGroups.values()).flat();
          const isCollapsed = collapsed[bt] ?? false;
          const groupAssigned = allRoles.filter((r) => r.assigned_component_id != null).length;

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
                  {allRoles.length} part{allRoles.length > 1 ? 's' : ''}
                </span>
                <Badge
                  variant={groupAssigned === allRoles.length ? 'default' : 'outline'}
                  className="ml-auto text-xs"
                >
                  {groupAssigned}/{allRoles.length}
                </Badge>
              </button>

              {!isCollapsed && (
                <div className="border-t">
                  <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1">
                    <Checkbox
                      checked={allRoles.every((r) =>
                        selected.has(roleFingerprint(r.order_detail_id, r.board_type, r.part_name, r.length_mm, r.width_mm)),
                      )}
                      onCheckedChange={() => selectAllInGroup(bt)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs text-muted-foreground">Select all</span>
                  </div>

                  {/* Sub-groups by order line */}
                  {Array.from(subGroups.entries()).map(([orderDetailId, roles], lineIdx) => {
                    const lineLabel = roles[0]?.product_name || `Line ${lineIdx + 1}`;
                    const assignedIds = new Set(roles.map((r) => r.assigned_component_id).filter(Boolean));
                    const subGroupBoardId = assignedIds.size === 1 ? [...assignedIds][0] : null;
                    const hasEdgedParts = roles.some((r) => r.has_edges && r.assigned_component_id != null);
                    const edgingDefault = subGroupBoardId
                      ? edgingDefaults.find((ed) => ed.board_component_id === subGroupBoardId)
                      : null;
                    const isLineCollapsed = collapsedLines[orderDetailId] ?? false;
                    const lineAssigned = roles.filter((r) => r.assigned_component_id != null).length;

                    return (
                      <div key={orderDetailId} className="border-b last:border-0">
                        {/* Sub-group header — clickable to collapse */}
                        <div className="flex items-center gap-2 bg-muted/10 px-3 py-1.5 border-b">
                          <button
                            onClick={() => setCollapsedLines((prev) => ({ ...prev, [orderDetailId]: !prev[orderDetailId] }))}
                            className="flex items-center gap-2 min-w-0 hover:text-foreground"
                          >
                            {isLineCollapsed ? (
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="text-xs font-medium text-foreground truncate">
                              {lineLabel}
                            </span>
                            <span className="text-xs text-muted-foreground font-normal whitespace-nowrap">
                              Line {lineIdx + 1}, Qty {roles[0]?.total_quantity ?? 0}
                            </span>
                          </button>
                          <Badge
                            variant={lineAssigned === roles.length ? 'default' : 'outline'}
                            className="text-xs shrink-0"
                          >
                            {lineAssigned}/{roles.length}
                          </Badge>
                          <div className="ml-auto flex items-center gap-2">
                            <BoardMaterialCombobox
                              boards={boards}
                              boardType={bt}
                              value={subGroupBoardId ?? null}
                              onChange={(id, name) => {
                                const bulkRoles = roles.map((r) => ({
                                  order_detail_id: r.order_detail_id,
                                  board_type: r.board_type,
                                  part_name: r.part_name,
                                  length_mm: r.length_mm,
                                  width_mm: r.width_mm,
                                }));
                                onAssignBulk(bulkRoles, id, name);
                              }}
                              placeholder="Assign board…"
                              className="h-7 w-[200px] text-xs"
                            />
                            {hasEdgedParts && subGroupBoardId && (
                              <BoardMaterialCombobox
                                boards={edgingComponents}
                                boardType={null}
                                value={edgingDefault?.edging_component_id ?? null}
                                onChange={(id, name) => onEdgingDefault(subGroupBoardId, id, name)}
                                placeholder="Edging…"
                                className="h-7 w-[180px] text-xs"
                              />
                            )}
                          </div>
                        </div>

                        {/* Part rows — collapsible */}
                        {!isLineCollapsed && roles.map((role) => {
                          const fp = roleFingerprint(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm);
                          return (
                            <div key={fp} className="flex items-center gap-3 border-b px-3 py-1.5 last:border-0">
                              <Checkbox
                                checked={selected.has(fp)}
                                onCheckedChange={() => toggleSelect(role)}
                                className="h-3.5 w-3.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">{role.part_name}</span>
                                  <span className="text-xs text-muted-foreground tabular-nums">{role.length_mm}×{role.width_mm}mm</span>
                                  <span className="text-xs text-muted-foreground">×{role.total_quantity}</span>
                                </div>
                              </div>
                              <BoardMaterialCombobox
                                boards={boards}
                                boardType={role.board_type}
                                value={role.assigned_component_id}
                                onChange={(id, name) =>
                                  onAssign(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
                                }
                                className="h-8 w-[240px] text-xs"
                              />
                              {role.has_edges && (() => {
                                const override = edgingOverrides.find(
                                  (eo) => roleFingerprint(eo.order_detail_id, eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
                                );
                                return expandedOverrides.has(fp) || override ? (
                                  <BoardMaterialCombobox
                                    boards={edgingComponents}
                                    boardType={null}
                                    value={override?.edging_component_id ?? null}
                                    onChange={(id, name) =>
                                      onEdgingOverride(role.order_detail_id, role.board_type, role.part_name, role.length_mm, role.width_mm, id, name)
                                    }
                                    placeholder="Override edging…"
                                    className="h-8 w-[180px] text-xs"
                                  />
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-xs text-muted-foreground"
                                    onClick={() => setExpandedOverrides((prev) => {
                                      const next = new Set(prev);
                                      next.add(fp);
                                      return next;
                                    })}
                                    title="Override edging for this part"
                                  >
                                    <Scissors className="h-3 w-3" />
                                  </Button>
                                );
                              })()}
                            </div>
                          );
                        })}
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
