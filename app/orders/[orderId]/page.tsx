'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Order, OrderAttachment, OrderStatus } from '@/types/orders';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, File, Download, Paperclip, Package, Layers, Wrench, Cog, Search, PaintBucket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type OrderDetailPageProps = {
  params: {
    orderId: string;
  };
};

// Fetch a single order with all related data
async function fetchOrderDetails(orderId: number): Promise<Order | null> {
  try {
    // First, fetch the order with basic information
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        status:order_statuses(status_id, status_name),
        customer:customers(*)
      `)
      .eq('order_id', orderId)
      .single();

    if (error) {
      console.error('Error fetching order details:', error);
      throw new Error('Failed to fetch order details');
    }

    if (!data) return null;

    // Next, fetch the order details (line items)
    const { data: orderDetails, error: detailsError } = await supabase
      .from('order_details')
      .select(`
        *,
        product:products(*)
      `)
      .eq('order_id', orderId);

    if (detailsError) {
      console.error('Error fetching order line items:', detailsError);
    }

    // Transform the data to ensure proper structure
    return {
      ...data,
      // Ensure status is properly structured
      status: data.status && data.status.length > 0 
        ? { 
            status_id: data.status[0]?.status_id || 0,
            status_name: data.status[0]?.status_name || 'Unknown'
          }
        : { status_id: 0, status_name: 'Unknown' },
      // Ensure total_amount is a number
      total_amount: data.total_amount !== null ? Number(data.total_amount) : null,
      // Add the order details
      details: orderDetails || []
    };
  } catch (error) {
    console.error('Error in fetchOrderDetails:', error);
    return null;
  }
}

// Fetch order attachments
async function fetchOrderAttachments(orderId: number): Promise<OrderAttachment[]> {
  try {
    const { data, error } = await supabase
      .from('order_attachments')
      .select('*')
      .eq('order_id', orderId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Error fetching order attachments:', error);
      throw new Error('Failed to fetch order attachments');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderAttachments:', error);
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

// Update order status
async function updateOrderStatus(orderId: number, statusId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ status_id: statusId })
      .eq('order_id', orderId);

    if (error) {
      console.error('Error updating order status:', error);
      throw new Error('Failed to update order status');
    }

    return true;
  } catch (error) {
    console.error('Error in updateOrderStatus:', error);
    return false;
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

// File icon based on extension
function FileIcon({ fileName }: { fileName: string }) {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  
  // Choose icon based on file extension
  const getFileIcon = () => {
    switch (extension) {
      case 'pdf':
        return <File className="h-10 w-10 text-red-500" />;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return <File className="h-10 w-10 text-blue-500" />;
      case 'doc':
      case 'docx':
        return <File className="h-10 w-10 text-blue-700" />;
      case 'xls':
      case 'xlsx':
        return <File className="h-10 w-10 text-green-600" />;
      default:
        return <File className="h-10 w-10 text-gray-400" />;
    }
  };

  return getFileIcon();
}

// Add new interface for sections
interface OrderSection {
  name: string;
  icon: React.ReactNode;
  color: string;
}

// Update sections to include powdercoating
const sections: { [key: string]: OrderSection } = {
  chair: {
    name: 'Chair',
    icon: <Package className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  wood: {
    name: 'Wood',
    icon: <Layers className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  steel: {
    name: 'Steel',
    icon: <Wrench className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  mechanical: {
    name: 'Mechanical',
    icon: <Cog className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  powdercoating: {
    name: 'Powdercoating',
    icon: <PaintBucket className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
};

// Update determineProductSections to include powdercoating
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
  if (product?.description?.toLowerCase().includes('mechanical')) {
    sections.push('mechanical');
  }
  if (product?.description?.toLowerCase().includes('powder') || 
      product?.description?.toLowerCase().includes('coating')) {
    sections.push('powdercoating');
  }
  
  return sections;
}

export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  const orderId = parseInt(params.orderId, 10);
  const [activeTab, setActiveTab] = useState<string>('details');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch order details
  const { 
    data: order, 
    isLoading: orderLoading, 
    error: orderError 
  } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrderDetails(orderId),
  });

  // Fetch order attachments
  const { 
    data: attachments, 
    isLoading: attachmentsLoading, 
    error: attachmentsError 
  } = useQuery({
    queryKey: ['orderAttachments', orderId],
    queryFn: () => fetchOrderAttachments(orderId),
  });

  // Fetch order statuses
  const { 
    data: statuses = [] 
  } = useQuery({
    queryKey: ['orderStatuses'],
    queryFn: fetchOrderStatuses,
  });

  // Update order status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ statusId }: { statusId: number }) => updateOrderStatus(orderId, statusId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      toast({
        title: "Status updated",
        description: "The order status has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update order status. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Enhanced filter function to include section filtering
  const filterOrderDetails = (details: any[]) => {
    if (!details) return [];
    
    let filteredDetails = [...details];
    
    // Apply section filter if active
    if (activeSection) {
      filteredDetails = filteredDetails.filter(detail => 
        determineProductSections(detail.product).includes(activeSection)
      );
    }
    
    // Apply search query filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredDetails = filteredDetails.filter(detail => 
        detail.product?.name?.toLowerCase().includes(query) ||
        detail.product?.description?.toLowerCase().includes(query) ||
        detail.order_detail_id.toString().includes(query)
      );
    }
    
    return filteredDetails;
  };

  // Function to handle section filter clicks
  const handleSectionFilter = (section: string | null) => {
    setActiveSection(section);
  };

  if (orderLoading) {
    return <div className="p-8 text-center">Loading order details...</div>;
  }

  if (orderError) {
    return (
      <div className="p-8 text-center text-destructive">
        Error loading order details. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/orders">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {order?.order_number || `Order #${orderId}`}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Created on {order?.created_at && format(new Date(order.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge status={order?.status?.status_name || 'Unknown'} />
          {order?.delivery_date && (
            <Badge variant="outline" className="ml-2">
              Delivery: {format(new Date(order.delivery_date), 'MMM d, yyyy')}
            </Badge>
          )}
        </div>
      </div>

      {/* Section Filter Pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button
          variant={activeSection === null ? "secondary" : "outline"}
          size="sm"
          onClick={() => handleSectionFilter(null)}
          className="rounded-full"
        >
          All Orders
        </Button>
        <Button
          variant={activeSection === 'chair' ? "secondary" : "outline"}
          size="sm"
          onClick={() => handleSectionFilter('chair')}
          className="rounded-full"
        >
          <Package className="h-4 w-4 mr-2" />
          Chairs Section
        </Button>
        <Button
          variant={activeSection === 'wood' ? "secondary" : "outline"}
          size="sm"
          onClick={() => handleSectionFilter('wood')}
          className="rounded-full"
        >
          <Layers className="h-4 w-4 mr-2" />
          Wood Section
        </Button>
        <Button
          variant={activeSection === 'steel' ? "secondary" : "outline"}
          size="sm"
          onClick={() => handleSectionFilter('steel')}
          className="rounded-full"
        >
          <Wrench className="h-4 w-4 mr-2" />
          Steel Section
        </Button>
        <Button
          variant={activeSection === 'powdercoating' ? "secondary" : "outline"}
          size="sm"
          onClick={() => handleSectionFilter('powdercoating')}
          className="rounded-full"
        >
          <PaintBucket className="h-4 w-4 mr-2" />
          Powdercoating Section
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            type="text"
            placeholder="Search by product name, description, or order ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Customer Information */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Customer Information</CardTitle>
          </CardHeader>
          <CardContent>
            {order?.customer ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Name</p>
                  <p className="text-base">{order.customer.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Contact</p>
                  <p className="text-base">{order.customer.contact || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p className="text-base">{order.customer.email || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Telephone</p>
                  <p className="text-base">{order.customer.telephone || 'N/A'}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No customer information available
              </p>
            )}
          </CardContent>
        </Card>

        {/* Order Sections */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Order Sections</CardTitle>
            <CardDescription>
              Manufacturing sections involved in this order
            </CardDescription>
          </CardHeader>
          <CardContent>
            {order?.details && order.details.length > 0 ? (
              <div className="space-y-6">
                {/* Sections Summary */}
                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set(
                    filterOrderDetails(order.details).flatMap(detail => 
                      determineProductSections(detail.product)
                    )
                  )).map(sectionKey => {
                    const section = sections[sectionKey];
                    return section ? (
                      <div
                        key={sectionKey}
                        className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100"
                      >
                        {section.icon}
                        <span className="ml-2">{section.name}</span>
                      </div>
                    ) : null;
                  })}
                </div>

                {/* Detailed Section Breakdown */}
                <div className="border rounded-lg divide-y">
                  {filterOrderDetails(order.details).map((detail) => {
                    const productSections = determineProductSections(detail.product);
                    return (
                      <div key={detail.order_detail_id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-medium">
                              {detail.product?.name || `Product #${detail.product_id}`}
                            </h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              {detail.product?.description || 'No description'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {productSections.map(sectionKey => {
                              const section = sections[sectionKey];
                              return section ? (
                                <div
                                  key={sectionKey}
                                  className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100"
                                >
                                  {section.icon}
                                  <span className="ml-1">{section.name}</span>
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No products in this order
              </p>
            )}
          </CardContent>
        </Card>

        {/* Order Line Items */}
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Order Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            {order?.details && order.details.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Product</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Description</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Quantity</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Unit Price</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filterOrderDetails(order.details).map((detail) => (
                      <tr key={detail.order_detail_id}>
                        <td className="px-4 py-4 text-sm">
                          {detail.product?.name || `Product #${detail.product_id}`}
                        </td>
                        <td className="px-4 py-4 text-sm text-muted-foreground">
                          {detail.product?.description || 'No description'}
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          {detail.quantity}
                        </td>
                        <td className="px-4 py-4 text-sm text-right">
                          ${parseFloat(detail.unit_price.toString()).toFixed(2)}
                        </td>
                        <td className="px-4 py-4 text-sm text-right font-medium">
                          ${(detail.quantity * parseFloat(detail.unit_price.toString())).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t">
                      <td colSpan={4} className="px-4 py-4 text-sm text-right font-medium">
                        Total Amount:
                      </td>
                      <td className="px-4 py-4 text-sm text-right font-medium">
                        ${order.total_amount !== null 
                          ? parseFloat(order.total_amount.toString()).toFixed(2)
                          : filterOrderDetails(order.details).reduce(
                              (sum, detail) => sum + (detail.quantity * parseFloat(detail.unit_price.toString())),
                              0
                            ).toFixed(2)
                        }
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No line items in this order
              </p>
            )}
          </CardContent>
        </Card>

        {/* Attachments Section */}
        {attachments && attachments.length > 0 && (
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="text-lg">Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex flex-col items-center p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <FileIcon fileName={attachment.file_name} />
                    <h3 className="mt-3 text-sm font-medium text-center line-clamp-1">
                      {attachment.file_name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(attachment.uploaded_at), 'MMM d, yyyy')}
                    </p>
                    <a 
                      href={attachment.file_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center text-xs text-primary hover:underline"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download
                    </a>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
} 