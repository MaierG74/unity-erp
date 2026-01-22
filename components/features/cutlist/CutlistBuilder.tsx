'use client';

import { useState, useCallback, useMemo, useEffect, DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Upload, Plus, Trash2, Calculator, Loader2, FileSpreadsheet, Save, Check } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { PartCard } from './PartCard';
import { GroupCard } from './GroupCard';
import { SheetPreview } from './preview';
import {
  type CutlistPart,
  type CutlistGroup,
  type BoardType,
  type BoardCalculation,
  expandGroupsToPartSpecs,
} from '@/lib/cutlist/boardCalculator';
import { parseCSVContent, type ParsedCSVRow } from '@/lib/cutlist/csvParser';
import { packPartsIntoSheets, type LayoutResult, type StockSheetSpec } from './packing';

interface CutlistBuilderProps {
  productId?: number;
  className?: string;
  /** When true, uses full-page layout with sticky columns */
  fullPage?: boolean;
}

interface MaterialOption {
  id: string;
  code: string;
  description: string | null;
}

// Default stock sheet (PG Bison standard)
const DEFAULT_STOCK_SHEET: StockSheetSpec = {
  id: 'stock-1',
  length_mm: 2750,
  width_mm: 1830,
  qty: 100,
  kerf_mm: 4,
};

// Database response types
interface DatabaseCutlistGroup {
  id: number;
  product_id: number;
  name: string;
  board_type: '16mm' | '32mm-both' | '32mm-backer';
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: CutlistPart[];
  sort_order: number;
}

/**
 * Cutlist Builder with drag-and-drop grouping.
 * Import CSV parts, group them, set board types, and calculate sheet requirements.
 */
export function CutlistBuilder({ productId, className, fullPage = false }: CutlistBuilderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State
  const [ungroupedParts, setUngroupedParts] = useState<CutlistPart[]>([]);
  const [groups, setGroups] = useState<CutlistGroup[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<{
    calculation: BoardCalculation;
    primaryResults: Map<string, LayoutResult>;
    backerResults: Map<string, LayoutResult>;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'builder' | 'results'>('builder');
  const [isDragOverUngrouped, setIsDragOverUngrouped] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Fetch existing cutlist groups from database
  const { data: savedGroups, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['cutlist-groups', productId],
    queryFn: async () => {
      if (!productId) return null;
      const response = await fetch(`/api/products/${productId}/cutlist-groups`);
      if (!response.ok) throw new Error('Failed to fetch cutlist groups');
      const data = await response.json();
      return data.groups as DatabaseCutlistGroup[];
    },
    enabled: !!productId,
  });

  // Special group name for storing ungrouped parts
  const UNGROUPED_GROUP_NAME = '__ungrouped__';

  // Load groups from database when data arrives
  useEffect(() => {
    if (savedGroups && savedGroups.length > 0) {
      // Separate ungrouped parts (stored as special group) from regular groups
      const ungroupedGroup = savedGroups.find((g) => g.name === UNGROUPED_GROUP_NAME);
      const regularGroups = savedGroups.filter((g) => g.name !== UNGROUPED_GROUP_NAME);

      // Load regular groups
      const loadedGroups: CutlistGroup[] = regularGroups.map((dbGroup) => ({
        id: `db-${dbGroup.id}`,
        name: dbGroup.name,
        boardType: dbGroup.board_type,
        primaryMaterialId: dbGroup.primary_material_id?.toString(),
        primaryMaterialName: dbGroup.primary_material_name || undefined,
        backerMaterialId: dbGroup.backer_material_id?.toString(),
        backerMaterialName: dbGroup.backer_material_name || undefined,
        parts: dbGroup.parts || [],
      }));
      setGroups(loadedGroups);

      // Load ungrouped parts
      if (ungroupedGroup && ungroupedGroup.parts) {
        setUngroupedParts(ungroupedGroup.parts);
      }

      setHasUnsavedChanges(false);
    }
  }, [savedGroups]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async ({ groupsToSave, ungroupedToSave }: { groupsToSave: CutlistGroup[]; ungroupedToSave: CutlistPart[] }) => {
      if (!productId) throw new Error('No product ID');

      // Build groups array including ungrouped parts as a special group
      const allGroups = [
        ...groupsToSave.map((group, index) => ({
          name: group.name,
          board_type: group.boardType,
          primary_material_id: group.primaryMaterialId || null,
          primary_material_name: group.primaryMaterialName || null,
          backer_material_id: group.backerMaterialId || null,
          backer_material_name: group.backerMaterialName || null,
          parts: group.parts,
          sort_order: index,
        })),
      ];

      // Add ungrouped parts as a special group if there are any
      if (ungroupedToSave.length > 0) {
        allGroups.push({
          name: UNGROUPED_GROUP_NAME,
          board_type: '16mm' as const,
          primary_material_id: null,
          primary_material_name: null,
          backer_material_id: null,
          backer_material_name: null,
          parts: ungroupedToSave,
          sort_order: 9999, // Put at end
        });
      }

      const response = await fetch(`/api/products/${productId}/cutlist-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: allGroups }),
      });

      if (!response.ok) throw new Error('Failed to save cutlist groups');
      return response.json();
    },
    onSuccess: () => {
      setHasUnsavedChanges(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ['cutlist-groups', productId] });
      toast({
        title: 'Cutlist saved',
        description: 'Your cutlist groups have been saved to the database.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Save failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Track unsaved changes
  const markUnsaved = useCallback(() => {
    setHasUnsavedChanges(true);
    setResult(null);
  }, []);

  // Fetch melamine components for material picker
  const { data: materials = [] } = useQuery<MaterialOption[]>({
    queryKey: ['melamine-materials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select(`
          component_id,
          internal_code,
          description,
          category:component_categories!inner (
            categoryname
          )
        `)
        .ilike('component_categories.categoryname', '%melamine%')
        .order('internal_code', { ascending: true });

      if (error) throw error;

      return (data || []).map((c) => ({
        id: String(c.component_id),
        code: c.internal_code || `#${c.component_id}`,
        description: c.description,
      }));
    },
  });

  // CSV file drop handler
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) return;

      const parsed = parseCSVContent(content);
      const newParts: CutlistPart[] = parsed.sheetGoodsRows
        .filter((row) => row.validation.valid)
        .map((row, index) => ({
          id: `csv-${Date.now()}-${index}`,
          name: row.designation || `Part ${index + 1}`,
          length_mm: row.length_mm,
          width_mm: row.width_mm,
          quantity: row.quantity,
          grain: 'length' as const,
          band_edges: {
            top: Boolean(row.edgeLength1?.trim()),
            bottom: Boolean(row.edgeLength2?.trim()),
            right: Boolean(row.edgeWidth1?.trim()),
            left: Boolean(row.edgeWidth2?.trim()),
          },
          material_label: row.materialName || undefined,
        }));

      setUngroupedParts((prev) => [...prev, ...newParts]);
      markUnsaved(); // Mark as unsaved since new parts were imported
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt', '.csv'],
    },
    multiple: false,
  });

  // Create new group
  const createGroup = useCallback(() => {
    const newGroup: CutlistGroup = {
      id: `group-${Date.now()}`,
      name: `Group ${groups.length + 1}`,
      boardType: '16mm',
      parts: [],
    };
    setGroups((prev) => [...prev, newGroup]);
    markUnsaved();
  }, [groups.length, markUnsaved]);

  // Move part to group
  const movePartToGroup = useCallback((partId: string, groupId: string) => {
    // Check if part is in ungrouped
    const partInUngrouped = ungroupedParts.find((p) => p.id === partId);

    if (partInUngrouped) {
      // Move from ungrouped to group
      setUngroupedParts((prev) => prev.filter((p) => p.id !== partId));
      setGroups((prev) =>
        prev.map((group) =>
          group.id === groupId
            ? { ...group, parts: [...group.parts, partInUngrouped] }
            : group
        )
      );
    } else {
      // Part is in another group - find and move it in a single update
      setGroups((prev) => {
        let foundPart: CutlistPart | undefined;

        // First pass: find and remove the part from its current group
        const afterRemove = prev.map((group) => {
          if (group.id === groupId) return group; // Skip target group for now
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

        if (!foundPart) return prev; // Part not found, no change

        // Second pass: add to target group
        return afterRemove.map((group) =>
          group.id === groupId
            ? { ...group, parts: [...group.parts, foundPart!] }
            : group
        );
      });
    }
    markUnsaved();
  }, [ungroupedParts, markUnsaved]);

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
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        parts: group.parts.filter((p) => p.id !== partId),
      }))
    );
    setUngroupedParts((prev) => [...prev, foundPart!]);
    markUnsaved();
  }, [groups, markUnsaved]);

  // Update group properties
  const updateGroup = useCallback(
    (groupId: string, updates: Partial<CutlistGroup>) => {
      setGroups((prev) =>
        prev.map((group) =>
          group.id === groupId ? { ...group, ...updates } : group
        )
      );
      markUnsaved();
    },
    [markUnsaved]
  );

  // Delete group (parts go back to ungrouped)
  const deleteGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const group = prev.find((g) => g.id === groupId);
      if (group && group.parts.length > 0) {
        setUngroupedParts((ungrouped) => [...ungrouped, ...group.parts]);
      }
      return prev.filter((g) => g.id !== groupId);
    });
    markUnsaved();
  }, [markUnsaved]);

  // Clear all
  const clearAll = useCallback(() => {
    setUngroupedParts([]);
    setGroups([]);
    setResult(null);
    markUnsaved();
  }, [markUnsaved]);

  // Save to database
  const handleSave = useCallback(() => {
    if (!productId) {
      toast({
        title: 'Cannot save',
        description: 'No product selected.',
        variant: 'destructive',
      });
      return;
    }
    saveMutation.mutate({ groupsToSave: groups, ungroupedToSave: ungroupedParts });
  }, [productId, groups, ungroupedParts, saveMutation, toast]);

  // Drop handler for ungrouped area
  const handleDropOnUngrouped = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverUngrouped(false);
    const partId = e.dataTransfer.getData('text/plain');
    if (partId) {
      movePartToUngrouped(partId);
    }
  }, [movePartToUngrouped]);

  // Calculate cutlist
  const calculate = useCallback(() => {
    if (groups.length === 0) return;

    setCalculating(true);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const calculation = expandGroupsToPartSpecs(groups);

        // Run packing for each primary material set
        const primaryResults = new Map<string, LayoutResult>();
        for (const set of calculation.primarySets) {
          const key = set.materialId || 'unassigned';
          const packResult = packPartsIntoSheets(set.parts, [DEFAULT_STOCK_SHEET]);
          primaryResults.set(key, packResult);
        }

        // Run packing for each backer material set
        const backerResults = new Map<string, LayoutResult>();
        for (const set of calculation.backerSets) {
          const key = set.materialId || 'unassigned-backer';
          const packResult = packPartsIntoSheets(set.parts, [DEFAULT_STOCK_SHEET]);
          backerResults.set(key, packResult);
        }

        setResult({ calculation, primaryResults, backerResults });
        setActiveTab('results');
      } finally {
        setCalculating(false);
      }
    }, 50);
  }, [groups]);

  // Calculate totals for display
  const totals = useMemo(() => {
    if (!result) return null;

    let primarySheets = 0;
    let backerSheets = 0;
    let primaryUsedArea = 0;
    let backerUsedArea = 0;
    const sheetArea = DEFAULT_STOCK_SHEET.length_mm * DEFAULT_STOCK_SHEET.width_mm;

    for (const layout of result.primaryResults.values()) {
      primarySheets += layout.sheets.length;
      primaryUsedArea += layout.stats.used_area_mm2;
    }

    for (const layout of result.backerResults.values()) {
      backerSheets += layout.sheets.length;
      backerUsedArea += layout.stats.used_area_mm2;
    }

    const totalSheetArea = (primarySheets + backerSheets) * sheetArea;
    const utilization = totalSheetArea > 0
      ? ((primaryUsedArea + backerUsedArea) / totalSheetArea) * 100
      : 0;

    return {
      primarySheets,
      backerSheets,
      totalSheets: primarySheets + backerSheets,
      utilization: utilization.toFixed(1),
      edging16mm: (result.calculation.edging16mm / 1000).toFixed(2),
      edging32mm: (result.calculation.edging32mm / 1000).toFixed(2),
    };
  }, [result]);

  const hasPartsOrGroups = ungroupedParts.length > 0 || groups.length > 0;

  return (
    <div className={cn(fullPage ? 'h-full flex flex-col' : 'space-y-4', className)}>
      {/* Header - only show when not in fullPage mode (page has its own header) */}
      {!fullPage && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Cutlist Builder</h2>
            <p className="text-sm text-muted-foreground">
              Import parts, group them, and calculate sheet requirements
            </p>
          </div>
          <div className="flex items-center gap-2">
            {productId && hasPartsOrGroups && (
              <Button
                variant={hasUnsavedChanges ? 'default' : 'outline'}
                size="sm"
                onClick={handleSave}
                disabled={saveMutation.isPending || justSaved}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : justSaved ? (
                  <Check className="h-4 w-4 mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {justSaved ? 'Saved' : hasUnsavedChanges ? 'Save*' : 'Save'}
              </Button>
            )}
            {hasPartsOrGroups && (
              <Button variant="outline" size="sm" onClick={clearAll}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            )}
          </div>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'builder' | 'results')}
        className={cn(fullPage ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : '')}
      >
        <div className={cn('flex items-center justify-between gap-4 flex-shrink-0', fullPage && 'mb-4')}>
          <TabsList>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="results" disabled={!result}>
              Results
            </TabsTrigger>
          </TabsList>
          {fullPage && (
            <div className="flex items-center gap-2">
              {productId && hasPartsOrGroups && (
                <Button
                  variant={hasUnsavedChanges ? 'default' : 'outline'}
                  size="sm"
                  onClick={handleSave}
                  disabled={saveMutation.isPending || justSaved}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : justSaved ? (
                    <Check className="h-4 w-4 mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {justSaved ? 'Saved' : hasUnsavedChanges ? 'Save*' : 'Save'}
                </Button>
              )}
              {hasPartsOrGroups && (
                <Button variant="outline" size="sm" onClick={clearAll}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Wrapper div to handle flex height distribution for tab contents */}
        <div className={cn(fullPage ? 'flex-1 min-h-0 overflow-hidden relative' : '')}>
          <TabsContent
            value="builder"
            className={cn(
              'space-y-4',
              fullPage && 'absolute inset-0 flex flex-col overflow-hidden mt-0'
            )}
          >
          {/* Loading State */}
          {isLoadingGroups && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Loading cutlist...</span>
            </div>
          )}

          {/* CSV Import Zone */}
          {!isLoadingGroups && ungroupedParts.length === 0 && groups.length === 0 && (
            <div
              {...getRootProps()}
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              )}
            >
              <input {...getInputProps()} />
              <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-medium">Drop a SketchUp CSV file here</p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse
              </p>
            </div>
          )}

          {/* Two Column Layout */}
          {!isLoadingGroups && hasPartsOrGroups && (
            <div
              className={cn(
                'grid grid-cols-1 md:grid-cols-2 gap-4',
                fullPage && 'flex-1 min-h-0'
              )}
            >
              {/* Left: Ungrouped Parts - Sticky in full-page mode */}
              <div className={cn(fullPage && 'h-full overflow-hidden')}>
                <Card className={cn(fullPage && 'h-full flex flex-col')}>
                  <CardHeader className="pb-2 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Ungrouped Parts</CardTitle>
                      <div {...getRootProps()}>
                        <input {...getInputProps()} />
                        <Button variant="outline" size="sm">
                          <Upload className="h-4 w-4 mr-2" />
                          Import CSV
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-xs">
                      Drag parts to groups on the right
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
                          All parts have been grouped
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

              {/* Right: Groups - Scrollable in full-page mode */}
              <div className={cn(fullPage && 'h-full overflow-hidden')}>
                <Card className={cn(fullPage && 'h-full flex flex-col')}>
                  <CardHeader className="pb-2 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Groups</CardTitle>
                      <Button variant="outline" size="sm" onClick={createGroup}>
                        <Plus className="h-4 w-4 mr-2" />
                        New Group
                      </Button>
                    </div>
                    <CardDescription className="text-xs">
                      Group parts and set board type
                    </CardDescription>
                  </CardHeader>
                  <CardContent className={cn(fullPage && 'flex-1 overflow-y-auto')}>
                    <div className="space-y-3 min-h-[200px]">
                      {groups.length === 0 ? (
                        <div className="text-center text-sm text-muted-foreground py-8">
                          Click &quot;New Group&quot; to create a group
                        </div>
                      ) : (
                        groups.map((group) => (
                          <GroupCard
                            key={group.id}
                            group={group}
                            materials={materials}
                            onNameChange={(name) => updateGroup(group.id, { name })}
                            onBoardTypeChange={(boardType) =>
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
          )}

          {/* Calculate Button */}
          {!isLoadingGroups && groups.length > 0 && groups.some((g) => g.parts.length > 0) && (
            <div className="flex justify-center">
              <Button onClick={calculate} disabled={calculating} size="lg">
                {calculating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Calculator className="h-4 w-4 mr-2" />
                )}
                Calculate Cutlist
              </Button>
            </div>
          )}
          </TabsContent>

          <TabsContent
            value="results"
            className={cn(
              'space-y-4',
              fullPage && 'absolute inset-0 overflow-y-auto mt-0 pb-4'
            )}
          >
            {result && totals && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Primary Sheets</CardDescription>
                    <CardTitle className="text-2xl">{totals.primarySheets}</CardTitle>
                  </CardHeader>
                </Card>
                {totals.backerSheets > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Backer Sheets</CardDescription>
                      <CardTitle className="text-2xl">{totals.backerSheets}</CardTitle>
                    </CardHeader>
                  </Card>
                )}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Board Utilization</CardDescription>
                    <CardTitle className="text-2xl">{totals.utilization}%</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>16mm Edging</CardDescription>
                    <CardTitle className="text-2xl">{totals.edging16mm}m</CardTitle>
                  </CardHeader>
                </Card>
                {Number(totals.edging32mm) > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>32mm Edging</CardDescription>
                      <CardTitle className="text-2xl">{totals.edging32mm}m</CardTitle>
                    </CardHeader>
                  </Card>
                )}
              </div>

              {/* Sheet Layouts */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Sheet Layouts</CardTitle>
                  <CardDescription>
                    Primary boards: {totals.primarySheets} sheet
                    {totals.primarySheets !== 1 ? 's' : ''}
                    {totals.backerSheets > 0 &&
                      ` | Backer boards: ${totals.backerSheets} sheet${totals.backerSheets !== 1 ? 's' : ''}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {/* Primary sheets */}
                    {Array.from(result.primaryResults.entries()).map(([materialId, layout]) => {
                      const set = result.calculation.primarySets.find(
                        (s) => (s.materialId || 'unassigned') === materialId
                      );
                      return (
                        <div key={`primary-${materialId}`} className="space-y-3">
                          <Label className="text-sm font-medium">
                            Primary: {set?.materialName || 'Unassigned Material'}
                          </Label>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                            {layout.sheets.map((sheet, i) => (
                              <div key={sheet.sheet_id} className="space-y-1">
                                <p className="text-xs text-muted-foreground">Sheet {i + 1}</p>
                                <SheetPreview
                                  sheetWidth={DEFAULT_STOCK_SHEET.width_mm}
                                  sheetLength={DEFAULT_STOCK_SHEET.length_mm}
                                  layout={sheet}
                                  responsive
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Backer sheets */}
                    {Array.from(result.backerResults.entries()).map(([materialId, layout]) => {
                      const set = result.calculation.backerSets.find(
                        (s) => (s.materialId || 'unassigned-backer') === materialId
                      );
                      return (
                        <div key={`backer-${materialId}`} className="space-y-3">
                          <Label className="text-sm font-medium">
                            Backer: {set?.materialName || 'Unassigned Backer'}
                          </Label>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                            {layout.sheets.map((sheet, i) => (
                              <div key={sheet.sheet_id} className="space-y-1">
                                <p className="text-xs text-muted-foreground">Backer Sheet {i + 1}</p>
                                <SheetPreview
                                  sheetWidth={DEFAULT_STOCK_SHEET.width_mm}
                                  sheetLength={DEFAULT_STOCK_SHEET.length_mm}
                                  layout={sheet}
                                  responsive
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default CutlistBuilder;
