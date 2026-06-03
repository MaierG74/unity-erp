'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Loader2, Plus, Route, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchFactorySections,
  fetchProductSections,
  saveProductSections,
  type FactorySection,
} from '@/lib/db/internalOrders';

export interface ProductSectionRouteEditorProps {
  orgId: string;
  productId: number;
}

export function ProductSectionRouteEditor({
  orgId,
  productId,
}: ProductSectionRouteEditorProps) {
  const queryClient = useQueryClient();

  const { data: sections = [], isLoading: sectionsLoading } = useQuery<FactorySection[]>({
    queryKey: ['factory-sections'],
    queryFn: fetchFactorySections,
  });

  const {
    data: savedRoute = [],
    isLoading: routeLoading,
  } = useQuery({
    queryKey: ['product-sections', orgId, productId],
    queryFn: () => fetchProductSections(orgId, productId),
    enabled: Boolean(orgId) && Number.isFinite(productId),
  });

  const [routeIds, setRouteIds] = useState<number[]>([]);
  const [addSelection, setAddSelection] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Hydrate the editable route from the persisted route whenever it loads/changes.
  useEffect(() => {
    setRouteIds(savedRoute.map((row) => row.section_id));
  }, [savedRoute]);

  const sectionMap = useMemo(() => {
    const map = new Map<number, FactorySection>();
    for (const section of sections) {
      map.set(section.section_id, section);
    }
    return map;
  }, [sections]);

  const availableSections = useMemo(
    () => sections.filter((section) => !routeIds.includes(section.section_id)),
    [sections, routeIds]
  );

  const isLoading = sectionsLoading || routeLoading;

  const isDirty = useMemo(() => {
    const persisted = savedRoute.map((row) => row.section_id);
    if (persisted.length !== routeIds.length) return true;
    return persisted.some((id, i) => id !== routeIds[i]);
  }, [savedRoute, routeIds]);

  function addSection(sectionId: number) {
    setRouteIds((prev) =>
      prev.includes(sectionId) ? prev : [...prev, sectionId]
    );
    setAddSelection('');
  }

  function removeSection(sectionId: number) {
    setRouteIds((prev) => prev.filter((id) => id !== sectionId));
  }

  function move(index: number, direction: -1 | 1) {
    setRouteIds((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    if (!orgId) {
      toast.error('No organisation context found.');
      return;
    }
    setSaving(true);
    try {
      await saveProductSections(orgId, productId, routeIds);
      await queryClient.invalidateQueries({
        queryKey: ['product-sections', orgId, productId],
      });
      toast.success(
        routeIds.length === 0
          ? 'Custom route cleared — reverting to the auto-derived route'
          : 'Section route saved'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save section route';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="h-4 w-4 text-muted-foreground" />
          Factory Route
        </CardTitle>
        <CardDescription>
          Choose which factory sections this product moves through, in order. Leave
          this empty to use the route automatically derived from the product&rsquo;s
          bill of labour.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading route...
          </div>
        ) : (
          <>
            {routeIds.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No custom route set. This product&rsquo;s route is auto-derived from
                its bill of labour. Add a section below to override it.
              </p>
            ) : (
              <ol className="space-y-2">
                {routeIds.map((sectionId, index) => {
                  const section = sectionMap.get(sectionId);
                  return (
                    <li
                      key={sectionId}
                      className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2.5"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {section?.color ? (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: section.color }}
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className="truncate text-sm font-medium">
                          {section?.name ?? `Section #${sectionId}`}
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          disabled={index === routeIds.length - 1}
                          onClick={() => move(index, 1)}
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSection(sectionId)}
                          aria-label="Remove section"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select
                value={addSelection || undefined}
                onValueChange={(value) => {
                  setAddSelection(value);
                  const id = Number(value);
                  if (Number.isFinite(id)) addSection(id);
                }}
                disabled={availableSections.length === 0}
              >
                <SelectTrigger className="sm:max-w-xs">
                  <SelectValue
                    placeholder={
                      availableSections.length === 0
                        ? 'All sections added'
                        : 'Add a section...'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableSections.map((section) => (
                    <SelectItem
                      key={section.section_id}
                      value={String(section.section_id)}
                    >
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableSections.length > 0 ? (
                <span className="hidden items-center text-xs text-muted-foreground sm:inline-flex">
                  <Plus className="mr-1 h-3 w-3" />
                  Selecting a section appends it to the end of the route
                </span>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border/50 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRouteIds(savedRoute.map((row) => row.section_id))}
                disabled={!isDirty || saving}
              >
                Reset
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {saving ? 'Saving...' : 'Save Route'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ProductSectionRouteEditor;
