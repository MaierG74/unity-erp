'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { format } from 'date-fns';
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
import { PlusCircle, Search, Package, Layers, Wrench, PaintBucket, Paperclip, Upload, FileText, ImageIcon, Eye, Download, FileUp, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

// Status Badge component
function StatusBadge({ status }: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'new':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
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

// File icon based on extension
function FileIcon({ fileName }: { fileName: string }) {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  
  // Choose icon based on file extension
  const getFileIcon = () => {
    switch (extension) {
      case 'pdf':
        return <FileText className="h-5 w-5 text-red-500" />;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return <ImageIcon className="h-5 w-5 text-blue-500" />;
      case 'doc':
      case 'docx':
        return <FileText className="h-5 w-5 text-blue-700" />;
      case 'xls':
      case 'xlsx':
        return <FileText className="h-5 w-5 text-green-600" />;
      default:
        return <FileText className="h-5 w-5 text-gray-400" />;
    }
  };

  return getFileIcon();
}

// Helper function to open PDF files directly in the browser
function openPdfInBrowser(url: string) {
  // Create an iframe to open the PDF
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  
  // Set the source to the PDF URL
  iframe.src = url;
  
  // Clean up after navigating
  iframe.onload = () => {
    document.body.removeChild(iframe);
  };
}

// Attachment Preview Modal Component
function AttachmentPreviewModal({ 
  isOpen, 
  onClose, 
  attachments,
  orderNumber 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  attachments: any[];
  orderNumber: string;
}) {
  // This approach exactly matches the suppliers implementation
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Order {orderNumber} - Attachments</DialogTitle>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
            >
              <a
                href={attachment.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3"
              >
                <div className="bg-primary/10 p-2 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium truncate">{attachment.file_name}</h4>
                  <p className="text-sm text-muted-foreground">
                    {new Date(attachment.uploaded_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground uppercase">
                    {attachment.file_type || attachment.file_name.split('.').pop()?.toUpperCase()}
                  </p>
                </div>
              </a>
            </div>
          ))}
        </div>

        {attachments.length === 0 && (
          <div className="text-center p-8 border rounded-lg bg-muted/10">
            <p className="text-muted-foreground">No attachments available.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Upload Attachments Dialog Component
function UploadAttachmentDialog({ order, onSuccess }: { order: Order, onSuccess: () => void }): JSX.Element {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');

  // Handle file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    
    if (!displayName) {
      // Use file name without extension as default display name
      setDisplayName(file.name.split('.').slice(0, -1).join('.'));
    }
  };

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile || !order.order_id) return;

    setIsUploading(true);
    try {
      // Generate a unique filename with timestamp and random string
      const timestamp = new Date().getTime();
      const randomStr = Math.random().toString(36).substring(2, 10);
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${order.order_number || order.order_id}_${timestamp}_${randomStr}.${fileExt}`;
      const filePath = `Orders/Customer/${order.customer?.id}/${fileName}`;
      
      // Options including content type
      const fileOptions = {
        cacheControl: '3600',
        contentType: selectedFile.type || undefined,
        upsert: false
      };
      
      // Upload file to storage with proper content type
      const { error: uploadError } = await supabase.storage
        .from('qbutton')
        .upload(filePath, selectedFile, fileOptions);

      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('qbutton')
        .getPublicUrl(filePath);

      // Create record in order_attachments table
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
        // If database insert fails, delete the uploaded file
        await supabase.storage
          .from('qbutton')
          .remove([filePath]);
        throw dbError;
      }

      // Reset fields and notify parent
      setSelectedFile(null);
      setDisplayName('');
      onSuccess();
      
      // Reset the file input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-card">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <input
          type="text"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
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
          className="inline-flex items-center gap-2 bg-[#F26B3A] text-white px-4 py-2 rounded-lg hover:bg-[#E25A29] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="h-4 w-4" />
          {isUploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {selectedFile && (
        <div className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
          <Check className="h-4 w-4 text-green-500" />
          <span>Selected: {selectedFile.name}</span>
        </div>
      )}
    </div>
  );
}

// Order Attachments Component for the table cell
function OrderAttachments({ order }: { order: Order }): JSX.Element {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch attachments from the database
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
      <td className="p-4 text-center">
        {attachments.length > 0 ? (
          <button
            onClick={() => setSelectedOrder(order)}
            className="inline-flex items-center gap-1 text-primary hover:text-primary/90"
          >
            <FileText className="h-4 w-4" />
            <span className="text-sm">{attachments.length}</span>
          </button>
        ) : (
          <span className="text-muted-foreground text-sm">None</span>
        )}
        <button
          onClick={() => setIsUploadDialogOpen(true)}
          className="text-primary hover:text-primary/90 ml-2"
          title="Upload attachment"
        >
          <Upload className="h-4 w-4" />
        </button>
      </td>

      {/* Attachment Preview Modal */}
      {selectedOrder && (
        <AttachmentPreviewModal
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          attachments={attachments}
          orderNumber={selectedOrder.order_number || `#${selectedOrder.order_id}`}
        />
      )}

      {/* Upload Dialog */}
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

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  
  // Handle search input change with debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    
    // Debounce search to avoid excessive API calls
    clearTimeout((window as any).searchTimeout);
    (window as any).searchTimeout = setTimeout(() => {
      setDebouncedSearch(e.target.value);
    }, 500);
  };
  
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

  // Filter orders based on section
  const filteredOrders = orders.filter(order => {
    if (!activeSection) return true;
    
    // Check if any product in the order belongs to the selected section
    return order.details?.some(detail => 
      determineProductSections(detail.product).includes(activeSection)
    );
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8 w-full max-w-full p-6"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">
            Orders
          </h1>
          <p className="text-muted-foreground">
            Manage and track all your manufacturing orders
          </p>
        </div>
        <Link href="/orders/new">
          <Button className="bg-[#F26B3A] hover:bg-[#E25A29] text-white transition-all duration-200 shadow-lg hover:shadow-xl">
            <PlusCircle className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </Link>
      </div>

      {/* Section Filter Pills */}
      <div className="flex flex-wrap gap-3 mb-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="flex flex-wrap gap-2"
        >
          <Button
            variant={activeSection === null ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter(null)}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === null ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            All Orders
          </Button>
          <Button
            variant={activeSection === 'chair' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('chair')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'chair' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <Package className="h-4 w-4 mr-2" />
            Chairs Section
          </Button>
          <Button
            variant={activeSection === 'wood' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('wood')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'wood' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <Layers className="h-4 w-4 mr-2" />
            Wood Section
          </Button>
          <Button
            variant={activeSection === 'steel' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('steel')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'steel' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <Wrench className="h-4 w-4 mr-2" />
            Steel Section
          </Button>
          <Button
            variant={activeSection === 'powdercoating' ? "outline" : "outline"}
            size="sm"
            onClick={() => handleSectionFilter('powdercoating')}
            className={`rounded-full shadow-sm hover:shadow transition-all duration-200 ${
              activeSection === 'powdercoating' ? 'bg-[#F26B3A] text-white hover:bg-[#E25A29]' : ''
            }`}
          >
            <PaintBucket className="h-4 w-4 mr-2" />
            Powdercoating Section
          </Button>
        </motion.div>
      </div>

      <div className="space-y-6">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="p-6 border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm"
        >
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <Label htmlFor="status-filter" className="text-sm font-medium">
                Filter by Status:
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value)}
              >
                <SelectTrigger id="status-filter" className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Select a status" />
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
            
            <div className="flex-1 md:ml-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search orders by number or customer name"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="pl-10 w-full transition-all duration-200 focus:ring-2 focus:ring-[#F26B3A]/20"
                />
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
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
          ) : filteredOrders && filteredOrders.length > 0 ? (
            <div className="overflow-hidden border rounded-xl bg-card/50 backdrop-blur-sm shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Order #</TableHead>
                      <TableHead className="font-semibold">Customer</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold">Delivery Date</TableHead>
                      <TableHead className="font-semibold">Total Amount</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold text-center">Attachments</TableHead>
                      <TableHead className="font-semibold"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((order) => (
                      <TableRow 
                        key={order.order_id}
                        className="hover:bg-muted/50 transition-colors duration-200"
                      >
                        <TableCell className="font-medium">
                          {order.order_number || `#${order.order_id}`}
                        </TableCell>
                        <TableCell>{order.customer?.name || 'N/A'}</TableCell>
                        <TableCell>
                          {order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy') : 'N/A'}
                        </TableCell>
                        <TableCell>
                          {order.delivery_date 
                            ? format(new Date(order.delivery_date), 'MMM d, yyyy')
                            : 'Not set'}
                        </TableCell>
                        <TableCell>
                          {order.total_amount !== null && order.total_amount !== undefined
                            ? `R ${Number(order.total_amount).toFixed(2)}`
                            : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={order.status?.status_name || 'Unknown'} />
                        </TableCell>
                        <OrderAttachments order={order} />
                        <TableCell>
                          <Link
                            href={`/orders/${order.order_id}`}
                            className="text-[#F26B3A] hover:text-[#E25A29] hover:underline text-sm flex items-center transition-colors duration-200"
                          >
                            View Details
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center border rounded-xl bg-card/50 backdrop-blur-sm">
              <p className="text-muted-foreground">No orders found</p>
              <p className="text-sm text-muted-foreground mt-1">Create a new order to get started</p>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
} 