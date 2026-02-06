'use client';

/**
 * Orders Page
 *
 * URL-based filter persistence for navigating back from detail pages.
 * Filters stored: status, q (search), section
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebounce } from '@/hooks/use-debounce';
import { format, parseISO, isValid, isBefore, isAfter } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Order, OrderStatus } from '@/types/orders';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PlusCircle, Search, Package, Layers, Wrench, PaintBucket, Paperclip,
  Upload, FileText, ImageIcon, Eye, Download, FileUp, Check, RefreshCw,
  Trash2, ChevronRight, ChevronLeft, MoreHorizontal, ArrowUp, ArrowDown,
  ArrowUpDown, Calendar as CalendarIcon, FilterX,
} from 'lucide-react';
import { AttachmentPreviewModal } from '@/components/ui/attachment-preview-modal';
import { FileIcon } from '@/components/ui/file-icon';
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Fetch orders with status and customer information
async function fetchOrders(statusFilter?: string, searchQuery?: string): Promise<Order[]> {
  try {
    let query = supabase
      .from('orders')
      .select(`
        *,
        status:order_statuses(status_id, status_name),
        customer:customers(*),
        details:order_details(
          *,
          product:products(*)
        )
      `)
      .order('created_at', { ascending: false });

    // Apply status filter if provided
    if (statusFilter && statusFilter !== 'all') {
      const { data: statusData } = await supabase
        .from('order_statuses')
        .select('status_id')
        .eq('status_name', statusFilter)
        .single();

      if (statusData?.status_id) {
        query = query.eq('status_id', statusData.status_id);
      }
    }

    // Apply search filter if provided
    if (searchQuery && searchQuery.trim() !== '') {
      const searchTerm = searchQuery.trim().toLowerCase();

      // Get customers that match the search query
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .ilike('name', `%${searchTerm}%`);

      const customerIds = customers?.map(c => c.id) || [];

      // Build the filter conditions
      const conditions = [];

      // Add customer filter if we found matching customers
      if (customerIds.length > 0) {
        conditions.push(`customer_id.in.(${customerIds.join(',')})`);
      }

      // Add order number filter
      conditions.push(`order_number.ilike.%${searchTerm}%`);

      // Add order ID filter if the search term is a number
      if (!isNaN(parseInt(searchTerm))) {
        conditions.push(`order_id.eq.${parseInt(searchTerm)}`);
      }

      // Combine all conditions with OR
      if (conditions.length > 0) {
        query = query.or(conditions.join(','));
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching orders:', error);
      throw new Error('Failed to fetch orders');
    }

    // Transform the data to ensure proper structure
    return (data || []).map(order => ({
      ...order,
      status: order.status && order.status.length > 0
        ? {
            status_id: order.status[0]?.status_id || 0,
            status_name: order.status[0]?.status_name || 'Unknown'
          }
        : { status_id: 0, status_name: 'Unknown' },
      total_amount: order.total_amount ? Number(order.total_amount) : null,
      details: order.details || []
    }));
  } catch (error) {
    console.error('Error in fetchOrders:', error);
    return [];
  }
}

// Fetch all order statuses
async function fetchOrderStatuses(): Promise<OrderStatus[]> {
  try {
    const { data, error } = await supabase
      .from('order_statuses')
      .select('*');

    if (error) {
      console.error('Error fetching order statuses:', error);
      throw new Error('Failed to fetch order statuses');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderStatuses:', error);
    return [];
  }
}

// Status Badge component with dark-mode-aware colors
function StatusBadge({ status }: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'new':
        return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/25';
      case 'in progress':
        return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border border-yellow-500/25';
      case 'completed':
        return 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/25';
      case 'cancelled':
        return 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/25';
      default:
        return 'bg-muted text-muted-foreground border border-border';
    }
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
      {status}
    </span>
  );
}

// Add function to determine product sections
function determineProductSections(product: any): string[] {
  const sections: string[] = [];

  if (product?.name?.toLowerCase().includes('chair') ||
      product?.description?.toLowerCase().includes('upholstery')) {
    sections.push('chair');
  }
  if (product?.description?.toLowerCase().includes('wood')) {
    sections.push('wood');
  }
  if (product?.description?.toLowerCase().includes('steel')) {
    sections.push('steel');
  }
  if (product?.description?.toLowerCase().includes('powder') ||
      product?.description?.toLowerCase().includes('coating')) {
    sections.push('powdercoating');
  }

  return sections;
}

// Function to list files in QButton bucket for a customer
async function listCustomerFiles(customerId: string | number) {
  if (!customerId) return [];

  try {
    const { data, error } = await supabase
      .storage
      .from('qbutton')
      .list(`Orders/Customer/${customerId}`);

    if (error) {
      console.error('Error listing files:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in listCustomerFiles:', error);
    return [];
  }
}

// Function to fetch attachments from order_attachments table
async function fetchOrderAttachments(orderId: number) {
  if (!orderId) return [];

  try {
    const { data, error } = await supabase
      .from('order_attachments')
      .select('*')
      .eq('order_id', orderId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Error fetching attachments:', error);
      throw new Error('Failed to fetch attachments');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderAttachments:', error);
    return [];
  }
}

// Upload Attachments Dialog Component
function UploadAttachmentDialog({ order, onSuccess }: { order: Order, onSuccess: () => void }): JSX.Element {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Handle file from any source (input, paste, or drop)
  const handleFile = (file: File) => {
    setSelectedFile(file);
    if (!displayName) {
      const nameParts = file.name.split('.');
      if (nameParts.length > 1) {
        setDisplayName(nameParts.slice(0, -1).join('.'));
      } else {
        setDisplayName(file.name);
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFile(file);
          break;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !order.order_id) return;

    setIsUploading(true);
    try {
      const timestamp = new Date().getTime();
      const randomStr = Math.random().toString(36).substring(2, 10);
      const fileExt = selectedFile.name.split('.').pop() || 'file';
      const fileName = `${order.order_number || order.order_id}_${timestamp}_${randomStr}.${fileExt}`;
      const filePath = `Orders/Customer/${order.customer?.id}/${fileName}`;

      const fileOptions = {
        cacheControl: '3600',
        contentType: selectedFile.type || undefined,
        upsert: false
      };

      const { error: uploadError } = await supabase.storage
        .from('qbutton')
        .upload(filePath, selectedFile, fileOptions);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('qbutton')
        .getPublicUrl(filePath);

      const { error: dbError } = await supabase
        .from('order_attachments')
        .insert({
          order_id: order.order_id,
          file_name: displayName || selectedFile.name,
          file_url: publicUrl,
          uploaded_at: new Date().toISOString(),
          file_type: fileExt
        });

      if (dbError) {
        await supabase.storage
          .from('qbutton')
          .remove([filePath]);
        throw dbError;
      }

      setSelectedFile(null);
      setDisplayName('');
      onSuccess();

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={`p-4 border-2 border-dashed rounded-lg bg-card transition-colors ${
        isDragOver ? 'border-primary bg-primary/5' : 'border-muted'
      }`}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="text-center text-sm text-muted-foreground mb-4">
        Drag & drop a file here, or paste from clipboard (Ctrl+V / Cmd+V)
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <input
          type="text"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onPaste={handlePaste}
          className="flex-1 px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
        />
        <input
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          className="hidden"
          id="attachment-upload"
        />
        <label
          htmlFor="attachment-upload"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <FileUp className="h-4 w-4" />
          Choose File
        </label>
        <button
          onClick={handleUpload}
          disabled={isUploading || !selectedFile}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="h-4 w-4" />
          {isUploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {selectedFile && (
        <div className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
          <Check className="h-4 w-4 text-green-500" />
          <span>Selected: {selectedFile.name}</span>
        </div>
      )}
    </div>
  );
}

// Custom AttachmentDialog component that provides a visible refresh button
function AttachmentModalWithRefresh({
  isOpen,
  onClose,
  attachments,
  orderNumber
}: {
  isOpen: boolean;
  onClose: () => void;
  attachments: any[];
  orderNumber: string
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader className="relative">
          <div className="flex items-center justify-between">
            <DialogTitle>Order {orderNumber} - Attachments</DialogTitle>
            <button
              onClick={handleRefresh}
              className="bg-primary text-white px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors hover:bg-primary/90 shadow-sm"
              title="Refresh thumbnails"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="text-sm">Refresh</span>
            </button>
          </div>

          {isRefreshing && (
            <div className="absolute top-full left-0 right-0 flex justify-center">
              <div className="mt-2 bg-black/70 text-white text-xs py-1 px-2 rounded">
                Refreshing thumbnails...
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="max-h-[80vh] overflow-y-auto mt-6">
          <div key={`attachment-content-${refreshKey}`}>
            {attachments.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {attachments.map((attachment, index) => {
                  if (!attachment || !attachment.file_name || !attachment.file_url) {
                    return null;
                  }

                  const key = `${attachment.attachment_id || attachment.id || `attachment-${index}`}-${refreshKey}`;
                  const fileExt = attachment.file_name.split('.').pop()?.toLowerCase() || '';
                  const isPdf = fileExt === 'pdf';
                  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt);

                  return (
                    <div
                      key={key}
                      className="p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
                    >
                      <div>
                        {isPdf ? (
                          <div className="mb-3 aspect-[3/4] border rounded overflow-hidden bg-muted/30 flex items-center justify-center relative">
                            <PdfThumbnailClient
                              key={`pdf-${key}`}
                              url={attachment.file_url}
                              width={240}
                              height={320}
                              className="w-full h-full"
                            />
                            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/50 to-transparent p-2">
                              <p className="text-xs text-white truncate">{attachment.file_name}</p>
                            </div>
                          </div>
                        ) : isImage ? (
                          <div className="mb-3 aspect-[3/4] border rounded overflow-hidden bg-muted flex items-center justify-center relative">
                            <div className="w-full h-full flex items-center justify-center p-3">
                              <div className="relative w-full h-full flex items-center justify-center">
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin" />
                                </div>
                                <img
                                  key={`img-${key}`}
                                  src={attachment.file_url}
                                  alt={attachment.file_name}
                                  className="max-w-full max-h-full object-contain z-10"
                                  style={{ maxHeight: '100%' }}
                                  onLoad={(e) => {
                                    const target = e.currentTarget;
                                    const container = target.closest('.relative');
                                    const spinner = container?.querySelector('.animate-spin')?.parentElement;
                                    if (spinner) {
                                      (spinner as HTMLElement).style.display = 'none';
                                    }
                                  }}
                                  onError={(e) => {
                                    const target = e.currentTarget;
                                    target.style.display = 'none';
                                    const container = target.closest('.relative');
                                    if (container) {
                                      const spinner = container.querySelector('.animate-spin')?.parentElement;
                                      if (spinner) {
                                        (spinner as HTMLElement).style.display = 'none';
                                      }
                                      const fallback = document.createElement('div');
                                      fallback.className = 'flex items-center justify-center h-full w-full';
                                      fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-primary"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                                      container.appendChild(fallback);
                                    }
                                  }}
                                />
                              </div>
                            </div>
                            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/60 to-transparent p-2 z-20">
                              <p className="text-xs text-white truncate">{attachment.file_name}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="mb-3 aspect-[3/4] border rounded overflow-hidden bg-muted/30 flex items-center justify-center relative">
                            <FileIcon
                              fileName={attachment.file_name}
                              size={48}
                            />
                            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/50 to-transparent p-2">
                              <p className="text-xs text-white truncate">{attachment.file_name}</p>
                            </div>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">{attachment.file_name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {attachment.uploaded_at ? new Date(attachment.uploaded_at).toLocaleDateString() : 'Unknown date'}
                          </p>
                          <p className="text-xs text-muted-foreground uppercase">
                            {attachment.file_type || fileExt.toUpperCase() || 'UNKNOWN'}
                          </p>
                        </div>

                        <div className="mt-3 flex gap-2">
                          <a
                            href={attachment.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs flex items-center gap-1 text-primary hover:underline"
                          >
                            <Eye className="h-3 w-3" />
                            Preview
                          </a>
                          <a
                            href={attachment.file_url}
                            download={attachment.file_name}
                            className="text-xs flex items-center gap-1 text-primary hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            Download
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10 px-6 border rounded-lg bg-muted/10">
                <p className="text-muted-foreground">No attachments available for this order.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Compact Order Attachments Component for the table cell with hover preview
function OrderAttachments({ order }: { order: Order }): JSX.Element {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: attachments = [] } = useQuery({
    queryKey: ['orderAttachments', order.order_id],
    queryFn: () => fetchOrderAttachments(order.order_id),
    enabled: !!order.order_id,
  });

  const handleUploadSuccess = () => {
    setIsUploadDialogOpen(false);
    queryClient.invalidateQueries({ queryKey: ['orderAttachments', order.order_id] });
  };

  return (
    <>
      <TableCell className="text-center align-middle">
        <div className="inline-flex items-center gap-1">
          {attachments.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="font-medium">{attachments.length}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 p-3"
                align="center"
                side="left"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {attachments.length} file{attachments.length === 1 ? '' : 's'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(order)}
                      className="text-xs text-primary hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {attachments.map((att, idx) => {
                      const ext = att.file_name?.split('.').pop()?.toLowerCase() || '';
                      const isPdf = ext === 'pdf';
                      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
                      return (
                        <a
                          key={att.id || idx}
                          href={att.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
                        >
                          {isPdf ? (
                            <div className="w-8 h-10 flex-shrink-0 rounded border bg-white overflow-hidden">
                              <PdfThumbnailClient url={att.file_url} width={32} height={40} className="w-full h-full" />
                            </div>
                          ) : isImage ? (
                            <div className="w-8 h-10 flex-shrink-0 rounded border bg-muted overflow-hidden">
                              <img src={att.file_url} alt="" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-8 h-10 flex-shrink-0 rounded border bg-muted flex items-center justify-center">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">{att.file_name}</p>
                            <p className="text-xs text-muted-foreground uppercase">{ext}</p>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsUploadDialogOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/50 transition-colors opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground"
            title="Upload attachment"
            aria-label="Upload attachment"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </TableCell>

      {selectedOrder && (
        <AttachmentModalWithRefresh
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          attachments={attachments}
          orderNumber={selectedOrder.order_number || `#${selectedOrder.order_id}`}
        />
      )}

      {isUploadDialogOpen && (
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Upload Attachment</DialogTitle>
              <DialogDescription>
                Upload an attachment for order {order.order_number || `#${order.order_id}`}
              </DialogDescription>
            </DialogHeader>
            <UploadAttachmentDialog
              order={order}
              onSuccess={handleUploadSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// Sort field type
type SortField = 'order_number' | 'customer' | 'created_at' | 'delivery_date' | 'total_amount' | 'status';

// Sortable column header component
function SortableHeader({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
  className = ''
}: {
  label: string;
  field: SortField;
  sortField: SortField | null;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  className?: string;
}) {
  return (
    <TableHead className={`font-semibold ${className}`}>
      <button
        onClick={onSort.bind(null, field)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        {sortField === field ? (
          sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Initialize ALL state from URL parameters for full navigation persistence
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams?.get('status') || 'all');
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams?.get('q') || '');
  const [activeSection, setActiveSection] = useState<string | null>(() => searchParams?.get('section') || null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pagination state - restored from URL
  const [currentPage, setCurrentPage] = useState(() => {
    const p = parseInt(searchParams?.get('page') || '');
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [pageSize, setPageSize] = useState(() => {
    const ps = parseInt(searchParams?.get('pageSize') || '');
    return [10, 25, 50, 100].includes(ps) ? ps : 25;
  });
  const pageSizeOptions = [10, 25, 50, 100];

  // Sort state - restored from URL
  const [sortField, setSortField] = useState<SortField | null>(() => {
    const sf = searchParams?.get('sort') as SortField | null;
    const validFields: SortField[] = ['order_number', 'customer', 'created_at', 'delivery_date', 'total_amount', 'status'];
    return sf && validFields.includes(sf) ? sf : null;
  });
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    const sd = searchParams?.get('sortDir');
    return sd === 'desc' ? 'desc' : 'asc';
  });

  // Date range filter state - restored from URL
  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    const d = searchParams?.get('dateFrom');
    if (d) { const parsed = new Date(d); return isValid(parsed) ? parsed : undefined; }
    return undefined;
  });
  const [endDate, setEndDate] = useState<Date | undefined>(() => {
    const d = searchParams?.get('dateTo');
    if (d) { const parsed = new Date(d); return isValid(parsed) ? parsed : undefined; }
    return undefined;
  });

  // Debounce search input to avoid excessive URL/API updates
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Re-read URL params when navigating back (component doesn't remount)
  const searchParamsString = searchParams?.toString() || '';
  useEffect(() => {
    const urlStatus = searchParams?.get('status') || 'all';
    const urlQuery = searchParams?.get('q') || '';
    const urlSection = searchParams?.get('section') || null;
    const urlPage = parseInt(searchParams?.get('page') || '');
    const urlPageSize = parseInt(searchParams?.get('pageSize') || '');
    const urlSort = searchParams?.get('sort') as SortField | null;
    const urlSortDir = searchParams?.get('sortDir');
    const urlDateFrom = searchParams?.get('dateFrom');
    const urlDateTo = searchParams?.get('dateTo');

    if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
    if (urlQuery !== searchQuery) setSearchQuery(urlQuery);
    if (urlSection !== activeSection) setActiveSection(urlSection);
    if (!isNaN(urlPage) && urlPage >= 1 && urlPage !== currentPage) setCurrentPage(urlPage);
    if ([10, 25, 50, 100].includes(urlPageSize) && urlPageSize !== pageSize) setPageSize(urlPageSize);
    if (urlSort !== sortField) setSortField(urlSort && ['order_number', 'customer', 'created_at', 'delivery_date', 'total_amount', 'status'].includes(urlSort) ? urlSort : null);
    if ((urlSortDir === 'desc' ? 'desc' : 'asc') !== sortDirection) setSortDirection(urlSortDir === 'desc' ? 'desc' : 'asc');
    if (urlDateFrom) { const d = new Date(urlDateFrom); if (isValid(d)) setStartDate(d); } else { setStartDate(undefined); }
    if (urlDateTo) { const d = new Date(urlDateTo); if (isValid(d)) setEndDate(d); } else { setEndDate(undefined); }
  }, [searchParamsString]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build URL from all filter/pagination/sort state
  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (activeSection) params.set('section', activeSection);
    if (currentPage > 1) params.set('page', String(currentPage));
    if (pageSize !== 25) params.set('pageSize', String(pageSize));
    if (sortField) params.set('sort', sortField);
    if (sortField && sortDirection === 'desc') params.set('sortDir', 'desc');
    if (startDate && isValid(startDate)) params.set('dateFrom', format(startDate, 'yyyy-MM-dd'));
    if (endDate && isValid(endDate)) params.set('dateTo', format(endDate, 'yyyy-MM-dd'));
    const q = params.toString();
    return q ? `/orders?${q}` : '/orders';
  }, [statusFilter, debouncedSearch, activeSection, currentPage, pageSize, sortField, sortDirection, startDate, endDate]);

  // Sync all state to URL
  useEffect(() => {
    const newUrl = buildUrl();
    const currentUrl = `/orders${searchParams?.toString() ? '?' + searchParams.toString() : ''}`;
    if (newUrl !== currentUrl) {
      router.replace(newUrl, { scroll: false });
    }
  }, [buildUrl, router, searchParams]);

  // Track previous filter values to know when to reset page
  const prevFiltersRef = useRef({ debouncedSearch, statusFilter, activeSection, startDate, endDate, sortField, sortDirection });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const filtersChanged =
      prev.debouncedSearch !== debouncedSearch ||
      prev.statusFilter !== statusFilter ||
      prev.activeSection !== activeSection ||
      prev.startDate !== startDate ||
      prev.endDate !== endDate ||
      prev.sortField !== sortField ||
      prev.sortDirection !== sortDirection;

    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
    }
    prevFiltersRef.current = { debouncedSearch, statusFilter, activeSection, startDate, endDate, sortField, sortDirection };
  }, [debouncedSearch, statusFilter, activeSection, startDate, endDate, sortField, sortDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Handle sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  // Reset all filters and pagination
  const resetFilters = () => {
    setStatusFilter('all');
    setSearchQuery('');
    setActiveSection(null);
    setStartDate(undefined);
    setEndDate(undefined);
    setSortField(null);
    setSortDirection('asc');
    setCurrentPage(1);
    setPageSize(25);
    router.replace('/orders', { scroll: false });
  };

  const hasActiveFilters = statusFilter !== 'all' || searchQuery || activeSection || startDate || endDate;

  // Fetch order statuses for filter dropdown
  const { data: statuses = [] } = useQuery({
    queryKey: ['orderStatuses'],
    queryFn: fetchOrderStatuses,
  });

  // Fetch orders with optional filter
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['orders', statusFilter, debouncedSearch],
    queryFn: () => fetchOrders(statusFilter, debouncedSearch),
  });

  // Function to handle section filter clicks
  const handleSectionFilter = (section: string | null) => {
    setActiveSection(section);
  };

  // Filter, sort, and paginate orders
  const { paginatedOrders, totalCount, totalPages } = useMemo(() => {
    // Section filter
    let filtered = orders.filter(order => {
      if (!activeSection) return true;
      return order.details?.some(detail =>
        determineProductSections(detail.product).includes(activeSection)
      );
    });

    // Date range filter
    if (startDate && isValid(startDate)) {
      filtered = filtered.filter(order => {
        if (!order.delivery_date) return false;
        const deliveryDate = parseISO(order.delivery_date);
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        return !isBefore(deliveryDate, start);
      });
    }

    if (endDate && isValid(endDate)) {
      filtered = filtered.filter(order => {
        if (!order.delivery_date) return false;
        const deliveryDate = parseISO(order.delivery_date);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return !isAfter(deliveryDate, end);
      });
    }

    // Sort
    if (sortField) {
      filtered = [...filtered].sort((a, b) => {
        let valueA: any;
        let valueB: any;

        switch (sortField) {
          case 'order_number':
            valueA = a.order_number || '';
            valueB = b.order_number || '';
            break;
          case 'customer':
            valueA = a.customer?.name || '';
            valueB = b.customer?.name || '';
            break;
          case 'created_at':
            valueA = a.created_at || '';
            valueB = b.created_at || '';
            break;
          case 'delivery_date':
            valueA = a.delivery_date || '';
            valueB = b.delivery_date || '';
            break;
          case 'total_amount':
            valueA = a.total_amount ?? -Infinity;
            valueB = b.total_amount ?? -Infinity;
            break;
          case 'status':
            valueA = a.status?.status_name || '';
            valueB = b.status?.status_name || '';
            break;
        }

        if (valueA == null && valueB == null) return 0;
        if (valueA == null) return 1;
        if (valueB == null) return -1;

        if (typeof valueA === 'string' && typeof valueB === 'string') {
          const cmp = valueA.localeCompare(valueB);
          return sortDirection === 'asc' ? cmp : -cmp;
        }

        if (typeof valueA === 'number' && typeof valueB === 'number') {
          return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
        }

        return 0;
      });
    }

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = (currentPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    return { paginatedOrders: paginated, totalCount: total, totalPages: pages };
  }, [orders, activeSection, startDate, endDate, sortField, sortDirection, pageSize, currentPage]);

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">
            Orders
          </h1>
          <p className="text-muted-foreground">
            Manage and track all your manufacturing orders
          </p>
        </div>
        <Link href="/orders/new">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-200 shadow-lg hover:shadow-xl">
            <PlusCircle className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </Link>
      </div>

      {/* Section Filter Pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSectionFilter(null)}
          className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
            activeSection === null ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
        >
          All Orders
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSectionFilter('chair')}
          className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
            activeSection === 'chair' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
        >
          <Package className="h-4 w-4 mr-2" />
          Chairs Section
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSectionFilter('wood')}
          className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
            activeSection === 'wood' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
        >
          <Layers className="h-4 w-4 mr-2" />
          Wood Section
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSectionFilter('steel')}
          className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
            activeSection === 'steel' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
        >
          <Wrench className="h-4 w-4 mr-2" />
          Steel Section
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSectionFilter('powdercoating')}
          className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
            activeSection === 'powdercoating' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
          }`}
        >
          <PaintBucket className="h-4 w-4 mr-2" />
          Powdercoating Section
        </Button>
      </div>

      {/* Filters bar */}
      <div className="p-4 border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status-filter" className="text-xs font-medium text-muted-foreground">
              Status
            </Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value)}
            >
              <SelectTrigger id="status-filter" className="w-full sm:w-[160px] h-9">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statuses?.map((status) => (
                  <SelectItem key={status.status_id} value={status.status_name}>
                    {status.status_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Delivery From
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:w-[160px] h-9 justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {startDate ? format(startDate, 'MMM d, yyyy') : <span className="text-muted-foreground">Pick date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Delivery To
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:w-[160px] h-9 justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {endDate ? format(endDate, 'MMM d, yyyy') : <span className="text-muted-foreground">Pick date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search orders by number or customer name"
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-10 h-9 w-full"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 text-muted-foreground">
              <FilterX className="h-4 w-4 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div>
        {isLoading ? (
          <div className="p-12 text-center border rounded-xl bg-card/50 backdrop-blur-sm">
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-muted rounded w-48 mx-auto"></div>
              <div className="h-3 bg-muted rounded w-32 mx-auto"></div>
            </div>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-destructive border rounded-xl bg-destructive/5">
            <p className="font-medium">Error loading orders</p>
            <p className="text-sm text-muted-foreground mt-1">Please try again later</p>
          </div>
        ) : totalCount > 0 ? (
          <div className="overflow-hidden border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <SortableHeader label="Order #" field="order_number" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader label="Customer" field="customer" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader label="Created" field="created_at" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader label="Delivery Date" field="delivery_date" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader label="Total Amount" field="total_amount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <SortableHeader label="Status" field="status" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                    <TableHead className="font-semibold text-center">Files</TableHead>
                    <TableHead className="font-semibold text-right w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedOrders.map((order) => (
                    <TableRow
                      key={order.order_id}
                      className="group cursor-pointer transition-colors duration-150 hover:bg-muted/50"
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/orders/${order.order_id}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          router.push(`/orders/${order.order_id}`);
                        }
                      }}
                    >
                      <TableCell className="align-middle font-semibold tracking-tight text-foreground py-2">
                        {order.order_number || `#${order.order_id}`}
                      </TableCell>
                      <TableCell className="align-middle py-2">
                        {order.customer?.name || 'N/A'}
                      </TableCell>
                      <TableCell className="align-middle text-sm text-muted-foreground py-2">
                        {order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy') : 'N/A'}
                      </TableCell>
                      <TableCell className="align-middle text-sm text-muted-foreground py-2">
                        {order.delivery_date
                          ? format(new Date(order.delivery_date), 'MMM d, yyyy')
                          : 'Not set'}
                      </TableCell>
                      <TableCell className="align-middle text-sm font-medium text-foreground py-2">
                        {order.total_amount !== null && order.total_amount !== undefined
                          ? `R ${Number(order.total_amount).toFixed(2)}`
                          : '—'}
                      </TableCell>
                      <TableCell className="align-middle py-2">
                        <StatusBadge status={order.status?.status_name || 'Unknown'} />
                      </TableCell>
                      <OrderAttachments order={order} />
                      <TableCell className="text-right align-middle py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/orders/${order.order_id}`)}>
                              <Eye className="h-4 w-4 mr-2" />
                              View details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTargetId(order.order_id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination controls */}
            <div className="flex flex-col items-start gap-4 border-t border-border/60 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span>Rows per page:</span>
                  <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setCurrentPage(1); }}>
                    <SelectTrigger className="h-8 w-[70px] rounded-md border border-border bg-background text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {pageSizeOptions.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="hidden md:inline">&bull;</span>
                  <span>
                    {((currentPage - 1) * pageSize + 1).toLocaleString()}&ndash;
                    {Math.min(currentPage * pageSize, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Go to previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    aria-label="Go to next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center border rounded-xl bg-card/50 backdrop-blur-sm">
            <p className="text-muted-foreground">No orders found</p>
            <p className="text-sm text-muted-foreground mt-1">Create a new order to get started</p>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Delete order</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the order and related records (attachments, details, links).
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTargetId(null)} disabled={isDeleting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTargetId) return;
                setIsDeleting(true);
                try {
                  const res = await fetch(`/api/orders/${deleteTargetId}`, { method: 'DELETE' });
                  const responseText = await res.text();
                  if (!res.ok) {
                    let errorMessage = 'Failed to delete order';
                    try {
                      const errorData = JSON.parse(responseText);
                      errorMessage = errorData.error || errorMessage;
                    } catch {
                      errorMessage = responseText || errorMessage;
                    }
                    throw new Error(errorMessage);
                  }
                  setDeleteTargetId(null);
                  queryClient.invalidateQueries({ queryKey: ['orders'] });
                } catch (e: any) {
                  console.error('Delete failed', e);
                  alert(`Failed to delete order: ${e.message || 'Unknown error'}. Check console for details.`);
                } finally {
                  setIsDeleting(false);
                }
              }}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
