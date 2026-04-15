'use client';

import React from 'react';
import {
  QuoteItem,
  QuoteItemCluster,
  QuoteClusterLine,
  QuoteAttachment,
  QuoteItemType,
  QuoteItemTextAlign,
  createQuoteItem,
  updateQuoteItem,
  deleteQuoteItem,
  createQuoteItemCluster,
  updateQuoteItemCluster,
  createQuoteClusterLine,
  updateQuoteClusterLine,
  deleteQuoteClusterLine,
  fetchQuoteItemClusters,
  fetchQuoteItemAttachments,
  fetchQuoteItemCutlistSnapshot,
  formatCurrency,
  Component,
  fetchComponents,
  fetchProductComponents,
  fetchProductLabor,
  fetchProductOverhead,
  fetchEffectiveBOM,
  fetchComponentsByIds,
  reorderQuoteItems,
  saveQuoteItemCutlistSnapshot,
  type ProductOverheadItem,
} from '@/lib/db/quotes';
import QuoteItemClusterGrid from './QuoteItemClusterGrid';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Trash2, AlertTriangle, Copy, ChevronUp, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import InlineAttachmentsCell from './InlineAttachmentsCell';
import AddQuoteItemDialog from './AddQuoteItemDialog';
import BatchMarkupConfirmDialog from './BatchMarkupConfirmDialog';
import { createQuoteAttachmentFromUrl, fetchPrimaryProductImage } from '@/lib/db/quotes';
import type { ProductOptionSelection } from '@/lib/db/products';
import { buildCutlistLineRefsFromLines, cloneCutlistLayoutWithLineRefs, cloneJsonValue } from '@/lib/cutlist/quoteSnapshotCopy';
import Link from 'next/link';

interface Props {
  quoteId: string;
  items: QuoteItem[];
  onItemsChange: (items: QuoteItem[]) => void;
  onRefresh?: () => Promise<void>; // refresh all data from server after mutations
  attachmentsVersion?: number; // bump to force cells to refresh their local attachments
  onItemAttachmentsChange?: (itemId: string, attachments: QuoteAttachment[]) => void;
  expandedItemId?: string;
  autoExpandItemId?: string;
  onAutoExpandHandled?: () => void;
}

// --- Attachments Cell Component ---
interface QuoteItemAttachmentsCellProps {
  quoteId: string;
  itemId: string;
  version?: number;
  onItemAttachmentsChange?: (itemId: string, attachments: QuoteAttachment[]) => void;
}

function QuoteItemAttachmentsCell({ quoteId, itemId, version, onItemAttachmentsChange }: QuoteItemAttachmentsCellProps) {
  return (
    <InlineAttachmentsCell
      quoteId={quoteId}
      itemId={itemId}
      version={version}
      onItemAttachmentsChange={onItemAttachmentsChange}
    />
  );
}

function sortQuoteItemClusters(clusters: QuoteItemCluster[] | undefined): QuoteItemCluster[] {
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return [];
  }

  return [...clusters].sort((a, b) => {
    const posA = a.position ?? 0;
    const posB = b.position ?? 0;
    if (posA !== posB) return posA - posB;
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return timeA - timeB;
  });
}

function getDisplayClustersForItem(item: QuoteItem): QuoteItemCluster[] {
  const sortedClusters = sortQuoteItemClusters(item.quote_item_clusters);

  const clustersWithLines = sortedClusters
    .map((cluster) => ({
      ...cluster,
      quote_cluster_lines: (cluster.quote_cluster_lines || []).filter(Boolean),
    }))
    .filter((cluster) => (cluster.quote_cluster_lines?.length ?? 0) > 0);

  const cutlistLines = clustersWithLines.flatMap((cluster) =>
    (cluster.quote_cluster_lines || []).filter((line) => Boolean(line.cutlist_slot))
  );

  const manualClusters = clustersWithLines
    .map((cluster) => ({
      ...cluster,
      quote_cluster_lines: (cluster.quote_cluster_lines || []).filter((line) => !line.cutlist_slot),
    }))
    .filter((cluster) => (cluster.quote_cluster_lines?.length ?? 0) > 0);

  if (manualClusters.length > 0) {
    const [primaryManual, ...restManual] = manualClusters;
    return [
      {
        ...primaryManual,
        quote_cluster_lines: [
          ...(primaryManual.quote_cluster_lines || []),
          ...cutlistLines,
        ],
      },
      ...restManual,
    ];
  }

  if (cutlistLines.length > 0 && clustersWithLines.length > 0) {
    const cutlistBase = clustersWithLines[0];
    return [
      {
        ...cutlistBase,
        quote_cluster_lines: cutlistLines,
      },
    ];
  }

  if (clustersWithLines.length > 0) {
    return clustersWithLines;
  }

  return sortedClusters.length > 0 ? [sortedClusters[0]] : [];
}

function calculateClusterSubtotal(cluster: QuoteItemCluster | null | undefined): number {
  if (!cluster) return 0;
  return (cluster.quote_cluster_lines || []).reduce((sum, line) => {
    const lineTotal = (line.qty || 0) * (line.unit_cost || 0);
    return sum + lineTotal;
  }, 0);
}

function roundCurrencyValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateMarkupPercentFromPrice(subtotal: number, unitPrice: number): number | null {
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return null;
  }

  const markupPercent = ((unitPrice - subtotal) / subtotal) * 100;
  return roundCurrencyValue(markupPercent);
}

type BatchPreviewItem = {
  oldPrice: number;
  newPrice: number;
  newTotal: number;
  oldMarkup: number;
  newMarkup: number;
  profit: number;
};

function getFirstCluster(item: QuoteItem): QuoteItemCluster | undefined {
  return (item.quote_item_clusters || [])[0];
}

function calculateItemProfit(item: QuoteItem): number {
  const cluster = getFirstCluster(item);
  if (!cluster) return 0;
  const subtotal = calculateClusterSubtotal(cluster);
  const markupAmount = subtotal * (cluster.markup_percent / 100);
  return roundCurrencyValue(markupAmount) * item.qty;
}

// --- Quote Item Row Component (with expandable cluster) ---
function QuoteItemRow({
  item,
  quoteId,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddClusterLine,
  onUpdateClusterLine,
  onDeleteClusterLine,
  onUpdateCluster,
  onEnsureCluster,
  attachmentsVersion,
  onItemAttachmentsChange,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  isDuplicating,
  expandedItemId,
  autoExpandItemId,
  onAutoExpandHandled,
  batchMode = false,
  batchMarkupType = 'percentage',
  isSelected = false,
  onToggleSelect,
  previewData: itemPreview = null,
}: {
  item: QuoteItem;
  quoteId: string;
  onUpdate: (id: string, field: keyof Pick<QuoteItem, 'description' | 'qty' | 'unit_price' | 'bullet_points' | 'internal_notes'>, value: string | number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
  isDuplicating?: boolean;
  onAddClusterLine: (clusterId: string, component: {
    type: 'manual' | 'database' | 'product' | 'collection';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
    product_id?: number;
    explode?: boolean;
    include_labour?: boolean;
    collection_id?: number;
  }) => void;
  onUpdateClusterLine: (id: string, updates: Partial<QuoteClusterLine>) => void;
  onDeleteClusterLine: (id: string) => void;
  onUpdateCluster: (clusterId: string, updates: Partial<QuoteItemCluster>) => void;
  onEnsureCluster: (itemId: string) => void;
  attachmentsVersion?: number;
  onItemAttachmentsChange?: (itemId: string, attachments: QuoteAttachment[]) => void;
  expandedItemId?: string;
  autoExpandItemId?: string;
  onAutoExpandHandled?: () => void;
  batchMode?: boolean;
  batchMarkupType?: 'percentage' | 'fixed';
  isSelected?: boolean;
  onToggleSelect?: (checked: boolean) => void;
  previewData?: BatchPreviewItem | null;
}) {
  const [desc, setDesc] = React.useState(item.description);
  const [qty, setQty] = React.useState<string>(String(item.qty));
  const [unitPrice, setUnitPrice] = React.useState<string>(String(Math.round((item.unit_price || 0) * 100) / 100));
  const [isExpanded, setIsExpanded] = React.useState(false);
  const rowRef = React.useRef<HTMLTableRowElement | null>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [bpText, setBpText] = React.useState<string>(item.bullet_points || '');
  const [internalNotes, setInternalNotes] = React.useState<string>(item.internal_notes || '');

  React.useEffect(() => { setDesc(item.description); }, [item.description]);
  React.useEffect(() => { setQty(String(item.qty)); }, [item.qty]);
  React.useEffect(() => { setUnitPrice(String(Math.round((item.unit_price || 0) * 100) / 100)); }, [item.unit_price]);
  React.useEffect(() => { setBpText(item.bullet_points || ''); }, [item.bullet_points]);
  React.useEffect(() => { setInternalNotes(item.internal_notes || ''); }, [item.internal_notes]);

  React.useEffect(() => {
    if (!expandedItemId && !autoExpandItemId) return;
    if (expandedItemId === item.id || autoExpandItemId === item.id) {
      setIsExpanded(true);
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear both expandedItemId and autoExpandItemId after handling
      onAutoExpandHandled?.();
    }
  }, [expandedItemId, autoExpandItemId, item.id, onAutoExpandHandled]);

  const displayClusters = React.useMemo(() => getDisplayClustersForItem(item), [item]);

  const hasClusterLines = displayClusters.length > 0;
  const isPriced = !item.item_type || item.item_type === 'priced';
  const isHeading = item.item_type === 'heading';
  const isNote = item.item_type === 'note';

  return (
    <React.Fragment>
      <TableRow key={item.id} ref={rowRef} className={`${isHeading ? 'bg-muted/30' : ''} ${batchMode && isPriced && !isSelected ? 'opacity-40' : ''}`.trim() || undefined}>
        <TableCell>
          <div className="flex items-center gap-1">
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => onMoveUp(item.id)}
                disabled={isFirst}
                title="Move up"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => onMoveDown(item.id)}
                disabled={isLast}
                title="Move down"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
            {isPriced ? (
              displayClusters.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  disabled={!hasClusterLines}
                  title={hasClusterLines ? 'Toggle costing clusters' : 'No costing lines yet'}
                >
                  {isExpanded ? '▼' : '▶'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onEnsureCluster(item.id)}>
                  + Cluster
                </Button>
              )
            ) : (
              <span className="text-xs text-muted-foreground px-2">{isHeading ? 'H' : 'N'}</span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={() => { if (desc !== item.description) onUpdate(item.id, 'description', desc); }}
            onFocus={e => e.target.select()}
            className={isHeading ? 'font-semibold' : undefined}
          />
        </TableCell>
        {isPriced ? (
          <>
            <TableCell><Input type="number" value={qty} onChange={e => setQty(e.target.value)} onBlur={() => { const numQty = Number(qty) || 0; if (numQty !== item.qty) onUpdate(item.id, 'qty', numQty); setQty(String(numQty)); }} onFocus={e => e.target.select()} /></TableCell>
            <TableCell>
              {itemPreview ? (
                <div className="flex flex-col items-center">
                  <span className="line-through text-muted-foreground text-[10px]">{formatCurrency(itemPreview.oldPrice)}</span>
                  <span className="font-bold text-primary text-xs">{formatCurrency(itemPreview.newPrice)}</span>
                </div>
              ) : (
                <Input type="number" step="0.01" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} onBlur={() => { const numPrice = Math.round((Number(unitPrice) || 0) * 100) / 100; if (numPrice !== item.unit_price) onUpdate(item.id, 'unit_price', numPrice); setUnitPrice(String(numPrice)); }} onFocus={e => e.target.select()} />
              )}
            </TableCell>
            <TableCell className="text-right font-medium">
              {itemPreview ? formatCurrency(itemPreview.newTotal) : formatCurrency((Number(qty) || 0) * (Number(unitPrice) || 0))}
            </TableCell>
          </>
        ) : (
          <>
            <TableCell className="text-center text-muted-foreground">—</TableCell>
            <TableCell className="text-center text-muted-foreground">—</TableCell>
            <TableCell className="text-center text-muted-foreground">—</TableCell>
          </>
        )}
        {batchMode ? (
          <>
            <TableCell className="text-center text-xs">
              {isPriced ? (
                itemPreview ? (
                  <span className="text-amber-500">
                    {itemPreview.oldMarkup}→{itemPreview.newMarkup}{batchMarkupType === 'percentage' ? '%' : ''}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {(getFirstCluster(item)?.markup_percent ?? 0)}%
                  </span>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-right text-xs">
              {isPriced ? (
                itemPreview ? (
                  <span className="text-green-500 font-medium">
                    {formatCurrency(itemPreview.profit * item.qty)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {formatCurrency(calculateItemProfit(item))}
                  </span>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-center">
              {isPriced && (item.quote_item_clusters || []).length > 0 ? (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onToggleSelect?.(!!checked)}
                />
              ) : null}
            </TableCell>
          </>
        ) : (
          <>
            <TableCell>
              <QuoteItemAttachmentsCell
                quoteId={quoteId}
                itemId={item.id}
                version={attachmentsVersion}
                onItemAttachmentsChange={onItemAttachmentsChange}
              />
            </TableCell>
            <TableCell className="text-center">
              <div className="flex items-center justify-center gap-2">
                <Button variant="secondary" size="sm" className="px-3 py-1.5 relative" onClick={() => setDetailsOpen(true)}>
                  Details
                  {item.internal_notes && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500" title="Has internal notes" />
                  )}
                </Button>
                {isPriced && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-3 py-1.5"
                    title="Cutlist Calculator"
                    aria-label="Cutlist Calculator"
                    asChild
                  >
                    <Link href={`/quotes/${quoteId}/cutlist/${item.id}`}>
                      Cutlist
                    </Link>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  title="Duplicate item"
                  aria-label="Duplicate item"
                  onClick={() => onDuplicate(item.id)}
                  disabled={isDuplicating}
                >
                  {isDuplicating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="destructiveSoft"
                  size="icon"
                  className="h-8 w-8"
                  title="Delete item"
                  aria-label="Delete item"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </>
        )}
      </TableRow>
      {/* Item Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Item Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Customer-facing bullet points */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Bullet Points</div>
              <div className="text-xs text-muted-foreground">Visible on quote PDF (one per line)</div>
              <Textarea
                value={bpText}
                onChange={e => setBpText(e.target.value)}
                rows={4}
                placeholder={"e.g.\nSize: 2m x 3m\nMaterial: Solid wood\nFinish: Walnut"}
              />
            </div>

            {/* Internal notes - staff only */}
            <div className="space-y-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                Internal Notes
              </div>
              <div className="text-xs text-muted-foreground">Staff only - NOT visible on quote PDF</div>
              <Textarea
                value={internalNotes}
                onChange={e => setInternalNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Check stock with supplier, customer may want alternatives..."
                className="bg-background"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              onUpdate(item.id, 'bullet_points', bpText);
              onUpdate(item.id, 'internal_notes', internalNotes);
              setDetailsOpen(false);
            }}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
      {isPriced && isExpanded && displayClusters.map((cluster) => (
        <TableRow key={`${item.id}-cluster-${cluster.id}`}>
          <TableCell colSpan={batchMode ? 8 : 7} className="p-0">
            <QuoteItemClusterGrid
              cluster={cluster}
              onAddLine={onAddClusterLine}
              onUpdateLine={onUpdateClusterLine}
              onDeleteLine={onDeleteClusterLine}
              onUpdateCluster={onUpdateCluster}
              onUpdateItemPrice={(itemId, price) => onUpdate(itemId, 'unit_price', price)}
              itemId={item.id}
            />
          </TableCell>
        </TableRow>
      ))}
    </React.Fragment>
  );
}

// --- Main Table Component ---
export default function QuoteItemsTable({
  quoteId,
  items,
  onItemsChange,
  onRefresh,
  attachmentsVersion,
  onItemAttachmentsChange,
  expandedItemId,
  autoExpandItemId,
  onAutoExpandHandled,
}: Props) {
  const { toast } = useToast();
  const [showAddItemDialog, setShowAddItemDialog] = React.useState(false);
  const [duplicatingItemId, setDuplicatingItemId] = React.useState<string | null>(null);

  // Batch markup mode state
  const [batchMode, setBatchMode] = React.useState(false);
  const [selectedItemIds, setSelectedItemIds] = React.useState<Set<string>>(new Set());
  const [batchMarkupType, setBatchMarkupType] = React.useState<'percentage' | 'fixed'>('percentage');
  const [batchMarkupValue, setBatchMarkupValue] = React.useState<string>('');
  const [previewData, setPreviewData] = React.useState<Map<string, BatchPreviewItem> | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false);
  const [isApplyingBatch, setIsApplyingBatch] = React.useState(false);

  const eligibleBatchItems = React.useMemo(() => {
    return items.filter(item => {
      const isPriced = !item.item_type || item.item_type === 'priced';
      const hasCluster = (item.quote_item_clusters || []).length > 0;
      return isPriced && hasCluster;
    });
  }, [items]);

  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedItemIds(new Set());
    setBatchMarkupValue('');
    setBatchMarkupType('percentage');
    setPreviewData(null);
    setShowConfirmDialog(false);
  };

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItemIds(new Set(eligibleBatchItems.map(item => item.id)));
    } else {
      setSelectedItemIds(new Set());
    }
    setPreviewData(null);
  };

  const handleToggleItem = (itemId: string, checked: boolean) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
    setPreviewData(null);
  };

  const handlePreview = () => {
    const preview = new Map<string, BatchPreviewItem>();

    const markupValue = parseFloat(batchMarkupValue) || 0;

    for (const item of items) {
      if (!selectedItemIds.has(item.id)) continue;
      const cluster = getFirstCluster(item);
      if (!cluster) continue;

      const subtotal = calculateClusterSubtotal(cluster);
      const oldMarkup = cluster.markup_percent;
      const markupAmount = batchMarkupType === 'percentage'
        ? subtotal * (markupValue / 100)
        : markupValue;
      const newUnitPrice = roundCurrencyValue(subtotal + markupAmount);
      const newTotal = roundCurrencyValue(item.qty * newUnitPrice);
      const profit = roundCurrencyValue(markupAmount);

      preview.set(item.id, {
        oldPrice: item.unit_price,
        newPrice: newUnitPrice,
        newTotal,
        oldMarkup,
        newMarkup: markupValue,
        profit,
      });
    }

    setPreviewData(preview);
  };

  const handleApplyBatchMarkup = async () => {
    if (!previewData) return;
    setIsApplyingBatch(true);

    try {
      const markupValue = parseFloat(batchMarkupValue) || 0;
      const itemMap = new Map(items.map(i => [i.id, i]));
      const updates: Promise<unknown>[] = [];

      for (const [itemId, preview] of previewData.entries()) {
        const item = itemMap.get(itemId);
        if (!item) continue;
        const cluster = getFirstCluster(item);
        if (!cluster) continue;

        updates.push(
          updateQuoteItemCluster(cluster.id, { markup_percent: markupValue }),
          updateQuoteItem(itemId, {
            unit_price: preview.newPrice,
            total: preview.newTotal,
          }),
        );
      }

      await Promise.all(updates);

      const updatedItems = items.map(item => {
        const preview = previewData.get(item.id);
        if (!preview) return item;
        const cluster = getFirstCluster(item);
        return {
          ...item,
          unit_price: preview.newPrice,
          total: preview.newTotal,
          quote_item_clusters: item.quote_item_clusters?.map(c =>
            c.id === cluster?.id
              ? { ...c, markup_percent: markupValue }
              : c
          ),
        };
      });

      onItemsChange(updatedItems);
      toast({
        title: 'Markup updated',
        description: `Updated markup on ${previewData.size} item${previewData.size !== 1 ? 's' : ''}.`,
      });
      exitBatchMode();
    } catch (error) {
      console.error('Batch markup error:', error);
      toast({
        title: 'Error',
        description: 'Failed to apply batch markup. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsApplyingBatch(false);
    }
  };

  const batchPreviewTotals = React.useMemo(() => {
    if (!previewData) return null;

    let oldTotal = 0;
    let newTotal = 0;
    let totalProfit = 0;

    for (const item of items) {
      const isPriced = !item.item_type || item.item_type === 'priced';
      if (!isPriced) continue;

      const preview = previewData.get(item.id);
      if (preview) {
        oldTotal += roundCurrencyValue(item.qty * item.unit_price);
        newTotal += preview.newTotal;
        totalProfit += preview.profit * item.qty;
      } else {
        const itemTotal = roundCurrencyValue(item.qty * item.unit_price);
        oldTotal += itemTotal;
        newTotal += itemTotal;
        totalProfit += calculateItemProfit(item);
      }
    }

    return { oldTotal, newTotal, totalProfit };
  }, [previewData, items]);

  const handleAddItem = () => setShowAddItemDialog(true);

  const handleCreateManualItem = async ({ description, qty, unit_price }: { description: string; qty: number; unit_price: number }) => {
    const newItem = await createQuoteItem({ total: 0, quote_id: quoteId, description, qty, unit_price });
    onItemsChange([...items, newItem]);
  };

  const handleCreateTextItem = async ({ description, item_type, text_align }: { description: string; item_type: QuoteItemType; text_align: QuoteItemTextAlign }) => {
    // Create a non-priced item (heading or note) - no cluster will be created
    const newItem = await createQuoteItem({
      quote_id: quoteId,
      description,
      item_type,
      text_align,
      qty: 0,
      unit_price: 0,
      total: 0,
    });
    onItemsChange([...items, newItem]);
  };

  const handleCreateProductItem = async ({
    product_id,
    name,
    qty,
    explode,
    include_labour,
    include_overhead,
    attach_image,
    selected_options,
    bullet_points,
  }: {
    product_id: number;
    name: string;
    qty: number;
    explode: boolean;
    include_labour?: boolean;
    include_overhead?: boolean;
    attach_image?: boolean;
    selected_options?: ProductOptionSelection;
    bullet_points?: string | null;
  }) => {
    try {
      const optionSelections = selected_options ?? {};
      const optionPayload = Object.keys(optionSelections).length > 0 ? optionSelections : null;

      const newItem = await createQuoteItem({
        total: 0,
        quote_id: quoteId,
        description: name,
        qty,
        unit_price: 0,
        selected_options: optionPayload,
        bullet_points: bullet_points || null,
      });

      let newItemWithCluster = { ...newItem } as QuoteItem;
      let clusters = await fetchQuoteItemClusters(newItem.id);
      let targetCluster = clusters[0];
      if (!targetCluster) {
        targetCluster = await createQuoteItemCluster({ quote_item_id: newItem.id, name: 'Costing Cluster', position: 0 });
        clusters = [targetCluster];
      }

      if (explode) {
        // Prefer Effective BOM when available (includes linked sub-products)
        const bomPromise = (async () => {
          const eff = await fetchEffectiveBOM(product_id, optionSelections);
          if (Array.isArray(eff) && eff.length > 0) {
            const ids = eff.map(it => Number((it as any).component_id)).filter(Boolean);
            const components = await fetchComponentsByIds(ids);
            const map = new Map<number, string | undefined>();
            for (const c of components) map.set(Number(c.component_id), c.description || undefined);
            return eff.map(it => ({
              component_id: Number((it as any).component_id),
              quantity: Number((it as any).quantity_required || 1),
              unit_cost: (it as any)?.suppliercomponents?.price ?? null,
              description: map.get(Number((it as any).component_id)) || undefined,
            }));
          }
          return await fetchProductComponents(product_id, optionSelections);
        })();
        const laborPromise = include_labour === false ? Promise.resolve([]) : fetchProductLabor(product_id);
        const overheadPromise = include_overhead === false ? Promise.resolve([]) : fetchProductOverhead(product_id);
        const [bom, labor, overheadItems] = await Promise.all([bomPromise, laborPromise, overheadPromise]);

        const createdLines: QuoteClusterLine[] = [];

        // BOM component lines
        if (bom && bom.length > 0) {
          for (const pc of bom) {
            const line = await createQuoteClusterLine({
              cluster_id: targetCluster.id,
              line_type: 'component',
              description: pc.description ?? '',
              qty: (pc.quantity || 1) * (qty || 1),
              unit_cost: pc.unit_cost ?? null,
              component_id: pc.component_id,
              include_in_markup: true,
              sort_order: 0,
            });
            createdLines.push(line);
          }
        }

        // Labor (BOL) lines
        if (labor && (labor as any).length > 0) {
          for (const l of labor) {
            const time = Number(l.time_required || 0);
            const unit = (l.time_unit || 'hours') as 'hours' | 'minutes' | 'seconds';
            const hours = unit === 'hours' ? time : unit === 'minutes' ? time / 60 : time / 3600;
            const productMultiplier = qty || 1;
            const baseQty = Number(l.quantity || 1) * productMultiplier;
            const isPiece = l.pay_type === 'piece';
            const qtyLine = isPiece ? baseQty : baseQty * (hours || 0);
            const rate = isPiece ? (l.piece_rate ?? 0) : (l.hourly_rate ?? 0);
            const description = `Labour – ${l.category_name ? l.category_name + ' · ' : ''}${l.job_name ?? 'Job ' + l.job_id}`;
            const line = await createQuoteClusterLine({
              cluster_id: targetCluster.id,
              line_type: 'labor',
              description,
              qty: qtyLine,
              unit_cost: rate ?? 0,
              include_in_markup: true,
              labor_type: isPiece ? 'piece' : 'hourly',
              hours: isPiece ? null : Number(hours || 0),
              rate: rate ?? 0,
              sort_order: 0,
            } as any);
            createdLines.push(line);
          }
        }

        // Overhead lines (snapshot values at explosion time)
        if (overheadItems && overheadItems.length > 0) {
          // Compute material/labor subtotals for percentage-based overheads
          const materialsCost = createdLines
            .filter(l => l.line_type === 'component')
            .reduce((sum, l) => sum + (l.qty || 0) * (l.unit_cost || 0), 0);
          const laborCost = createdLines
            .filter(l => l.line_type === 'labor')
            .reduce((sum, l) => sum + (l.qty || 0) * (l.unit_cost || 0), 0);

          for (const oh of overheadItems) {
            const value = oh.override_value ?? oh.element.default_value;
            const ohQty = oh.quantity;
            let unitCost: number;

            if (oh.element.cost_type === 'fixed') {
              unitCost = value;
            } else {
              // Percentage type
              const basis =
                oh.element.percentage_basis === 'materials' ? materialsCost
                : oh.element.percentage_basis === 'labor' ? laborCost
                : materialsCost + laborCost; // 'total'
              unitCost = (basis * value / 100);
            }

            const description = `Overhead – ${oh.element.name} (${oh.element.code})`;
            const line = await createQuoteClusterLine({
              cluster_id: targetCluster.id,
              line_type: 'overhead',
              description,
              qty: ohQty * (qty || 1),
              unit_cost: Math.round(unitCost * 100) / 100,
              include_in_markup: true,
              sort_order: 0,
              overhead_element_id: oh.element.element_id,
              overhead_cost_type: oh.element.cost_type,
              overhead_percentage_basis: oh.element.percentage_basis,
            } as any);
            createdLines.push(line);
          }
        }

        if (createdLines.length === 0) {
          toast({ title: 'No BOM/BOL found', description: 'This product has no components, labour, or overhead. Item added without costing lines.' });
        } else {
          newItemWithCluster = {
            ...newItem,
            quote_item_clusters: [
              {
                ...targetCluster,
                quote_cluster_lines: createdLines,
              },
            ],
            selected_options: optionSelections,
          } as any;
        }
      }

      // Optionally attach product primary image as an item attachment
      if (attach_image) {
        try {
          const img = await fetchPrimaryProductImage(product_id);
          if (img?.url) {
            await createQuoteAttachmentFromUrl({
              quoteId: quoteId,
              quoteItemId: newItem.id,
              url: img.url,
              originalName: img.original_name || name,
              mimeType: 'image/*',
              displayInQuote: true,
            });
          }
        } catch (e) {
          console.warn('Attach product image failed (non-fatal):', e);
        }
      }

      onItemsChange([
        ...items,
        {
          ...newItemWithCluster,
          selected_options: optionSelections,
        } as QuoteItem,
      ]);
    } catch (e) {
      console.error('Failed to add product item:', e);
      toast({ variant: 'destructive', title: 'Failed to add product', description: (e as Error).message });
    }
  };

  // Helper function to ensure an item has a cluster
  const ensureItemHasCluster = async (itemId: string) => {
    try {
      const newCluster = await createQuoteItemCluster({
        quote_item_id: itemId,
        name: 'Costing Cluster',
        position: 0,
      });
      // Optimistically update local state to avoid full page reload
      const updatedItems = items.map(i => {
        if (i.id !== itemId) return i;
        const existingClusters = i.quote_item_clusters || [];
        return {
          ...i,
          quote_item_clusters: [...existingClusters, newCluster],
        } as QuoteItem;
      });
      onItemsChange(updatedItems);
      toast({ title: 'Cluster created', description: 'Added a Costing Cluster to this item.' });
    } catch (error) {
      console.error('Error creating cluster:', error);
    }
  };

  const handleUpdateItem = async (id: string, field: keyof Pick<QuoteItem, 'description' | 'qty' | 'unit_price' | 'bullet_points' | 'internal_notes'>, value: string | number) => {
    const originalItem = items.find((item) => item.id === id);
    if (!originalItem) return;

    const nextValue = typeof value === 'number' ? value : Number(value);
    const pricingCluster = field === 'unit_price' ? getDisplayClustersForItem(originalItem)[0] ?? null : null;
    const derivedMarkupPercent =
      field === 'unit_price' && Number.isFinite(nextValue)
        ? calculateMarkupPercentFromPrice(calculateClusterSubtotal(pricingCluster), nextValue)
        : null;

    const [updatedItem, updatedCluster] = await Promise.all([
      updateQuoteItem(id, { [field]: value }),
      pricingCluster && derivedMarkupPercent !== null
        ? updateQuoteItemCluster(pricingCluster.id, { markup_percent: derivedMarkupPercent })
        : Promise.resolve(null),
    ]);

    onItemsChange(items.map((item) => {
      if (item.id !== id) return item;

      return {
        ...item,
        ...updatedItem,
        quote_item_clusters: item.quote_item_clusters?.map((cluster) =>
          cluster.id === updatedCluster?.id
            ? { ...cluster, ...updatedCluster }
            : cluster
        ),
      };
    }));
  };

  const handleDeleteItem = async (id: string) => {
    await deleteQuoteItem(id);
    onItemsChange(items.filter(i => i.id !== id));
  };

  const handleDuplicateItem = async (id: string) => {
    setDuplicatingItemId(id);
    try {
      // Find the original item
      const originalItem = items.find(i => i.id === id);
      if (!originalItem) {
        toast({ variant: 'destructive', title: 'Error', description: 'Item not found' });
        setDuplicatingItemId(null);
        return;
      }

      // Create a new item with the same data
      // Skip default cluster creation since we'll duplicate clusters from the original
      let newItem;
      try {
        newItem = await createQuoteItem({
          quote_id: quoteId,
          description: originalItem.description,
          qty: originalItem.qty,
          unit_price: originalItem.unit_price,
          total: originalItem.total,
          item_type: originalItem.item_type,
          text_align: originalItem.text_align,
          bullet_points: originalItem.bullet_points,
          internal_notes: originalItem.internal_notes,
          selected_options: originalItem.selected_options,
        }, { skipDefaultCluster: true });
      } catch (error) {
        console.error('Failed to create item:', error);
        throw new Error('Failed to create new item: ' + (error as Error).message);
      }

      // Duplicate clusters and their lines if they exist
      const clustersToCreate = originalItem.quote_item_clusters || [];
      const newClusters: QuoteItemCluster[] = [];

      for (const originalCluster of clustersToCreate) {
        try {
          // Create a new cluster (only copy valid fields)
          const newCluster = await createQuoteItemCluster({
            quote_item_id: newItem.id,
            name: originalCluster.name,
            position: originalCluster.position,
            markup_percent: originalCluster.markup_percent,
            notes: originalCluster.notes,
          });

          // Duplicate all cluster lines
          const linesToCreate = originalCluster.quote_cluster_lines || [];
          const newLines: QuoteClusterLine[] = [];

          for (const originalLine of linesToCreate) {
            try {
              const newLine = await createQuoteClusterLine({
                cluster_id: newCluster.id,
                line_type: originalLine.line_type,
                description: originalLine.description,
                qty: originalLine.qty,
                unit_cost: originalLine.unit_cost,
                component_id: originalLine.component_id,
                supplier_component_id: originalLine.supplier_component_id,
                include_in_markup: originalLine.include_in_markup,
                sort_order: originalLine.sort_order,
                labor_type: originalLine.labor_type as any,
                hours: originalLine.hours,
                rate: originalLine.rate,
                cutlist_slot: originalLine.cutlist_slot,
                overhead_element_id: (originalLine as any).overhead_element_id,
                overhead_cost_type: (originalLine as any).overhead_cost_type,
                overhead_percentage_basis: (originalLine as any).overhead_percentage_basis,
              });
              newLines.push(newLine);
            } catch (error) {
              console.error('Failed to create cluster line:', error);
              throw new Error('Failed to create cluster line: ' + (error as Error).message);
            }
          }

          newClusters.push({
            ...newCluster,
            quote_cluster_lines: newLines,
          });
        } catch (error) {
          console.error('Failed to create cluster:', error);
          throw new Error('Failed to create cluster: ' + (error as Error).message);
        }
      }

      let duplicatedCutlistSnapshot = null;
      const originalCutlistSnapshot = await fetchQuoteItemCutlistSnapshot(id);
      if (originalCutlistSnapshot) {
        const duplicatedLineRefs = buildCutlistLineRefsFromLines(
          newClusters.flatMap((cluster) => cluster.quote_cluster_lines || [])
        );
        duplicatedCutlistSnapshot = await saveQuoteItemCutlistSnapshot(newItem.id, {
          optionsHash: originalCutlistSnapshot.options_hash ?? undefined,
          billingOverrides: cloneJsonValue(originalCutlistSnapshot.billing_overrides) ?? undefined,
          layout: cloneCutlistLayoutWithLineRefs(originalCutlistSnapshot.layout_json, duplicatedLineRefs),
        });
      }

      // Duplicate attachments
      try {
        const attachmentsToCreate = await fetchQuoteItemAttachments(quoteId, id);

        for (const originalAttachment of attachmentsToCreate) {
          try {
            await createQuoteAttachmentFromUrl({
              quoteId: quoteId,
              quoteItemId: newItem.id,
              url: originalAttachment.file_url,
              originalName: originalAttachment.original_name,
              mimeType: originalAttachment.mime_type,
              displayInQuote: originalAttachment.display_in_quote,
            });
          } catch (error) {
            console.warn('Failed to duplicate attachment (non-fatal):', error);
            // Continue with other attachments even if one fails
          }
        }
      } catch (error) {
        console.warn('Failed to fetch attachments (non-fatal):', error);
        // Continue without attachments
      }

      // Refresh all data from server to ensure UI is in sync
      if (onRefresh) {
        await onRefresh();
      } else {
        // Fallback: add the new item to the list with its clusters
        const newItemWithClusters: QuoteItem = {
          ...newItem,
          cutlist_snapshot: duplicatedCutlistSnapshot,
          quote_item_clusters: newClusters,
        };
        onItemsChange([...items, newItemWithClusters]);
      }

      toast({
        title: 'Item duplicated',
        description: 'The item and all its costing details have been copied successfully.'
      });
    } catch (error) {
      console.error('Error duplicating item:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        variant: 'destructive',
        title: 'Duplication failed',
        description: errorMessage
      });
    } finally {
      setDuplicatingItemId(null);
    }
  };

  const handleAddClusterLine = async (clusterId: string, component: {
    type: 'manual' | 'database' | 'product' | 'collection';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
    product_id?: number;
    explode?: boolean;
    include_labour?: boolean;
    collection_id?: number;
  }) => {
    try {
      if (component.type === 'product') {
        if (!component.product_id) return;
        // Phase 1: explode BOM by default (or when requested)
        if (component.explode !== false) {
          const bomPromise = fetchProductComponents(component.product_id);
          const laborPromise = component.include_labour === false ? Promise.resolve([]) : fetchProductLabor(component.product_id);
          const overheadPromise = fetchProductOverhead(component.product_id);
          const [bom, labor, clOverhead] = await Promise.all([bomPromise, laborPromise, overheadPromise]);
          const createdLines: QuoteClusterLine[] = [];

          // BOM component lines
          for (const pc of bom) {
            const line = await createQuoteClusterLine({
              cluster_id: clusterId,
              line_type: 'component',
              description: pc.description ?? '',
              qty: (pc.quantity || 1) * (component.qty || 1),
              unit_cost: pc.unit_cost ?? null,
              component_id: pc.component_id,
              include_in_markup: true,
              sort_order: 0,
            });
            createdLines.push(line);
          }

          // Labor (BOL) lines
          for (const l of labor as any[]) {
            const time = Number(l.time_required || 0);
            const unit = (l.time_unit || 'hours') as 'hours' | 'minutes' | 'seconds';
            const hours = unit === 'hours' ? time : unit === 'minutes' ? time / 60 : time / 3600;
            const productMultiplier = component.qty || 1;
            const baseQty = Number(l.quantity || 1) * productMultiplier;
            const isPiece = l.pay_type === 'piece';
            const qtyLine = isPiece ? baseQty : baseQty * (hours || 0);
            const rate = isPiece ? (l.piece_rate ?? 0) : (l.hourly_rate ?? 0);
            const description = `Labour – ${l.category_name ? l.category_name + ' · ' : ''}${l.job_name ?? 'Job ' + l.job_id}`;
            const line = await createQuoteClusterLine({
              cluster_id: clusterId,
              line_type: 'labor',
              description,
              qty: qtyLine,
              unit_cost: rate ?? 0,
              include_in_markup: true,
              labor_type: isPiece ? 'piece' : 'hourly',
              hours: isPiece ? null : Number(hours || 0),
              rate: rate ?? 0,
              sort_order: 0,
            } as any);
            createdLines.push(line);
          }

          // Overhead lines (snapshot values at explosion time)
          if (clOverhead && clOverhead.length > 0) {
            const materialsCost = createdLines
              .filter(l => l.line_type === 'component')
              .reduce((sum, l) => sum + (l.qty || 0) * (l.unit_cost || 0), 0);
            const laborCost = createdLines
              .filter(l => l.line_type === 'labor')
              .reduce((sum, l) => sum + (l.qty || 0) * (l.unit_cost || 0), 0);

            for (const oh of clOverhead) {
              const value = oh.override_value ?? oh.element.default_value;
              const ohQty = oh.quantity;
              let unitCost: number;

              if (oh.element.cost_type === 'fixed') {
                unitCost = value;
              } else {
                const basis =
                  oh.element.percentage_basis === 'materials' ? materialsCost
                  : oh.element.percentage_basis === 'labor' ? laborCost
                  : materialsCost + laborCost;
                unitCost = (basis * value / 100);
              }

              const ohDesc = `Overhead – ${oh.element.name} (${oh.element.code})`;
              const line = await createQuoteClusterLine({
                cluster_id: clusterId,
                line_type: 'overhead',
                description: ohDesc,
                qty: ohQty * (component.qty || 1),
                unit_cost: Math.round(unitCost * 100) / 100,
                include_in_markup: true,
                sort_order: 0,
                overhead_element_id: oh.element.element_id,
                overhead_cost_type: oh.element.cost_type,
                overhead_percentage_basis: oh.element.percentage_basis,
              } as any);
              createdLines.push(line);
            }
          }

          const updatedItems = items.map(item => {
            if (!item.quote_item_clusters) return item;
            const updatedClusters = item.quote_item_clusters.map(c => {
              if (c.id !== clusterId) return c;
              return {
                ...c,
                quote_cluster_lines: [...(c.quote_cluster_lines || []), ...createdLines],
              };
            });
            return { ...item, quote_item_clusters: updatedClusters };
          });
          onItemsChange(updatedItems);
        } else {
          console.warn('Product added with explode=false is not implemented at cluster level. Consider adding as top-level item.');
        }
      } else if (component.type === 'collection') {
        if (!component.collection_id) return;
        // Fetch the collection items via API and insert each as a component line
        const res = await fetch(`/api/collections/${component.collection_id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load costing cluster');
        const json = await res.json();
        const itemsInCollection = (json.items || []) as Array<{ component_id: number; quantity_required: number; supplier_component_id?: number | null; price?: number | null; components?: { description?: string } }>; 
        const createdLines: QuoteClusterLine[] = [];
        for (const row of itemsInCollection) {
          const line = await createQuoteClusterLine({
            cluster_id: clusterId,
            line_type: 'component',
            description: row.components?.description ?? '',
            qty: (row.quantity_required || 1) * (component.qty || 1),
            unit_cost: row.price ?? null,
            component_id: row.component_id,
            include_in_markup: true,
            sort_order: 0,
          });
          createdLines.push(line);
        }

        const updatedItems = items.map(item => {
          if (!item.quote_item_clusters) return item;
          const updatedClusters = item.quote_item_clusters.map(c => {
            if (c.id !== clusterId) return c;
            return {
              ...c,
              quote_cluster_lines: [...(c.quote_cluster_lines || []), ...createdLines],
            };
          });
          return { ...item, quote_item_clusters: updatedClusters };
        });
        onItemsChange(updatedItems);
      } else {
        const newLine = await createQuoteClusterLine({
          cluster_id: clusterId,
          line_type: component.type === 'database' ? 'component' : 'manual',
          description: component.description,
          qty: component.qty,
          unit_cost: component.unit_cost,
          component_id: component.component_id,
          include_in_markup: true,
          sort_order: 0,
        });

        // Optimistic UI update: add the new line to local state immediately
        const updatedItems = items.map(item => {
          if (item.quote_item_clusters) {
            const updatedClusters = item.quote_item_clusters.map(cluster => {
              if (cluster.id === clusterId) {
                return {
                  ...cluster,
                  quote_cluster_lines: [...(cluster.quote_cluster_lines || []), newLine]
                };
              }
              return cluster;
            });
            return { ...item, quote_item_clusters: updatedClusters };
          }
          return item;
        });
        
        onItemsChange(updatedItems);
      }
    } catch (error) {
      console.error('Error adding cluster line:', error);
      // Could show a toast notification here
    }
  };

  const handleUpdateClusterLine = async (id: string, updates: Partial<QuoteClusterLine>) => {
    const updatedLine = await updateQuoteClusterLine(id, updates);
    const newItems = items.map(item => ({
      ...item,
      quote_item_clusters: item.quote_item_clusters?.map(c => ({
        ...c,
        quote_cluster_lines: c.quote_cluster_lines?.map(l => l.id === id ? updatedLine : l)
      }))
    }));
    onItemsChange(newItems);
  };

  const handleDeleteClusterLine = async (id: string) => {
    await deleteQuoteClusterLine(id);
    const newItems = items.map(item => ({
      ...item,
      quote_item_clusters: item.quote_item_clusters?.map(c => ({
        ...c,
        quote_cluster_lines: c.quote_cluster_lines?.filter(l => l.id !== id)
      }))
    }));
    onItemsChange(newItems);
  };

  const handleMoveItem = async (id: string, direction: 'up' | 'down') => {
    const currentIndex = items.findIndex(item => item.id === id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    // Create new array with swapped positions
    const newItems = [...items];
    [newItems[currentIndex], newItems[newIndex]] = [newItems[newIndex], newItems[currentIndex]];

    // Optimistically update UI
    onItemsChange(newItems);

    // Persist the new order to the database
    try {
      await reorderQuoteItems(newItems.map(item => item.id));
    } catch (error) {
      console.error('Failed to save item order:', error);
      // Revert on failure
      onItemsChange(items);
      toast({
        variant: 'destructive',
        title: 'Reorder failed',
        description: 'Could not save the new order. Please try again.'
      });
    }
  };

  const handleUpdateCluster = async (clusterId: string, updates: Partial<QuoteItemCluster>) => {
    try {
      const updatedCluster = await updateQuoteItemCluster(clusterId, updates);
      const newItems = items.map(item => ({
        ...item,
        quote_item_clusters: item.quote_item_clusters?.map(c => 
          c.id === clusterId ? { ...c, ...updatedCluster } : c
        )
      }));
      onItemsChange(newItems);
    } catch (error) {
      console.error('Error updating cluster:', error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </div>
        <div className="flex items-center gap-2">
          {!batchMode && (
            <Button
              onClick={() => setBatchMode(true)}
              size="sm"
              variant="outline"
              className="border-primary/50 text-primary hover:bg-primary/10"
              disabled={eligibleBatchItems.length === 0}
            >
              Batch Markup
            </Button>
          )}
          {!batchMode && (
            <Button onClick={handleAddItem} size="sm" className="bg-primary hover:bg-primary/90">
              Add Item
            </Button>
          )}
        </div>
      </div>

      {batchMode && (
        <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-sm flex-wrap">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <Checkbox
              checked={selectedItemIds.size === eligibleBatchItems.length && eligibleBatchItems.length > 0}
              onCheckedChange={(checked) => handleToggleSelectAll(!!checked)}
            />
            All
          </label>
          <span className="text-muted-foreground text-xs">
            {selectedItemIds.size} of {eligibleBatchItems.length} selected
          </span>
          <span className="border-l border-border h-4" />
          <Select
            value={batchMarkupType}
            onValueChange={(v) => {
              setBatchMarkupType(v as 'percentage' | 'fixed');
              setPreviewData(null);
            }}
          >
            <SelectTrigger className="w-[90px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">%</SelectItem>
              <SelectItem value="fixed">R (fixed)</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            value={batchMarkupValue}
            onChange={(e) => {
              setBatchMarkupValue(e.target.value);
              setPreviewData(null);
            }}
            onFocus={(e) => e.target.select()}
            placeholder="0"
            className="w-20 h-7 text-xs"
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={selectedItemIds.size === 0 || batchMarkupValue === ''}
            onClick={previewData ? () => setShowConfirmDialog(true) : handlePreview}
          >
            {previewData ? 'Apply' : 'Preview'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
            onClick={exitBatchMode}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-20 text-center"></TableHead>
              <TableHead className="font-medium min-w-[250px]">Description</TableHead>
              <TableHead className="w-32 text-center font-medium">Qty</TableHead>
              <TableHead className="w-36 text-center font-medium">Unit Price</TableHead>
              <TableHead className="w-40 text-right font-medium">Total</TableHead>
              {batchMode ? (
                <>
                  <TableHead className="w-16 text-center font-medium text-primary">Markup</TableHead>
                  <TableHead className="w-28 text-right font-medium text-green-500">Profit</TableHead>
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      checked={selectedItemIds.size === eligibleBatchItems.length && eligibleBatchItems.length > 0}
                      onCheckedChange={(checked) => handleToggleSelectAll(!!checked)}
                    />
                  </TableHead>
                </>
              ) : (
                <>
                  <TableHead className="w-28 text-center font-medium">Attachments</TableHead>
                  <TableHead className="w-40 text-center font-medium">Actions</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <QuoteItemRow
                key={item.id}
                item={item}
                quoteId={quoteId}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
                onDuplicate={handleDuplicateItem}
                onMoveUp={(id) => handleMoveItem(id, 'up')}
                onMoveDown={(id) => handleMoveItem(id, 'down')}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                onAddClusterLine={handleAddClusterLine}
                onUpdateClusterLine={handleUpdateClusterLine}
                onDeleteClusterLine={handleDeleteClusterLine}
                onUpdateCluster={handleUpdateCluster}
                onEnsureCluster={ensureItemHasCluster}
                attachmentsVersion={attachmentsVersion}
                onItemAttachmentsChange={onItemAttachmentsChange}
                isDuplicating={duplicatingItemId === item.id}
                expandedItemId={expandedItemId}
                autoExpandItemId={autoExpandItemId}
                onAutoExpandHandled={onAutoExpandHandled}
                batchMode={batchMode}
                batchMarkupType={batchMarkupType}
                isSelected={selectedItemIds.has(item.id)}
                onToggleSelect={(checked) => handleToggleItem(item.id, checked)}
                previewData={previewData?.get(item.id) ?? null}
              />
            ))}
          </TableBody>
          {batchMode && batchPreviewTotals && (
            <tfoot>
              <tr className="border-t bg-muted/30">
                <td colSpan={4} className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                  Totals
                </td>
                <td className="px-4 py-2 text-right text-xs">
                  <span className="line-through text-muted-foreground">{formatCurrency(batchPreviewTotals.oldTotal)}</span>
                  {' '}
                  <span className="font-bold text-primary">{formatCurrency(batchPreviewTotals.newTotal)}</span>
                </td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-right text-xs font-medium text-green-500">
                  {formatCurrency(batchPreviewTotals.totalProfit)}
                </td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          )}
        </Table>
      </div>
      <AddQuoteItemDialog
        open={showAddItemDialog}
        onClose={() => setShowAddItemDialog(false)}
        onCreateManual={handleCreateManualItem}
        onCreateProduct={handleCreateProductItem}
        onCreateText={handleCreateTextItem}
      />
      <BatchMarkupConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        onConfirm={handleApplyBatchMarkup}
        selectedCount={previewData?.size ?? 0}
        markupValue={parseFloat(batchMarkupValue) || 0}
        markupType={batchMarkupType}
        oldTotal={batchPreviewTotals?.oldTotal ?? 0}
        newTotal={batchPreviewTotals?.newTotal ?? 0}
        isApplying={isApplyingBatch}
      />
    </div>
  );
}
