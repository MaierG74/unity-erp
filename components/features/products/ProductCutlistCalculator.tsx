'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calculator, Loader2, AlertTriangle, CheckCircle2, Layers } from 'lucide-react';
import {
  packPartsIntoSheets,
  type PartSpec,
  type StockSheetSpec,
  type LayoutResult,
} from '@/components/features/cutlist/packing';
import { SheetPreview } from '@/components/features/cutlist/preview';
import type { CutlistDimensions } from '@/lib/cutlist/cutlistDimensions';

// ============================================================================
// Types
// ============================================================================

interface CutlistRow {
  key: string;
  bomId: number | null;
  componentId: number;
  componentCode: string;
  componentDescription: string | null;
  source: 'direct' | 'link' | 'rpc';
  isEditable: boolean;
  category: string | null;
  dimensions: CutlistDimensions | null;
  quantityRequired: number;
  quantityPer: number;
  totalParts: number;
}

interface EditablePart {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  qty: number;
  grain: 'length' | 'width' | 'none';
  laminate: boolean;
  material_label: string;
  band_edges: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

interface ProductCutlistCalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cutlistRows: CutlistRow[];
  productName?: string;
}

// Default PG Bison sheet size (common in South Africa)
const DEFAULT_SHEET_LENGTH = 2750;
const DEFAULT_SHEET_WIDTH = 1830;
const DEFAULT_KERF = 4;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert CutlistRow to EditablePart for the editable table
 */
function rowToEditablePart(row: CutlistRow, index: number): EditablePart | null {
  const dims = row.dimensions;
  if (!dims?.length_mm || !dims?.width_mm) {
    return null;
  }

  return {
    id: `P${index + 1}`,
    name: dims.notes || row.componentCode || `Part ${index + 1}`,
    length_mm: dims.length_mm,
    width_mm: dims.width_mm,
    qty: row.totalParts,
    grain: dims.grain || 'length',
    laminate: dims.laminate?.enabled ?? false,
    material_label: dims.material_label || dims.material_code || '',
    band_edges: {
      top: dims.band_edges?.top ?? false,
      right: dims.band_edges?.right ?? false,
      bottom: dims.band_edges?.bottom ?? false,
      left: dims.band_edges?.left ?? false,
    },
  };
}

/**
 * Convert EditablePart to PartSpec for the packing algorithm
 */
function editablePartToPartSpec(part: EditablePart): PartSpec {
  return {
    id: part.id,
    length_mm: part.length_mm,
    width_mm: part.width_mm,
    qty: part.qty,
    grain: part.grain,
    laminate: part.laminate,
    material_id: null,
    band_edges: part.band_edges,
  };
}

/**
 * Format number with locale
 */
function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ============================================================================
// Component
// ============================================================================

export function ProductCutlistCalculator({
  open,
  onOpenChange,
  cutlistRows,
  productName,
}: ProductCutlistCalculatorProps) {
  // Stock sheet settings
  const [sheetLength, setSheetLength] = useState(DEFAULT_SHEET_LENGTH);
  const [sheetWidth, setSheetWidth] = useState(DEFAULT_SHEET_WIDTH);
  const [kerf, setKerf] = useState(DEFAULT_KERF);

  // Calculation state
  const [result, setResult] = useState<LayoutResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Editable parts state - initialized from cutlistRows
  const [editableParts, setEditableParts] = useState<EditablePart[]>([]);

  // Initialize editable parts when dialog opens or cutlistRows change
  useEffect(() => {
    if (open) {
      const initialParts = cutlistRows
        .map((row, index) => rowToEditablePart(row, index))
        .filter((p): p is EditablePart => p !== null);
      setEditableParts(initialParts);
      setResult(null); // Clear previous results when parts change
    }
  }, [open, cutlistRows]);

  // Convert editable parts to PartSpec for packing algorithm
  const parts = useMemo(() => {
    return editableParts.map(editablePartToPartSpec);
  }, [editableParts]);

  // Update a single part field
  const updatePart = useCallback((partId: string, field: keyof EditablePart, value: unknown) => {
    setEditableParts((prev) =>
      prev.map((part) =>
        part.id === partId ? { ...part, [field]: value } : part
      )
    );
    setResult(null); // Clear results when parts are modified
  }, []);

  // Update edge banding for a part
  const updateEdgeBanding = useCallback((partId: string, edge: 'top' | 'right' | 'bottom' | 'left', value: boolean) => {
    setEditableParts((prev) =>
      prev.map((part) =>
        part.id === partId
          ? { ...part, band_edges: { ...part.band_edges, [edge]: value } }
          : part
      )
    );
    setResult(null);
  }, []);

  // Parts with missing dimensions
  const invalidRows = useMemo(() => {
    return cutlistRows.filter(
      (row) => !row.dimensions?.length_mm || !row.dimensions?.width_mm
    );
  }, [cutlistRows]);

  // Group parts by material for summary (derived from editable parts)
  const partsByMaterial = useMemo(() => {
    const groups = new Map<string, { label: string; count: number; area: number }>();
    for (const part of editableParts) {
      const key = part.material_label || 'Unassigned';
      const existing = groups.get(key) || { label: key, count: 0, area: 0 };
      existing.count += part.qty;
      existing.area += (part.length_mm * part.width_mm * part.qty) / 1_000_000; // m²
      groups.set(key, existing);
    }
    return Array.from(groups.values());
  }, [editableParts]);

  // Run calculation
  const calculate = useCallback(() => {
    if (parts.length === 0) return;

    setCalculating(true);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const stock: StockSheetSpec[] = [
          {
            id: 'sheet',
            length_mm: sheetLength,
            width_mm: sheetWidth,
            qty: 100, // Plenty available
            kerf_mm: kerf,
          },
        ];

        const layoutResult = packPartsIntoSheets(parts, stock, {
          allowRotation: true,
        });

        setResult(layoutResult);
      } catch (error) {
        console.error('Cutlist calculation failed:', error);
      } finally {
        setCalculating(false);
      }
    }, 50);
  }, [parts, sheetLength, sheetWidth, kerf]);

  // Calculate derived stats
  const stats = useMemo(() => {
    if (!result) return null;

    const sheetArea = sheetLength * sheetWidth;
    const totalSheetArea = result.sheets.length * sheetArea;
    const usedPercent = totalSheetArea > 0 ? (result.stats.used_area_mm2 / totalSheetArea) * 100 : 0;
    const sheetsUsed = result.sheets.length;
    const fractionalSheets = result.stats.used_area_mm2 / sheetArea;

    return {
      sheetsUsed,
      fractionalSheets,
      usedPercent,
      wastePercent: 100 - usedPercent,
      edge16mm: (result.stats.edgebanding_16mm_mm || 0) / 1000, // Convert to meters
      edge32mm: (result.stats.edgebanding_32mm_mm || 0) / 1000,
      totalEdge: (result.stats.edgebanding_length_mm || 0) / 1000,
      unplacedCount: result.unplaced?.reduce((sum, u) => sum + u.count, 0) || 0,
    };
  }, [result, sheetLength, sheetWidth]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Cutlist Calculator
            {productName && (
              <span className="text-muted-foreground font-normal">- {productName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="inputs" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="inputs">Inputs</TabsTrigger>
            <TabsTrigger value="results" disabled={!result}>
              Results
            </TabsTrigger>
            <TabsTrigger value="sheets" disabled={!result}>
              Sheet Layouts
            </TabsTrigger>
          </TabsList>

          {/* Inputs Tab */}
          <TabsContent value="inputs" className="flex-1 overflow-auto space-y-4 mt-4">
            {/* Stock Sheet Settings */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Stock Sheet</CardTitle>
                <CardDescription>
                  Set the sheet dimensions for nesting calculation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sheet-length">Length (mm)</Label>
                    <Input
                      id="sheet-length"
                      type="number"
                      value={sheetLength}
                      onChange={(e) => setSheetLength(Number(e.target.value) || DEFAULT_SHEET_LENGTH)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sheet-width">Width (mm)</Label>
                    <Input
                      id="sheet-width"
                      type="number"
                      value={sheetWidth}
                      onChange={(e) => setSheetWidth(Number(e.target.value) || DEFAULT_SHEET_WIDTH)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="kerf">Kerf (mm)</Label>
                    <Input
                      id="kerf"
                      type="number"
                      value={kerf}
                      onChange={(e) => setKerf(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Default: PG Bison standard sheet (2750 x 1830 mm)
                </p>
              </CardContent>
            </Card>

            {/* Parts Summary */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Parts Summary</CardTitle>
                <CardDescription>
                  {parts.length} part type{parts.length !== 1 ? 's' : ''} from Bill of Materials
                </CardDescription>
              </CardHeader>
              <CardContent>
                {invalidRows.length > 0 && (
                  <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-yellow-600 dark:text-yellow-400">
                        {invalidRows.length} row{invalidRows.length !== 1 ? 's' : ''} missing dimensions
                      </p>
                      <p className="text-muted-foreground text-xs">
                        These will be excluded from the calculation. Add length and width on the BOM tab.
                      </p>
                    </div>
                  </div>
                )}

                {partsByMaterial.length > 0 ? (
                  <div className="space-y-2">
                    {partsByMaterial.map((group, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
                      >
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{group.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline">{group.count} parts</Badge>
                          <Badge variant="secondary">{formatNumber(group.area)} m²</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No valid parts found. Add cutlist dimensions on the BOM tab.
                  </p>
                )}

                {/* Editable Parts Table */}
                {editableParts.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-muted-foreground mb-2">
                      Edit dimensions, quantities, grain direction and edge banding below
                    </div>
                    <div className="max-h-[300px] overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12 sticky top-0 bg-background">ID</TableHead>
                            <TableHead className="min-w-[120px] sticky top-0 bg-background">Name</TableHead>
                            <TableHead className="w-20 sticky top-0 bg-background">L (mm)</TableHead>
                            <TableHead className="w-20 sticky top-0 bg-background">W (mm)</TableHead>
                            <TableHead className="w-16 sticky top-0 bg-background">Qty</TableHead>
                            <TableHead className="w-24 sticky top-0 bg-background">Grain</TableHead>
                            <TableHead className="sticky top-0 bg-background">
                              <div className="text-center">Edging</div>
                              <div className="flex justify-center gap-1 text-[10px] text-muted-foreground">
                                <span className="w-6 text-center">T</span>
                                <span className="w-6 text-center">R</span>
                                <span className="w-6 text-center">B</span>
                                <span className="w-6 text-center">L</span>
                              </div>
                            </TableHead>
                            <TableHead className="w-16 text-right sticky top-0 bg-background">Area</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {editableParts.map((part) => (
                            <TableRow key={part.id}>
                              <TableCell className="font-mono text-xs">{part.id}</TableCell>
                              <TableCell className="text-xs">
                                <span className="truncate block max-w-[120px]" title={part.name}>
                                  {part.name}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={part.length_mm}
                                  onChange={(e) => updatePart(part.id, 'length_mm', Number(e.target.value) || 0)}
                                  className="h-7 w-18 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={part.width_mm}
                                  onChange={(e) => updatePart(part.id, 'width_mm', Number(e.target.value) || 0)}
                                  className="h-7 w-18 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={part.qty}
                                  onChange={(e) => updatePart(part.id, 'qty', Number(e.target.value) || 1)}
                                  className="h-7 w-14 text-xs"
                                  min={1}
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={part.grain}
                                  onValueChange={(v) => updatePart(part.id, 'grain', v as 'length' | 'width' | 'none')}
                                >
                                  <SelectTrigger className="h-7 w-20 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="length">Length</SelectItem>
                                    <SelectItem value="width">Width</SelectItem>
                                    <SelectItem value="none">None</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <TooltipProvider delayDuration={200}>
                                  <div className="flex justify-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>
                                          <Checkbox
                                            checked={part.band_edges.top}
                                            onCheckedChange={(checked) =>
                                              updateEdgeBanding(part.id, 'top', checked as boolean)
                                            }
                                            className="h-5 w-5"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p>Top edge (length edge)</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>
                                          <Checkbox
                                            checked={part.band_edges.right}
                                            onCheckedChange={(checked) =>
                                              updateEdgeBanding(part.id, 'right', checked as boolean)
                                            }
                                            className="h-5 w-5"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p>Right edge (width edge)</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>
                                          <Checkbox
                                            checked={part.band_edges.bottom}
                                            onCheckedChange={(checked) =>
                                              updateEdgeBanding(part.id, 'bottom', checked as boolean)
                                            }
                                            className="h-5 w-5"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p>Bottom edge (length edge)</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>
                                          <Checkbox
                                            checked={part.band_edges.left}
                                            onCheckedChange={(checked) =>
                                              updateEdgeBanding(part.id, 'left', checked as boolean)
                                            }
                                            className="h-5 w-5"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p>Left edge (width edge)</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </TooltipProvider>
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {formatNumber((part.length_mm * part.width_mm * part.qty) / 1_000_000)} m²
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Calculate Button */}
            <div className="flex justify-end">
              <Button
                onClick={calculate}
                disabled={parts.length === 0 || calculating}
                size="lg"
              >
                {calculating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    <Calculator className="h-4 w-4 mr-2" />
                    Calculate Cutlist
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="flex-1 overflow-auto space-y-4 mt-4">
            {stats && (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground">Sheets Used</div>
                      <div className="text-2xl font-bold">{formatNumber(stats.fractionalSheets, 3)}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground">Billable Sheets</div>
                      <div className="text-2xl font-bold">{stats.sheetsUsed}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground">Board Used %</div>
                      <div className="text-2xl font-bold">{formatNumber(stats.usedPercent, 1)}%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground">Edge 16mm</div>
                      <div className="text-2xl font-bold">{formatNumber(stats.edge16mm)}m</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-xs text-muted-foreground">Edge 32mm</div>
                      <div className="text-2xl font-bold">{formatNumber(stats.edge32mm)}m</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Warnings */}
                {stats.unplacedCount > 0 && (
                  <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-destructive">
                        {stats.unplacedCount} part{stats.unplacedCount !== 1 ? 's' : ''} could not be placed
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Check if parts are larger than the sheet or if more sheets are needed.
                      </p>
                    </div>
                  </div>
                )}

                {stats.unplacedCount === 0 && (
                  <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-md flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-green-600 dark:text-green-400">
                        All parts placed successfully
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {parts.reduce((sum, p) => sum + p.qty, 0)} parts nested across {stats.sheetsUsed} sheet{stats.sheetsUsed !== 1 ? 's' : ''}.
                      </p>
                    </div>
                  </div>
                )}

                {/* Summary */}
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Calculation Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Total parts:</span>
                        <span className="ml-2 font-medium">{parts.reduce((sum, p) => sum + p.qty, 0)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Part types:</span>
                        <span className="ml-2 font-medium">{parts.length}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Sheet size:</span>
                        <span className="ml-2 font-medium">{sheetLength} x {sheetWidth} mm</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Kerf:</span>
                        <span className="ml-2 font-medium">{kerf} mm</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Used area:</span>
                        <span className="ml-2 font-medium">
                          {formatNumber(result!.stats.used_area_mm2 / 1_000_000)} m²
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Waste area:</span>
                        <span className="ml-2 font-medium">
                          {formatNumber(result!.stats.waste_area_mm2 / 1_000_000)} m²
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Sheet Layouts Tab */}
          <TabsContent value="sheets" className="flex-1 overflow-auto mt-4">
            {result && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.sheets.map((sheet, idx) => {
                  const sheetArea = sheetLength * sheetWidth;
                  const usedArea = sheet.placements.reduce((sum, p) => sum + p.w * p.h, 0);
                  const usedPercent = (usedArea / sheetArea) * 100;

                  return (
                    <Card key={sheet.sheet_id}>
                      <CardHeader className="py-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">Sheet {idx + 1}</CardTitle>
                          <Badge variant="outline">
                            {formatNumber(usedPercent, 1)}% used
                          </Badge>
                        </div>
                        <CardDescription>
                          {sheet.placements.length} part{sheet.placements.length !== 1 ? 's' : ''} placed
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex justify-center">
                        <SheetPreview
                          sheetWidth={sheetWidth}
                          sheetLength={sheetLength}
                          layout={sheet}
                          maxWidth={380}
                          maxHeight={280}
                          showDimensions={true}
                          showSheetDimensions={true}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default ProductCutlistCalculator;
