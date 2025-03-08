'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Order, OrderAttachment } from '@/types/orders';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, File, Download, Paperclip } from 'lucide-react';

type OrderDetailPageProps = {
  params: {
    orderId: string;
  };
};

// Fetch a single order with all related data
async function fetchOrderDetails(orderId: number): Promise<Order | null> {
  try {
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
      total_amount: data.total_amount ? Number(data.total_amount) : null
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

export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  const orderId = parseInt(params.orderId, 10);
  const [activeTab, setActiveTab] = useState<string>('details');

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
      <div className="flex items-center gap-2">
        <Link href="/orders">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {order?.order_number || `Order #${orderId}`}
        </h1>
        <StatusBadge status={order?.status?.status_name || 'Unknown'} />
      </div>

      <Tabs defaultValue="details" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="details">Order Details</TabsTrigger>
          <TabsTrigger value="attachments">
            Attachments
            {attachments && attachments.length > 0 && (
              <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {attachments.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Order Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-1">
                  <span className="text-sm font-medium">Order Number:</span>
                  <span className="text-sm">{order?.order_number || `#${orderId}`}</span>
                  
                  <span className="text-sm font-medium">Created Date:</span>
                  <span className="text-sm">
                    {order?.created_at && format(new Date(order.created_at), 'MMM d, yyyy')}
                  </span>
                  
                  <span className="text-sm font-medium">Delivery Date:</span>
                  <span className="text-sm">
                    {order?.delivery_date 
                      ? format(new Date(order.delivery_date), 'MMM d, yyyy')
                      : 'Not set'}
                  </span>
                  
                  <span className="text-sm font-medium">Total Amount:</span>
                  <span className="text-sm">
                    {order?.total_amount
                      ? `$${order.total_amount.toFixed(2)}`
                      : 'Not set'}
                  </span>
                  
                  <span className="text-sm font-medium">Status:</span>
                  <span className="text-sm">
                    <StatusBadge status={order?.status?.status_name || 'Unknown'} />
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {order?.customer ? (
                  <div className="grid grid-cols-2 gap-1">
                    <span className="text-sm font-medium">Name:</span>
                    <span className="text-sm">{order.customer.name}</span>
                    
                    <span className="text-sm font-medium">Contact:</span>
                    <span className="text-sm">{order.customer.contact || 'N/A'}</span>
                    
                    <span className="text-sm font-medium">Email:</span>
                    <span className="text-sm">{order.customer.email || 'N/A'}</span>
                    
                    <span className="text-sm font-medium">Telephone:</span>
                    <span className="text-sm">{order.customer.telephone || 'N/A'}</span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No customer information available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="attachments" className="space-y-6">
          <div className="flex justify-end">
            <Button variant="outline">
              <Paperclip className="h-4 w-4 mr-2" />
              Add Attachment
            </Button>
          </div>

          {attachmentsLoading ? (
            <div className="p-8 text-center">Loading attachments...</div>
          ) : attachmentsError ? (
            <div className="p-8 text-center text-destructive">
              Error loading attachments. Please try again.
            </div>
          ) : attachments && attachments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {attachments.map((attachment) => (
                <Card key={attachment.id} className="flex flex-col h-full">
                  <CardContent className="flex flex-col items-center p-6">
                    <FileIcon fileName={attachment.file_name} />
                    <h3 className="mt-4 font-medium text-center line-clamp-2">
                      {attachment.file_name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(attachment.uploaded_at), 'MMM d, yyyy')}
                    </p>
                    <div className="mt-auto pt-4">
                      <a 
                        href={attachment.file_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-sm text-primary hover:underline"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </a>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center border rounded-lg">
              <Paperclip className="h-8 w-8 mx-auto text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium">No attachments</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                There are no files attached to this order yet.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
} 