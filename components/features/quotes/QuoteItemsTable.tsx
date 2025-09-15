'use client';

import React from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  QuoteItem,
  QuoteItemCluster,
  QuoteClusterLine,
  createQuoteItem,
  updateQuoteItem,
  deleteQuoteItem,
  createQuoteItemCluster,
  updateQuoteItemCluster,
  createQuoteClusterLine,
  updateQuoteClusterLine,
  deleteQuoteClusterLine,
  fetchQuoteItemClusters,
  QuoteAttachment,
  uploadQuoteAttachment,
  fetchQuoteItemAttachments,
  deleteQuoteAttachment,
  Component,
  fetchComponents,
  fetchProductComponents,
  fetchProductLabor,
} from '@/lib/db/quotes';
import QuoteItemClusterGrid from './QuoteItemClusterGrid';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Paperclip, FileText, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import InlineAttachmentsCell from './InlineAttachmentsCell';
import AddQuoteItemDialog from './AddQuoteItemDialog';
import { createQuoteAttachmentFromUrl, fetchPrimaryProductImage } from '@/lib/db/quotes';

interface Props {
  quoteId: string;
  items: QuoteItem[];
  onItemsChange: (items: QuoteItem[]) => void;
  attachmentsVersion?: number; // bump to force cells to refresh their local attachments
}

// --- Attachments Cell Component ---
interface QuoteItemAttachmentsCellProps {
  quoteId: string;
  itemId: string;
  version?: number;
}

function QuoteItemAttachmentsCell({ quoteId, itemId, version }: QuoteItemAttachmentsCellProps) {
  const [attachments, setAttachments] = React.useState<QuoteAttachment[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  const { toast } = useToast();
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewAtt, setPreviewAtt] = React.useState<QuoteAttachment | null>(null);
  const dropRef = React.useRef<HTMLDivElement | null>(null);

  const fetchAttachments = React.useCallback(async () => {
    try {
      const data = await fetchQuoteItemAttachments(quoteId, itemId);
      setAttachments(data);
    } catch (error) {
      console.error('Fetch attachments error:', error);
    }
  }, [quoteId, itemId]);

  React.useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments, version]);

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setIsUploading(true);
    try {
      await Promise.all(acceptedFiles.map(file => uploadQuoteAttachment(file, quoteId, itemId)));
      await fetchAttachments();
      toast({ title: 'Uploaded attachments', description: `${acceptedFiles.length} file(s) uploaded successfully.` });
    } catch (error) {
      console.error('Item upload error:', error);
      toast({ variant: 'destructive', title: 'Upload failed', description: (error as Error).message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    try {
      await deleteQuoteAttachment(id);
      fetchAttachments();
    } catch (error) {
      console.error('Delete attachment error:', error);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true, disabled: isUploading });

  const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = async (e) => {
    if (isUploading) return;
    const items = Array.from(e.clipboardData?.items || []);
    const blobs: File[] = items.map(item => item.getAsFile()).filter((file): file is File => file !== null);
    if (blobs.length > 0) {
      e.preventDefault();
      await onDrop(blobs);
      dropRef.current?.focus();
    }
  };

  return (
    <InlineAttachmentsCell quoteId={quoteId} itemId={itemId} version={version} />
  );
}

// --- Quote Item Row Component (with expandable cluster) ---
function QuoteItemRow({
  item,
  quoteId,
  onUpdate,
  onDelete,
  onAddClusterLine,
  onUpdateClusterLine,
  onDeleteClusterLine,
  onUpdateCluster,
  onEnsureCluster,
  attachmentsVersion,
}: {
  item: QuoteItem;
  quoteId: string;
  onUpdate: (id: string, field: keyof Pick<QuoteItem, 'description' | 'qty' | 'unit_price' | 'bullet_points'>, value: string | number) => void;
  onDelete: (id: string) => void;
  onAddClusterLine: (clusterId: string, component: {
    type: 'manual' | 'database';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
  }) => void;
  onUpdateClusterLine: (id: string, updates: Partial<QuoteClusterLine>) => void;
  onDeleteClusterLine: (id: string) => void;
  onUpdateCluster: (clusterId: string, updates: Partial<QuoteItemCluster>) => void;
  onEnsureCluster: (itemId: string) => void;
  attachmentsVersion?: number;
}) {
  const [desc, setDesc] = React.useState(item.description);
  const [qty, setQty] = React.useState(item.qty);
  const [unitPrice, setUnitPrice] = React.useState(item.unit_price);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [bpText, setBpText] = React.useState<string>(item.bullet_points || '');

  React.useEffect(() => { setDesc(item.description); }, [item.description]);
  React.useEffect(() => { setQty(item.qty); }, [item.qty]);
  React.useEffect(() => { setUnitPrice(item.unit_price); }, [item.unit_price]);
  React.useEffect(() => { setBpText(item.bullet_points || ''); }, [item.bullet_points]);

  const cluster = item.quote_item_clusters?.[0];

  return (
    <React.Fragment>
      <TableRow key={item.id}>
        <TableCell>
          {cluster ? (
            <Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? '▼' : '▶'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onEnsureCluster(item.id)}>
              + Cluster
            </Button>
          )}
        </TableCell>
        <TableCell><Input value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => { if (desc !== item.description) onUpdate(item.id, 'description', desc); }} onFocus={e => e.target.select()} /></TableCell>
        <TableCell><Input type="number" value={qty} onChange={e => setQty(Number(e.target.value) || 0)} onBlur={() => { if (qty !== item.qty) onUpdate(item.id, 'qty', qty); }} onFocus={e => e.target.select()} /></TableCell>
        <TableCell><Input type="number" value={unitPrice} onChange={e => setUnitPrice(Number(e.target.value) || 0)} onBlur={() => { if (unitPrice !== item.unit_price) onUpdate(item.id, 'unit_price', unitPrice); }} onFocus={e => e.target.select()} /></TableCell>
        <TableCell>{(qty * unitPrice).toFixed(2)}</TableCell>
        <TableCell><QuoteItemAttachmentsCell quoteId={quoteId} itemId={item.id} version={attachmentsVersion} /></TableCell>
        <TableCell className="text-center">
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" className="px-3 py-1.5" onClick={() => setDetailsOpen(true)}>
              Details
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
      </TableRow>
      {/* Item Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Item Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Bullet points (one per line)</div>
            <Textarea
              value={bpText}
              onChange={e => setBpText(e.target.value)}
              rows={6}
              placeholder={"e.g.\nSize: 2m x 3m\nMaterial: Solid wood\nFinish: Walnut"}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>Cancel</Button>
            <Button onClick={() => { onUpdate(item.id, 'bullet_points', bpText); setDetailsOpen(false); }}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
      {isExpanded && cluster && (
        <TableRow key={`${item.id}-cluster`}>
          <TableCell colSpan={7} className="p-0">
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
      )}
    </React.Fragment>
  );
}

// --- Main Table Component ---
export default function QuoteItemsTable({ quoteId, items, onItemsChange, attachmentsVersion }: Props) {
  const { toast } = useToast();
  const [showAddItemDialog, setShowAddItemDialog] = React.useState(false);

  const handleAddItem = () => setShowAddItemDialog(true);

  const handleCreateManualItem = async ({ description, qty, unit_price }: { description: string; qty: number; unit_price: number }) => {
    const newItem = await createQuoteItem({ total: 0, quote_id: quoteId, description, qty, unit_price });
    onItemsChange([...items, newItem]);
  };

  const handleCreateProductItem = async ({ product_id, name, qty, explode, include_labour, attach_image }: { product_id: number; name: string; qty: number; explode: boolean; include_labour?: boolean; attach_image?: boolean }) => {
    try {
      const newItem = await createQuoteItem({ total: 0, quote_id: quoteId, description: name, qty, unit_price: 0 });

      let newItemWithCluster = { ...newItem } as QuoteItem;
      let clusters = await fetchQuoteItemClusters(newItem.id);
      let targetCluster = clusters[0];
      if (!targetCluster) {
        targetCluster = await createQuoteItemCluster({ quote_item_id: newItem.id, name: 'Costing Cluster', position: 0 });
        clusters = [targetCluster];
      }

      if (explode) {
        const bomPromise = fetchProductComponents(product_id);
        const laborPromise = include_labour === false ? Promise.resolve([]) : fetchProductLabor(product_id);
        const [bom, labor] = await Promise.all([bomPromise, laborPromise]);

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

        if (createdLines.length === 0) {
          toast({ title: 'No BOM/BOL found', description: 'This product has no components or labour. Item added without costing lines.' });
        } else {
          newItemWithCluster = {
            ...newItem,
            quote_item_clusters: [
              {
                ...targetCluster,
                quote_cluster_lines: createdLines,
              },
            ],
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

      onItemsChange([...items, newItemWithCluster]);
    } catch (e) {
      console.error('Failed to add product item:', e);
      toast({ variant: 'destructive', title: 'Failed to add product', description: (e as Error).message });
    }
  };

  // Helper function to ensure an item has a cluster
  const ensureItemHasCluster = async (itemId: string) => {
    try {
      await createQuoteItemCluster({
        quote_item_id: itemId,
        name: 'Costing Cluster',
        position: 0,
      });
      // Trigger a refresh of the quote data
      window.location.reload();
    } catch (error) {
      console.error('Error creating cluster:', error);
    }
  };

  const handleUpdateItem = async (id: string, field: keyof Pick<QuoteItem, 'description' | 'qty' | 'unit_price' | 'bullet_points'>, value: string | number) => {
    const updated = await updateQuoteItem(id, { [field]: value });
    onItemsChange(items.map(i => (i.id === id ? { ...i, ...updated } : i)));
  };

  const handleDeleteItem = async (id: string) => {
    await deleteQuoteItem(id);
    onItemsChange(items.filter(i => i.id !== id));
  };

  const handleAddClusterLine = async (clusterId: string, component: {
    type: 'manual' | 'database' | 'product';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
    product_id?: number;
    explode?: boolean;
    include_labour?: boolean;
  }) => {
    try {
      if (component.type === 'product') {
        if (!component.product_id) return;
        // Phase 1: explode BOM by default (or when requested)
        if (component.explode !== false) {
          const bomPromise = fetchProductComponents(component.product_id);
          const laborPromise = component.include_labour === false ? Promise.resolve([]) : fetchProductLabor(component.product_id);
          const [bom, labor] = await Promise.all([bomPromise, laborPromise]);
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
        <Button onClick={handleAddItem} size="sm" className="bg-primary hover:bg-primary/90">
          Add Item
        </Button>
      </div>
      
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12 text-center"></TableHead>
              <TableHead className="w-1/3 font-medium">Description</TableHead>
              <TableHead className="w-20 text-center font-medium">Qty</TableHead>
              <TableHead className="w-24 text-center font-medium">Unit Price</TableHead>
              <TableHead className="w-24 text-center font-medium">Total</TableHead>
              <TableHead className="w-28 text-center font-medium">Attachments</TableHead>
              <TableHead className="w-20 text-center font-medium">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <QuoteItemRow
                key={item.id}
                item={item}
                quoteId={quoteId}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
                onAddClusterLine={handleAddClusterLine}
                onUpdateClusterLine={handleUpdateClusterLine}
                onDeleteClusterLine={handleDeleteClusterLine}
                onUpdateCluster={handleUpdateCluster}
                onEnsureCluster={ensureItemHasCluster}
                attachmentsVersion={attachmentsVersion}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <AddQuoteItemDialog
        open={showAddItemDialog}
        onClose={() => setShowAddItemDialog(false)}
        onCreateManual={handleCreateManualItem}
        onCreateProduct={handleCreateProductItem}
      />
    </div>
  );
}
