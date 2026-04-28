'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useProductCutlistData } from '@/hooks/useProductCutlistData';
import { useProductCutlistSnapshot } from '@/hooks/useProductCutlistSnapshot';
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
import { Input } from '@/components/ui/input';
import {
  cloneCutlistDimensions,
  summariseCutlistDimensions,
  CutlistDimensions,
} from '@/lib/cutlist/cutlistDimensions';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';
import { groupsToCutlistRows } from '@/lib/cutlist/groupsToCutlistRows';
import type {
  CutlistDataSource,
  EffectiveBomItem,
} from '@/lib/cutlist/productCutlistLoader';
import { Calculator, Loader2, RefreshCw } from 'lucide-react';

interface ProductCutlistTabProps {
  productId: number;
}

interface ComponentRecord {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  category?: {
    categoryname?: string | null;
  } | null;
}

interface CutlistRow {
  key: string;
  componentCode: string;
  componentDescription: string | null;
  source: EffectiveBomItem['_source'];
  category: string | null;
  dimensions: CutlistDimensions | null;
  quantityRequired: number;
  quantityPer: number;
  totalParts: number;
}

const MELAMINE_CATEGORY = 'Melamine';

function layoutUsedPct(
  layout: CutlistCostingSnapshot['primary_layout'] | null | undefined
): string | null {
  if (!layout) return null;
  const used = layout.stats?.used_area_mm2 ?? 0;
  const total = used + (layout.stats?.waste_area_mm2 ?? 0);
  if (total <= 0) return null;
  return `${((used / total) * 100).toFixed(1)}%`;
}

function snapshotEdgingMeters(
  entry: CutlistCostingSnapshot['edging'][number]
): number {
  return entry.meters_override ?? entry.meters_actual ?? 0;
}

export function ProductCutlistTab({ productId }: ProductCutlistTabProps) {
  const [showLinked, setShowLinked] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const router = useRouter();

  const {
    data: cutlistData,
    isLoading: cutlistLoading,
    isRefetching: cutlistRefetching,
    error: cutlistError,
    refetch: refetchCutlist,
  } = useProductCutlistData(productId);

  const { data: snapshot } = useProductCutlistSnapshot(productId);

  const dataSource: CutlistDataSource = cutlistData?.source ?? 'empty';

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

  const filteredPalette = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return melamineComponents;
    return melamineComponents.filter((component) => {
      const code = component.internal_code?.toLowerCase() ?? '';
      const desc = component.description?.toLowerCase() ?? '';
      return code.includes(q) || desc.includes(q);
    });
  }, [melamineComponents, paletteQuery]);

  const allCutlistRows: CutlistRow[] = useMemo(() => {
    if (dataSource === 'groups') {
      return groupsToCutlistRows(cutlistData?.groups ?? []);
    }

    if (dataSource === 'bom') {
      const items = cutlistData?.bomItems ?? [];
      return items
        .filter((item) => {
          const hasCutlistFlag = Boolean(item.is_cutlist_item);
          const hasDimensions =
            item.cutlist_dimensions && Object.keys(item.cutlist_dimensions).length > 0;
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
            componentCode: component?.internal_code ?? `Component #${item.component_id}`,
            componentDescription: item.component_description ?? component?.description ?? null,
            source: item._source ?? 'direct',
            category: item.cutlist_category ?? null,
            dimensions,
            quantityRequired,
            quantityPer,
            totalParts,
          };
        });
    }

    return [];
  }, [dataSource, cutlistData, componentById]);

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

  const isBusy =
    cutlistLoading ||
    componentsLoading ||
    cutlistRefetching ||
    componentsRefetching;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cutlist Overview</CardTitle>
          <CardDescription>
            Review the cutlist-ready components captured on this product and decide whether to
            include linked sub-product parts in the view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Total parts</div>
              <div className="text-sm font-semibold text-foreground">{totalParts}</div>
            </div>
            {dataSource === 'groups' ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">Groups</div>
                <div className="text-sm font-semibold text-foreground">
                  {cutlistData?.groups.length ?? 0}
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-md border bg-muted/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Direct rows</div>
                  <div className="text-sm font-semibold text-foreground">{directCount}</div>
                </div>
                <div className="rounded-md border bg-muted/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Linked rows</div>
                  <div className="text-sm font-semibold text-foreground">{linkedCount}</div>
                </div>
              </>
            )}
            {snapshot ? (
              <>
                <div className="rounded-md border bg-muted/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Primary sheets</div>
                  <div className="text-sm font-semibold text-foreground">
                    {snapshot.primary_layout?.sheets?.length ?? 0}
                  </div>
                </div>
                {layoutUsedPct(snapshot.primary_layout) ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Primary used %</div>
                    <div className="text-sm font-semibold text-foreground">
                      {layoutUsedPct(snapshot.primary_layout)}
                    </div>
                  </div>
                ) : null}
                {(snapshot.backer_layout?.sheets?.length ?? 0) > 0 ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Backer sheets</div>
                    <div className="text-sm font-semibold text-foreground">
                      {snapshot.backer_layout?.sheets?.length ?? 0}
                    </div>
                  </div>
                ) : null}
                {layoutUsedPct(snapshot.backer_layout) ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Backer used %</div>
                    <div className="text-sm font-semibold text-foreground">
                      {layoutUsedPct(snapshot.backer_layout)}
                    </div>
                  </div>
                ) : null}
                {(snapshot.edging ?? [])
                  .filter((entry) => snapshotEdgingMeters(entry) > 0)
                  .map((entry) => (
                    <div
                      key={`edge-${entry.material_id}`}
                      className="rounded-md border bg-muted/40 px-3 py-2"
                    >
                      <div className="text-xs text-muted-foreground">
                        {entry.material_name || `Edge ${entry.thickness_mm}mm`}
                      </div>
                      <div className="text-sm font-semibold text-foreground">
                        {snapshotEdgingMeters(entry).toFixed(2)}m
                      </div>
                    </div>
                  ))}
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-4">
              {dataSource === 'bom' ? (
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
              ) : null}
              <Button
                onClick={() => router.push(`/products/${productId}/cutlist-builder`)}
                disabled={isBusy}
              >
                <Calculator className="h-4 w-4 mr-2" />
                {dataSource === 'empty' ? 'Open Cutlist Builder' : 'Open in Cutlist Builder'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {cutlistError ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <p className="text-sm text-destructive">
              Failed to load cutlist data. Check your connection and try again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchCutlist()}
              disabled={cutlistRefetching}
            >
              {cutlistRefetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
            Review parts grouped by their assigned material. Edit dimensions or materials in the
            Cutlist Builder.
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
              No cutlist parts yet. Open the Cutlist Builder to enter parts manually, or use
              &ldquo;Design with Configurator&rdquo; for parametric products. You can also seed parts
              by filling <span className="font-medium">Cutlist dimensions</span> on Bill of Materials rows.
            </p>
          ) : null}

          {!isBusy && groupedByMaterial.length > 0 && dataSource === 'groups' ? (
            <p className="text-xs text-muted-foreground">
              These parts were saved from the Cutlist Builder. Edit dimensions or materials there.
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => {
                    const summary = summariseCutlistDimensions(row.dimensions ?? null);
                    const materialLabel =
                      row.dimensions?.material_label ??
                      row.dimensions?.material_code ??
                      'Unassigned';
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
                            <div className="text-sm font-medium text-foreground whitespace-nowrap">
                              {summary.headline}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">No dimensions</div>
                          )}
                          {summary.details.length > 0 && dataSource !== 'groups' ? (
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
          <CardContent className="space-y-3">
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
              <>
                <Input
                  type="search"
                  placeholder="Search by code or description…"
                  value={paletteQuery}
                  onChange={(event) => setPaletteQuery(event.target.value)}
                  className="max-w-sm"
                />
                {filteredPalette.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No boards match “{paletteQuery}”.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredPalette.map((component) => (
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
              </>
            )}
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

export default ProductCutlistTab;
