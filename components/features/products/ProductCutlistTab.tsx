'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useToast } from '@/components/ui/use-toast';
import {
  cloneCutlistDimensions,
  summariseCutlistDimensions,
  CutlistDimensions,
} from '@/lib/cutlist/cutlistDimensions';
import { cn } from '@/lib/utils';
import { Calculator, Loader2, Palette, RefreshCw, Trash2, Wrench } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import dynamic from 'next/dynamic';

// Dynamically import the calculator to avoid SSR issues
const ProductCutlistCalculator = dynamic(() => import('./ProductCutlistCalculator'), { ssr: false });

interface ProductCutlistTabProps {
  productId: number;
}

interface EffectiveBOMItem {
  bom_id?: number | null;
  component_id: number;
  quantity_required: number;
  supplier_component_id: number | null;
  suppliercomponents?: { price?: number } | null;
  _source?: 'direct' | 'link' | 'rpc';
  _sub_product_id?: number | null;
  _editable?: boolean;
  component_description?: string | null;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: CutlistDimensions | null;
}

interface ComponentRecord {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  category?: {
    categoryname?: string | null;
  } | null;
}

interface EffectiveBomResponse {
  items: EffectiveBOMItem[];
}

interface CutlistRow {
  key: string;
  bomId: number | null;
  componentId: number;
  componentCode: string;
  componentDescription: string | null;
  source: EffectiveBOMItem['_source'];
  isEditable: boolean;
  category: string | null;
  dimensions: CutlistDimensions | null;
  quantityRequired: number;
  quantityPer: number;
  totalParts: number;
}

const MELAMINE_CATEGORY = 'Melamine';

export function ProductCutlistTab({ productId }: ProductCutlistTabProps) {
  const [showLinked, setShowLinked] = useState(false);
  const [activePickerKey, setActivePickerKey] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [deleteDialogRow, setDeleteDialogRow] = useState<CutlistRow | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();

  const {
    data: effectiveBom,
    isLoading: bomLoading,
    isRefetching: bomRefetching,
    error: bomError,
    refetch: refetchBom,
  } = useQuery<EffectiveBomResponse>({
    queryKey: ['cutlist-effective-bom', productId],
    queryFn: async () => {
      const res = await authorizedFetch(`/api/products/${productId}/effective-bom`);
      if (!res.ok) {
        throw new Error('Failed to load cutlist data');
      }
      return res.json();
    },
    retry: 1,
  });

  const {
    data: componentsList = [],
    isLoading: componentsLoading,
    isRefetching: componentsRefetching,
    error: componentsError,
    refetch: refetchComponents,
  } = useQuery<ComponentRecord[]>({
    queryKey: ['components', 'with-category'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select(`
          component_id,
          internal_code,
          description,
          category:component_categories (
            categoryname
          )
        `)
        .order('internal_code', { ascending: true });
      if (error) throw error;
      return data as ComponentRecord[];
    },
    retry: 1,
  });

  const componentById = useMemo(() => {
    const map = new Map<number, ComponentRecord>();
    for (const component of componentsList) {
      map.set(component.component_id, component);
    }
    return map;
  }, [componentsList]);

  const melamineComponents = useMemo(() => {
    return componentsList.filter(
      (component) =>
        component.category?.categoryname?.toLowerCase() === MELAMINE_CATEGORY.toLowerCase()
    );
  }, [componentsList]);

  const allCutlistRows: CutlistRow[] = useMemo(() => {
    const items = effectiveBom?.items ?? [];
    return items
      .filter((item) => {
        const hasCutlistFlag = Boolean(item.is_cutlist_item);
        const hasDimensions = item.cutlist_dimensions && Object.keys(item.cutlist_dimensions).length > 0;
        return hasCutlistFlag || hasDimensions;
      })
      .map((item, index) => {
        const component = componentById.get(item.component_id);
        const dimensions = cloneCutlistDimensions(item.cutlist_dimensions) ?? null;
        const quantityRequired = Number(item.quantity_required ?? 0) || 0;
        const quantityPer = Number(dimensions?.quantity_per ?? 1) || 1;
        const totalParts = quantityRequired * quantityPer;
        return {
          key: item.bom_id ? `bom:${item.bom_id}` : `computed:${item.component_id}:${index}`,
          bomId: item.bom_id ?? null,
          componentId: item.component_id,
          componentCode: component?.internal_code ?? `Component #${item.component_id}`,
          componentDescription: item.component_description ?? component?.description ?? null,
          source: item._source ?? 'direct',
          isEditable: Boolean(item._editable) && Boolean(item.bom_id),
          category: item.cutlist_category ?? null,
          dimensions,
          quantityRequired,
          quantityPer,
          totalParts,
        };
      });
  }, [effectiveBom?.items, componentById]);

  const displayRows = useMemo(() => {
    return showLinked ? allCutlistRows : allCutlistRows.filter((row) => row.source !== 'link');
  }, [allCutlistRows, showLinked]);

  const groupedByMaterial = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        materialCode: string | null;
        rows: CutlistRow[];
        totalParts: number;
      }
    >();

    for (const row of displayRows) {
      const materialCode = row.dimensions?.material_code?.trim() || null;
      const materialLabel =
        row.dimensions?.material_label?.trim() ||
        row.dimensions?.colour_family?.trim() ||
        'Unassigned';
      const key = materialCode ?? materialLabel.toLowerCase();
      const entry = groups.get(key) ?? {
        key,
        label: materialLabel,
        materialCode,
        rows: [],
        totalParts: 0,
      };
      entry.rows.push(row);
      entry.totalParts += row.totalParts || 0;
      groups.set(key, entry);
    }

    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [displayRows]);

  const totalParts = useMemo(
    () => displayRows.reduce((sum, row) => sum + (row.totalParts || 0), 0),
    [displayRows]
  );
  const directCount = useMemo(
    () => displayRows.filter((row) => row.source !== 'link').length,
    [displayRows]
  );
  const linkedCount = useMemo(
    () => displayRows.filter((row) => row.source === 'link').length,
    [displayRows]
  );

  const updateMaterialMutation = useMutation({
    mutationFn: async ({
      row,
      component,
    }: {
      row: CutlistRow;
      component: ComponentRecord | null;
    }) => {
      if (!row.bomId) {
        throw new Error('Only direct BOM rows can be updated from here.');
      }

      const current = row.dimensions ? cloneCutlistDimensions(row.dimensions) ?? {} : {};
      const next: CutlistDimensions = { ...current };

      if (component) {
        const code = component.internal_code?.trim();
        const label = component.description?.trim() || code || `Component #${component.component_id}`;
        if (code) {
          next.material_code = code;
        } else {
          delete next.material_code;
        }
        next.material_label = label;
        if (label) {
          next.colour_family = next.colour_family ?? label;
        }
      } else {
        delete (next as any).material_code;
        delete (next as any).material_label;
        delete (next as any).colour_family;
      }

      const hasKeys = Object.keys(next).length > 0;

      const { error } = await supabase
        .from('billofmaterials')
        .update({
          cutlist_dimensions: hasKeys ? next : null,
        })
        .eq('bom_id', row.bomId);

      if (error) {
        throw error;
      }
      return { rowKey: row.key, nextDimensions: hasKeys ? next : null };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] });
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      setActivePickerKey(null);
      toast({
        title: 'Cutlist updated',
        description: variables.component
          ? `Material set to ${variables.component.description ?? variables.component.internal_code}.`
          : 'Cutlist material cleared.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Unable to update',
        description: error?.message ?? 'Failed to update cutlist material.',
        variant: 'destructive',
      });
    },
  });

  // Delete row mutation - removes entire BOM entry
  const deleteRowMutation = useMutation({
    mutationFn: async ({ row }: { row: CutlistRow }) => {
      if (!row.bomId) {
        throw new Error('Only direct BOM rows can be deleted from here.');
      }

      const { error } = await supabase
        .from('billofmaterials')
        .delete()
        .eq('bom_id', row.bomId);

      if (error) {
        throw error;
      }
      return { rowKey: row.key };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] });
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      toast({
        title: 'Cutlist row deleted',
        description: 'The cutlist item has been removed from the BOM.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Unable to delete',
        description: error?.message ?? 'Failed to delete cutlist row.',
        variant: 'destructive',
      });
    },
  });

  const isBusy =
    bomLoading ||
    componentsLoading ||
    bomRefetching ||
    componentsRefetching ||
    updateMaterialMutation.isPending ||
    deleteRowMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cutlist Overview</CardTitle>
          <CardDescription>
            Review the cutlist-ready components captured on this product. Assign melamine boards and
            decide whether to include linked sub-product parts in the view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Total parts</div>
              <div className="text-sm font-semibold text-foreground">{totalParts}</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Direct rows</div>
              <div className="text-sm font-semibold text-foreground">{directCount}</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Linked rows</div>
              <div className="text-sm font-semibold text-foreground">{linkedCount}</div>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="cutlist-show-linked"
                  checked={showLinked}
                  onCheckedChange={setShowLinked}
                />
                <Label htmlFor="cutlist-show-linked" className="text-sm text-muted-foreground">
                  Show linked parts
                </Label>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push(`/products/${productId}/cutlist-builder`)}
                disabled={isBusy}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Cutlist Builder
              </Button>
              <Button
                onClick={() => setCalculatorOpen(true)}
                disabled={allCutlistRows.length === 0 || isBusy}
              >
                <Calculator className="h-4 w-4 mr-2" />
                Generate Cutlist
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {bomError ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <p className="text-sm text-destructive">
              Failed to load cutlist data. Check your connection and try again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchBom()}
              disabled={bomRefetching}
            >
              {bomRefetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {componentsError ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <p className="text-sm text-destructive">
              Failed to load the melamine catalogue. Reconnect or retry the request.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchComponents()}
              disabled={componentsRefetching}
            >
              {componentsRefetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Parts by material</CardTitle>
          <CardDescription>
            Use the palette picker to split parts across melamine colours. Updates apply to the
            underlying BOM row.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isBusy ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading cutlist information…
            </div>
          ) : null}

          {!isBusy && groupedByMaterial.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cutlist rows captured yet. Add dimensions on the Bill of Materials tab to seed this
              view.
            </p>
          ) : null}

          {groupedByMaterial.map((group) => (
            <div key={group.key} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                {group.materialCode ? (
                  <Badge variant="outline">Code: {group.materialCode}</Badge>
                ) : (
                  <Badge variant="secondary">Unassigned</Badge>
                )}
                <Badge variant="outline">{group.totalParts} parts</Badge>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Component</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Cutlist</TableHead>
                    <TableHead className="w-[140px]">Category</TableHead>
                    <TableHead className="w-[110px] text-right">Parts</TableHead>
                    <TableHead className="w-[150px]">Material</TableHead>
                    <TableHead className="w-[130px]">Source</TableHead>
                    <TableHead className="w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => {
                    const summary = summariseCutlistDimensions(row.dimensions ?? null);
                    const materialLabel =
                      row.dimensions?.material_label ??
                      row.dimensions?.material_code ??
                      'Unassigned';
                    const isLinked = row.source === 'link';
                    const pickerOpen = activePickerKey === row.key;
                    return (
                      <TableRow key={row.key}>
                        <TableCell>
                          <div className="font-medium text-foreground">{row.componentCode}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground">
                            {row.componentDescription ?? '—'}
                          </div>
                        </TableCell>
                        <TableCell>
                          {summary.headline ? (
                            <div className="text-sm font-medium text-foreground">
                              {summary.headline}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">No dimensions</div>
                          )}
                          {summary.details.length > 0 ? (
                            <div className="text-xs text-muted-foreground">
                              {summary.details.join(' · ')}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {row.category ? (
                            <Badge variant="outline">{row.category}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="text-sm font-semibold text-foreground">
                            {row.totalParts || '—'}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Qty {row.quantityRequired} × {row.quantityPer}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-foreground">{materialLabel}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={isLinked ? 'outline' : 'secondary'}>
                              {isLinked ? 'Linked' : 'Direct'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Popover
                              open={pickerOpen}
                              onOpenChange={(open) =>
                                setActivePickerKey(open ? row.key : null)
                              }
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={!row.isEditable || melamineComponents.length === 0}
                                  className={cn(
                                    'flex items-center gap-1',
                                    pickerOpen ? 'ring-2 ring-primary/40' : undefined
                                  )}
                                >
                                  <Palette className="h-3.5 w-3.5" />
                                  Assign
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[280px] p-2">
                                <Command>
                                  <CommandInput placeholder="Search melamine…" />
                                  <CommandList>
                                    <CommandEmpty>No melamine boards found.</CommandEmpty>
                                    <CommandGroup heading="Melamine">
                                      {melamineComponents.map((component) => (
                                        <CommandItem
                                          key={component.component_id}
                                          value={`${component.internal_code ?? ''} ${component.description ?? ''}`}
                                          onSelect={() => {
                                            updateMaterialMutation.mutate({
                                              row,
                                              component,
                                            });
                                            setActivePickerKey(null);
                                          }}
                                          className="cursor-pointer"
                                        >
                                          <div
                                            className="flex flex-col w-full"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              updateMaterialMutation.mutate({
                                                row,
                                                component,
                                              });
                                              setActivePickerKey(null);
                                            }}
                                          >
                                            <span className="text-sm font-medium text-foreground">
                                              {component.internal_code ?? `Component #${component.component_id}`}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                              {component.description ?? 'No description'}
                                            </span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!row.isEditable}
                              title="Delete cutlist row"
                              onClick={() => setDeleteDialogRow(row)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="sr-only">Delete row</span>
                            </Button>
                          </div>
                          {!row.isEditable ? (
                            <div className="mt-2 text-[11px] text-muted-foreground">
                              Linked BOM rows are read-only here. Edit the source product instead.
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Palette reference</CardTitle>
            <CardDescription>
              A quick snapshot of melamine boards available in the component catalogue.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start sm:self-center"
            onClick={() => setPaletteOpen((prev) => !prev)}
            aria-expanded={paletteOpen}
          >
            {paletteOpen ? 'Hide palette' : 'Show palette'}
          </Button>
        </CardHeader>
        {paletteOpen ? (
          <CardContent>
            {componentsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading melamine catalogue…
              </div>
            ) : melamineComponents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No components are classified under the <span className="font-medium">Melamine</span>{' '}
                category yet. Add them in the Components catalogue to make them available here.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {melamineComponents.map((component) => (
                  <div
                    key={component.component_id}
                    className="rounded-md border bg-muted/30 p-3 text-sm"
                  >
                    <div className="font-semibold text-foreground">
                      {component.internal_code ?? `Component #${component.component_id}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {component.description ?? 'No description'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        ) : null}
      </Card>

      {/* Cutlist Calculator Dialog */}
      <ProductCutlistCalculator
        open={calculatorOpen}
        onOpenChange={setCalculatorOpen}
        cutlistRows={displayRows}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDialogRow} onOpenChange={(open) => !open && setDeleteDialogRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cutlist row?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this cutlist item from the Bill of Materials.
              {deleteDialogRow?.dimensions?.notes && (
                <span className="block mt-2 font-medium text-foreground">
                  Part: {deleteDialogRow.dimensions.notes}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogRow(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteDialogRow) {
                  deleteRowMutation.mutate({ row: deleteDialogRow });
                }
                setDeleteDialogRow(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

export default ProductCutlistTab;
