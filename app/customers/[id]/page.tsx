'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Edit, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';
import { useState } from 'react';
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

// Function to fetch a single customer by ID
async function fetchCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) {
    console.error('Error fetching customer:', error);
    throw new Error('Failed to fetch customer');
  }
  
  return data;
}

// Define the order type with status
interface CustomerOrder {
  order_id: number;
  order_number: string | null;
  order_date: string;
  total_amount: string | null;
  status: {
    status_id: number;
    status_name: string;
  };
}

// Function to fetch orders for a customer
async function fetchCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      order_id,
      order_number,
      order_date,
      total_amount,
      status:order_statuses(status_id, status_name)
    `)
    .eq('customer_id', customerId)
    .order('order_date', { ascending: false });
  
  if (error) {
    console.error('Error fetching customer orders:', error);
    throw new Error('Failed to fetch customer orders');
  }
  
  // Transform the data to match the CustomerOrder interface
  const transformedData = (data || []).map(order => ({
    ...order,
    status: {
      status_id: order.status?.[0]?.status_id || 0,
      status_name: order.status?.[0]?.status_name || 'Unknown'
    }
  }));
  
  return transformedData;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  
  // Fetch customer details
  const { 
    data: customer, 
    isLoading: isLoadingCustomer, 
    error: customerError 
  } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId),
  });
  
  // Fetch customer orders
  const { 
    data: orders = [], 
    isLoading: isLoadingOrders, 
    error: ordersError 
  } = useQuery({
    queryKey: ['customerOrders', customerId],
    queryFn: () => fetchCustomerOrders(customerId),
    enabled: !!customerId,
  });
  
  // Handle customer deletion
  const handleDeleteCustomer = async () => {
    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);
      
      if (error) throw error;
      
      router.push('/customers');
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert('Failed to delete customer. Please try again.');
    }
  };
  
  if (isLoadingCustomer) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (customerError || !customer) {
    return (
      <div className="bg-red-50 text-red-500 p-4 rounded-md">
        Customer not found or error loading customer details.
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="icon" asChild>
            <Link href="/customers">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">{customer.name || 'Unnamed Customer'}</h1>
        </div>
        
        <div className="flex space-x-2">
          <Button variant="outline" asChild>
            <Link href={`/customers/${customerId}/edit`}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Name</p>
                <p className="font-medium">{customer.name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Contact Person</p>
                <p className="font-medium">{customer.contact || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="font-medium">
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">
                      {customer.email}
                    </a>
                  ) : (
                    'N/A'
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Telephone</p>
                <p className="font-medium">
                  {customer.telephone ? (
                    <a href={`tel:${customer.telephone}`} className="text-blue-600 hover:underline">
                      {customer.telephone}
                    </a>
                  ) : (
                    'N/A'
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Orders</CardTitle>
            <Button variant="outline" asChild>
              <Link href={`/orders/new?customer=${customerId}`}>
                Create Order
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingOrders ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : ordersError ? (
              <div className="text-sm text-red-500">
                Error loading orders.
              </div>
            ) : orders.length === 0 ? (
              <div className="text-sm text-gray-500 py-4 text-center">
                No orders found for this customer.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Order #</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {orders.slice(0, 5).map((order) => (
                      <tr key={order.order_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 whitespace-nowrap">
                          <Link href={`/orders/${order.order_id}`} className="text-blue-600 hover:underline">
                            {order.order_number || `#${order.order_id}`}
                          </Link>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {new Date(order.order_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {order.total_amount 
                            ? `$${parseFloat(order.total_amount).toFixed(2)}` 
                            : 'N/A'}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            order.status?.status_name === 'Completed' 
                              ? 'bg-green-100 text-green-800' 
                              : order.status?.status_name === 'Pending' 
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {order.status?.status_name || 'Unknown'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {orders.length > 5 && (
                  <div className="mt-4 text-center">
                    <Link href={`/orders?customer=${customerId}`} className="text-sm text-blue-600 hover:underline">
                      View all {orders.length} orders
                    </Link>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the customer and cannot be undone.
              Any orders associated with this customer will remain but will no longer be linked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustomer} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 