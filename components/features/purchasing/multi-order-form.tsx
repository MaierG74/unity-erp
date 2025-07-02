'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Plus, ShoppingCart, Trash2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Component } from '@/types/purchasing';
import { SupplierComponent } from '@/types/suppliers';

// Type for shopping cart item
type CartItem = {
  id: string;
  component_id: number;
  component_code: string;
  component_description: string;
  supplier_component_id: number;
  supplier_id: number;
  supplier_name: string;
  price: number;
  quantity: number;
};

// Type for component returned from API
type ComponentFromAPI = {
  component_id: number;
  internal_code: string;
  description: string | null;
};

// Fetch components for selection
async function fetchComponents(): Promise<ComponentFromAPI[]> {
  const { data, error } = await supabase
    .from('components')
    .select('component_id, internal_code, description')
    .order('internal_code');
  
  if (error) {
    console.error('Error fetching components:', error);
    throw new Error('Failed to fetch components');
  }
  
  return data || [];
}

// Fetch supplier components for a specific component
async function fetchSupplierComponentsForComponent(componentId: number): Promise<(SupplierComponent & { supplier: { name: string } })[]> {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .select(`
      *,
      supplier:suppliers(name)
    `)
    .eq('component_id', componentId)
    .order('price');
  
  if (error) {
    console.error('Error fetching supplier components:', error);
    throw new Error('Failed to fetch supplier components');
  }
  
  return data || [];
}

// Fetch Open status ID
async function fetchOpenStatusId(): Promise<number> {
  // First try to find the existing status
  const { data, error } = await supabase
    .from('supplier_order_statuses')
    .select('status_id')
    .eq('status_name', 'Open')
    .single();

  if (error) {
    console.error('Error fetching Open status:', error);
    
    // If not found, create it
    if (error.code === 'PGRST116') { // No rows returned
      const { data: insertData, error: insertError } = await supabase
        .from('supplier_order_statuses')
        .insert({ status_name: 'Open' })
        .select('status_id')
        .single();
      
      if (insertError) {
        console.error('Error creating Open status:', insertError);
        throw new Error('Failed to create Open status');
      }
      
      return insertData.status_id;
    }
    
    throw new Error('Failed to fetch Open status');
  }

  return data.status_id;
}

// Create supplier orders
async function createSupplierOrders(
  items: CartItem[], 
  statusId: number, 
  orderDate: string
): Promise<number[]> {
  // Group items by supplier
  const supplierGroups: Record<number, CartItem[]> = {};
  
  items.forEach(item => {
    if (!supplierGroups[item.supplier_id]) {
      supplierGroups[item.supplier_id] = [];
    }
    supplierGroups[item.supplier_id].push(item);
  });
  
  const orderIds: number[] = [];
  
  // Create an order for each supplier group
  for (const supplierId of Object.keys(supplierGroups)) {
    const supplierItems = supplierGroups[Number(supplierId)];
    
    // Create orders for each item
    for (const item of supplierItems) {
      const { data, error } = await supabase
        .from('supplier_orders')
        .insert({
          supplier_component_id: item.supplier_component_id,
          order_quantity: item.quantity,
          order_date: orderDate || new Date().toISOString(),
          status_id: statusId,
          total_received: 0,
        })
        .select('order_id')
        .single();
        
      if (error) {
        console.error('Error creating supplier order:', error);
        throw new Error(`Failed to create order for ${item.component_code}`);
      }
      
      orderIds.push(data.order_id);
    }
  }
  
  return orderIds;
}

export function MultiOrderForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<ComponentFromAPI | null>(null);
  const [selectedSupplierComponent, setSelectedSupplierComponent] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderDate, setOrderDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Fetch all components
  const { data: components, isLoading: componentsLoading } = useQuery({
    queryKey: ['components'],
    queryFn: fetchComponents,
  });

  // Fetch supplier components for the selected component
  const { data: supplierComponents, isLoading: supplierComponentsLoading } = useQuery({
    queryKey: ['supplierComponents', selectedComponent?.component_id],
    queryFn: () => 
      selectedComponent 
        ? fetchSupplierComponentsForComponent(selectedComponent.component_id) 
        : Promise.resolve([]),
    enabled: !!selectedComponent,
  });

  // Fetch open status ID for when we create orders
  const { data: openStatusId, isLoading: statusIdLoading } = useQuery({
    queryKey: ['openStatusId'],
    queryFn: fetchOpenStatusId,
  });

  // Create orders mutation
  const createOrdersMutation = useMutation({
    mutationFn: (items: CartItem[]) => {
      if (!openStatusId) {
        throw new Error('Status ID not available');
      }
      return createSupplierOrders(items, openStatusId, orderDate);
    },
    onSuccess: (orderIds) => {
      if (orderIds.length === 1) {
        // If only one order was created, go to that order
        router.push(`/purchasing/${orderIds[0]}`);
      } else {
        // If multiple orders were created, go to the main purchasing page
        router.push('/purchasing');
      }
    },
    onError: (error: Error) => {
      setError(`Failed to create orders: ${error.message}`);
    },
  });

  // Handle adding item to cart
  const addToCart = () => {
    if (!selectedComponent || !selectedSupplierComponent || quantity <= 0) {
      setError('Please select a component, supplier, and valid quantity');
      return;
    }
    
    const supplierComponent = supplierComponents?.find(
      sc => sc.supplier_component_id === selectedSupplierComponent
    );
    
    if (!supplierComponent) {
      setError('Selected supplier component not found');
      return;
    }
    
    const newItem: CartItem = {
      id: `${selectedComponent.component_id}-${selectedSupplierComponent}-${Date.now()}`,
      component_id: selectedComponent.component_id,
      component_code: selectedComponent.internal_code,
      component_description: selectedComponent.description || '',
      supplier_component_id: supplierComponent.supplier_component_id,
      supplier_id: supplierComponent.supplier_id,
      supplier_name: supplierComponent.supplier.name,
      price: supplierComponent.price,
      quantity,
    };
    
    setCart([...cart, newItem]);
    setError(null);
    
    // Reset selection
    setSelectedSupplierComponent(null);
    setQuantity(1);
  };
  
  // Handle removing item from cart
  const removeFromCart = (itemId: string) => {
    setCart(cart.filter(item => item.id !== itemId));
  };
  
  // Calculate totals by supplier
  const supplierTotals = cart.reduce((acc, item) => {
    if (!acc[item.supplier_id]) {
      acc[item.supplier_id] = {
        name: item.supplier_name,
        itemCount: 0,
        total: 0,
      };
    }
    
    acc[item.supplier_id].itemCount += 1;
    acc[item.supplier_id].total += item.price * item.quantity;
    
    return acc;
  }, {} as Record<number, { name: string; itemCount: number; total: number }>);
  
  // Handle checkout
  const handleCheckout = () => {
    if (cart.length === 0) {
      setError('Your cart is empty');
      return;
    }
    
    createOrdersMutation.mutate(cart);
  };

  return (
    <div className="space-y-8">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Component Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Select Component</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="component" className="block text-sm font-medium mb-1">
                Component (Internal Code)
              </label>
              <select
                id="component"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedComponent?.component_id || ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const componentId = parseInt(e.target.value, 10);
                  const component = components?.find(c => c.component_id === componentId) || null;
                  setSelectedComponent(component);
                  setSelectedSupplierComponent(null);
                }}
                disabled={componentsLoading}
              >
                <option value="">Select a component</option>
                {components?.map((component) => (
                  <option key={component.component_id} value={component.component_id}>
                    {component.internal_code} - {component.description}
                  </option>
                ))}
              </select>
            </div>
            
            {selectedComponent && (
              <div>
                <label htmlFor="supplier" className="block text-sm font-medium mb-1">
                  Supplier
                </label>
                <select
                  id="supplier"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedSupplierComponent || ''}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedSupplierComponent(parseInt(e.target.value, 10))}
                  disabled={supplierComponentsLoading || !selectedComponent}
                >
                  <option value="">Select a supplier</option>
                  {supplierComponents?.map((sc) => (
                    <option key={sc.supplier_component_id} value={sc.supplier_component_id}>
                      {sc.supplier.name} - R{sc.price.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <div>
              <label htmlFor="quantity" className="block text-sm font-medium mb-1">
                Quantity
              </label>
              <Input
                id="quantity"
                type="number"
                value={quantity}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(parseInt(e.target.value, 10) || 0)}
                min="1"
                className="h-10"
                disabled={!selectedSupplierComponent}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              onClick={addToCart}
              disabled={!selectedComponent || !selectedSupplierComponent || quantity <= 0}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" /> Add to Cart
            </Button>
          </CardFooter>
        </Card>
        
        {/* Shopping Cart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Shopping Cart <Badge variant="outline">{cart.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cart.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <ShoppingCart className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p>Your cart is empty</p>
              </div>
            ) : (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.component_code}
                          <div className="text-xs text-muted-foreground">
                            {item.component_description}
                          </div>
                        </TableCell>
                        <TableCell>{item.supplier_name}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>R{(item.price * item.quantity).toFixed(2)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromCart(item.id)}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-2">Order Summary by Supplier</h4>
                  {Object.entries(supplierTotals).map(([supplierId, { name, itemCount, total }]) => (
                    <div key={supplierId} className="flex justify-between text-sm py-1">
                      <span>{name} ({itemCount} item{itemCount !== 1 ? 's' : ''})</span>
                      <span className="font-medium">R{total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                
                <div>
                  <label htmlFor="orderDate" className="block text-sm font-medium mb-1">
                    Order Date
                  </label>
                  <Input
                    id="orderDate"
                    type="date"
                    value={orderDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrderDate(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleCheckout}
              disabled={cart.length === 0 || createOrdersMutation.isPending || statusIdLoading}
              className="w-full"
            >
              {createOrdersMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {createOrdersMutation.isPending
                ? 'Creating Orders...'
                : `Checkout (${cart.length} item${cart.length !== 1 ? 's' : ''})`}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
} 