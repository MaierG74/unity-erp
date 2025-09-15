'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { type Order, type Product, type OrderDetail, type Customer, type OrderAttachment, type OrderStatus } from '@/types/orders';
import { ComponentRequirement, ProductRequirement, OrderComponentsDialogProps, SupplierInfo, OrderBreakdown, SupplierOrderBreakdown } from '@/types/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, File, Download, Paperclip, Package, Layers, Wrench, Cog, Search, PaintBucket, PlusCircle, Check, Plus, Loader2, AlertCircle, ShoppingCart, ChevronDown, CheckCircle, Trash, FilePlus, Terminal, ChevronRight, Info, ShoppingBag, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow, TableFooter } from '@/components/ui/table';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { clsx } from 'clsx';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

type OrderDetailPageProps = {
  params: {
    orderId: string;
  };
};

// Format currency function
function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return 'N/A';
  return `R ${amount.toFixed(2)}`;
}

// Fetch a single order with all related data
async function fetchOrderDetails(orderId: number): Promise<Order | null> {
  try {
    // First, fetch the order with basic information
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        status:order_statuses(status_id, status_name),
        customer:customers(*),
        quote:quotes(id, quote_number)
      `)
      .eq('order_id', orderId)
      .single();

    if (error) {
      console.error('Error fetching order details:', error);
      throw new Error('Failed to fetch order details');
    }

    if (!data) return null; // include quote relationship

    // Transform quote relationship from array to object
    const quoteObj = data.quote?.[0] || null;


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
      quote: quoteObj,
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

// Function to fetch component requirements for an order
async function fetchOrderComponentRequirements(orderId: number): Promise<ProductRequirement[]> {
  try {
    console.log(`[DEBUG] Fetching component requirements for order ${orderId}`);
    
    // First get all components across all orders to ensure we have global totals
    const { data: globalComponents, error: globalError } = await supabase.rpc(
      'get_all_component_requirements'
    );
    
    if (globalError) {
      console.error(`[ERROR] Error fetching global component requirements:`, globalError);
      // Continue anyway with null/empty data
    }
    
    // Create a map of component IDs to their global requirements
    const globalRequirementsMap = globalComponents ?
      globalComponents.reduce((map: Record<number, any>, item: any) => {
        if (item && item.component_id) {
          map[item.component_id] = item;
        }
        return map;
      }, {}) : {};
      
    console.log(`[DEBUG] Retrieved global requirements for ${Object.keys(globalRequirementsMap).length} components`);
    
    // Get the order details with products
    const { data: orderDetails, error: orderError } = await supabase
      .from('order_details')
      .select(`
        order_detail_id,
        order_id,
        product_id,
        quantity,
        unit_price,
        product:products(
          product_id,
          name,
          description
        )
      `)
      .eq('order_id', orderId);
    
    if (orderError) {
      console.error(`[ERROR] Error fetching order details:`, orderError);
      throw new Error('Failed to fetch order details');
    }
    
    console.log(`[DEBUG] Found ${orderDetails?.length || 0} order details`);
    
    if (!orderDetails || orderDetails.length === 0) {
      return [];
    }
    
    // Use the detailed component status function that includes global requirements
    const { data: componentStatus, error: statusError } = await supabase.rpc(
      'get_detailed_component_status',
      { p_order_id: orderId }
    );
    
    if (statusError) {
      console.error(`[ERROR] Error fetching detailed component status:`, statusError);
      // Don't throw here, just continue with null/empty data
    }
    
    console.log(`[DEBUG] Retrieved component status for ${componentStatus?.length || 0} components`);
    // Log a sample of the data to debug the issue
    if (componentStatus && componentStatus.length > 0) {
      console.log(`[DEBUG] Sample component data:`, JSON.stringify(componentStatus[0], null, 2));
    }
    
    // Create a map of component IDs to their status - safely handle null/undefined
    const componentStatusMap = componentStatus ?
      componentStatus.reduce((map: Record<number, any>, item: any) => {
        if (item && item.component_id) {
          map[item.component_id] = item;
        }
        return map;
      }, {}) : {};
    
    // Fetch component order history for this order - wrap in try/catch
    let orderHistoryMap: Record<number, any[]> = {};
    
    try {
      const { data: orderHistory, error: historyError } = await supabase.rpc(
        'get_order_component_history',
        { p_order_id: orderId }
      );
      
      if (historyError) {
        console.error(`[ERROR] Error fetching order history:`, historyError);
        // Continue anyway with empty history
      } else if (orderHistory) {
        // Safely create the history map
        orderHistoryMap = orderHistory.reduce((map: Record<number, any[]>, item: any) => {
          if (item && item.component_id) {
            if (!map[item.component_id]) {
              map[item.component_id] = [];
            }
            map[item.component_id].push(item);
          }
          return map;
        }, {});
      }
    } catch (historyError) {
      console.error(`[ERROR] Exception fetching order history:`, historyError);
      // Continue with empty history map
    }
    
    // Process each order detail to get component requirements
    const requirements = await Promise.all(
      orderDetails.map(async (detail) => {
        try {
          console.log(`[DEBUG] Processing order detail ${detail.order_detail_id} for product ${detail.product_id}`);
          
          // Get bill of materials for this product
          const { data: bomData, error: bomError } = await supabase
            .from('billofmaterials')
            .select(`
              bom_id,
              quantity_required,
              component_id,
              component:components(
                component_id,
                internal_code,
                description
              ),
              supplierComponent:suppliercomponents(
                supplier_component_id,
                supplier:suppliers(
                  supplier_id,
                  name
                ),
                price
              )
            `)
            .eq('product_id', detail.product_id);
          
          if (bomError) {
            console.error(`[ERROR] Error fetching BOM for product ${detail.product_id}:`, bomError);
            throw new Error('Failed to fetch bill of materials');
          }
          
          console.log(`[DEBUG] Found ${bomData?.length || 0} BOM items for product ${detail.product_id}`);
          
          if (!bomData || bomData.length === 0) {
            return {
              order_detail_id: detail.order_detail_id,
              product_id: detail.product_id,
              product_name: detail.product?.name || 'Unknown Product',
              order_quantity: detail.quantity,
              components: []
            } as ProductRequirement;
          }
          
          // Process components and their requirements
          const components = bomData.map(bomItem => {
            const componentId = bomItem.component_id;
            const component = bomItem.component;
            const status = componentStatusMap[componentId];
            
            if (!component) {
              console.error(`[ERROR] Component ${componentId} not found in component data`);
              return null;
            }
            
            // Use the computed values from our database function
            // or calculate fallbacks if they're not available
            const requiredQuantity = detail.quantity * parseFloat(bomItem.quantity_required);
            const inStock = status ? status.in_stock : 0;
            const onOrder = status ? status.on_order : 0;
            const apparentShortfall = status ? status.apparent_shortfall : Math.max(requiredQuantity - inStock, 0);
            const realShortfall = status ? status.real_shortfall : Math.max(requiredQuantity - inStock - onOrder, 0);
            const isCovered = realShortfall <= 0 && apparentShortfall > 0;
            
            // Process supplier options
            const supplierOptions = Array.isArray(bomItem.supplierComponent) ?
              bomItem.supplierComponent
                .filter(sc => sc && sc.supplier)
                .map(sc => ({
                  supplier: sc.supplier,
                  price: sc.price,
                  supplier_component_id: sc.supplier_component_id
                })) : [];
            
            // Find the lowest price supplier option
            const selectedSupplier = supplierOptions.length > 0 ?
              supplierOptions.reduce((lowest, current) => {
                return (current.price < lowest.price) ? current : lowest;
              }, supplierOptions[0]) : null;
              
            // Get global requirements for this component
            const globalRequirements = globalRequirementsMap[componentId];
            
            // Add the global requirement fields from detailed component status and global requirements
            const totalRequiredAllOrders = globalRequirements ? 
              globalRequirements.total_required : 
              (status ? status.total_required : requiredQuantity);
                
            const orderCount = globalRequirements ? 
              globalRequirements.order_count : 
              (status ? status.order_count : 1);
                
            const globalApparentShortfall = globalRequirements ? 
              globalRequirements.global_apparent_shortfall : 
              (status ? status.global_apparent_shortfall : apparentShortfall);
                
            const globalRealShortfall = globalRequirements ? 
              globalRequirements.global_real_shortfall : 
              (status ? status.global_real_shortfall : realShortfall);
                
            const orderBreakdown = globalRequirements ? 
              globalRequirements.order_breakdown || [] : 
              (status ? status.order_breakdown || [] : []);
            
            return {
              component_id: componentId,
              internal_code: component.internal_code,
              description: component.description,
              quantity_required: requiredQuantity,
              quantity_in_stock: inStock,
              quantity_on_order: onOrder,
              apparent_shortfall: apparentShortfall,
              real_shortfall: realShortfall,
              is_covered_by_orders: isCovered,
              history: orderHistoryMap[componentId] || [],
              supplier_options: supplierOptions,
              selected_supplier: selectedSupplier,
              // Add global requirement fields
              total_required_all_orders: totalRequiredAllOrders,
              order_count: orderCount,
              global_apparent_shortfall: globalApparentShortfall,
              global_real_shortfall: globalRealShortfall,
              order_breakdown: orderBreakdown
            } as ComponentRequirement;
          }).filter(Boolean) as ComponentRequirement[];
          
          return {
            order_detail_id: detail.order_detail_id,
            product_id: detail.product_id,
            product_name: detail.product?.name || 'Unknown Product',
            order_quantity: detail.quantity,
            components
          } as ProductRequirement;
        } catch (error) {
          console.error(`[ERROR] Error processing order detail ${detail.order_detail_id}:`, error);
          return {
            order_detail_id: detail.order_detail_id,
            product_id: detail.product_id,
            product_name: detail.product?.name || 'Unknown Product',
            order_quantity: detail.quantity,
            components: [],
            error: 'Failed to process components'
          } as ProductRequirement;
        }
      })
    );
    
    console.log(`[DEBUG] Processed ${requirements.length} product requirements with components`);
    
    return requirements;
  } catch (error) {
    console.error(`[ERROR] Error in fetchOrderComponentRequirements:`, error);
    throw error;
  }
}

// Function to fetch component suppliers for ordering
async function fetchComponentSuppliers(orderId: number) {
  try {
    console.log(`[DEBUG] Fetching component suppliers for order ${orderId}`);
    
    // First, get the component requirements for this order
    const requirements = await fetchOrderComponentRequirements(orderId);
    
    // Filter to only components with a real shortfall
    const componentsWithShortfall = requirements.flatMap(req => 
      req.components
        .filter(comp => comp.real_shortfall > 0) // Use real shortfall (after accounting for on-order)
        .map(comp => ({
          component_id: comp.component_id,
          internal_code: comp.internal_code,
          description: comp.description,
          shortfall: comp.real_shortfall,
          quantity_required: comp.quantity_required,
          quantity_on_order: comp.quantity_on_order,
          // Add global requirement data
          total_required_all_orders: comp.total_required_all_orders,
          order_count: comp.order_count,
          global_apparent_shortfall: comp.global_apparent_shortfall,
          global_real_shortfall: comp.global_real_shortfall
        }))
    );
    
    console.log(`[DEBUG] Found ${componentsWithShortfall.length} components with shortfall`);
    
    if (componentsWithShortfall.length === 0) {
      return [];
    }
    
    // For each component with shortfall, find supplier options
    let allSupplierComponents: any[] = [];
    
    for (const comp of componentsWithShortfall) {
      const componentId = comp.component_id;
      
      if (!componentId) {
        console.error(`[ERROR] Missing component ID for:`, comp);
        continue;
      }
      
      const { data, error } = await supabase
        .from('suppliercomponents')
        .select(`
          supplier_component_id,
          price,
          supplier:suppliers(
            supplier_id,
            name,
            contact_info
          )
        `)
        .eq('component_id', componentId);
      
      if (error) {
        console.error(`[ERROR] Error fetching suppliers for component ${componentId}:`, error);
        continue;
      }
      
      if (!data || data.length === 0) {
        console.log(`[DEBUG] No suppliers found for component ${componentId}`);
        continue;
      }
      
      // Add missing fields needed by the UI
      for (const supplierComponent of data) {
        if (supplierComponent.supplier?.supplier_id) {
          // Fetch emails for this supplier
          const { data: emails, error: emailError } = await supabase
            .from('supplier_emails')
            .select('email, is_primary')
            .eq('supplier_id', supplierComponent.supplier.supplier_id);
          
          if (!emailError && emails) {
            // Add emails array to the supplier object
            supplierComponent.supplier.emails = emails.map(e => e.email);
          } else {
            // Empty array if no emails or error
            supplierComponent.supplier.emails = [];
          }
          
          // Add more required fields with default values
          supplierComponent.supplier.address = '';
          supplierComponent.supplier.phone = '';
          supplierComponent.supplier.contact_person = '';
        }
      }
      
      // Add valid supplier components to our list
      const validSupplierComponents = data.filter(d => 
        d.supplier && d.supplier_component_id && d.price !== null
      );
      
      // Attach the component and shortfall info to each supplier component
      const supplierComponentsWithInfo = validSupplierComponents.map(sc => ({
        ...sc,
        component: {
          component_id: comp.component_id,
          internal_code: comp.internal_code,
          description: comp.description
        },
        shortfall: comp.shortfall,
        quantity_required: comp.quantity_required,
        quantity_on_order: comp.quantity_on_order,
        // Add global requirement data
        total_required_all_orders: comp.total_required_all_orders,
        order_count: comp.order_count,
        global_apparent_shortfall: comp.global_apparent_shortfall,
        global_real_shortfall: comp.global_real_shortfall,
        selectedSupplier: {
          supplier: sc.supplier,
          price: sc.price,
          supplier_component_id: sc.supplier_component_id
        },
        supplierOptions: [{
          supplier: sc.supplier,
          price: sc.price,
          supplier_component_id: sc.supplier_component_id
        }]
      }));
      
      allSupplierComponents = [...allSupplierComponents, ...supplierComponentsWithInfo];
    }
    
    console.log(`[DEBUG] Found ${allSupplierComponents.length} supplier components total`);
    
    if (allSupplierComponents.length === 0) {
      return [];
    }
    
    // Group supplier components by supplier
    const supplierGroups = allSupplierComponents.reduce((groups: any[], sc) => {
      // Find if we already have a group for this supplier
      const existingGroup = groups.find(g => 
        g.supplier.supplier_id === sc.supplier.supplier_id
      );
      
      if (existingGroup) {
        // Check if we already have this component in this supplier group
        const existingComp = existingGroup.components.find((c: any) => 
          c.component.component_id === sc.component.component_id
        );
        
        if (existingComp) {
          // If this supplier already has this component listed, add as another option
          existingComp.supplierOptions = [
            ...(existingComp.supplierOptions || []),
            {
              supplier: sc.supplier,
              price: sc.price,
              supplier_component_id: sc.supplier_component_id
            }
          ];
          
          // If the new option is cheaper, make it the selected one
          if (sc.price < existingComp.selectedSupplier.price) {
            existingComp.selectedSupplier = {
              supplier: sc.supplier,
              price: sc.price,
              supplier_component_id: sc.supplier_component_id
            };
          }
        } else {
          // Add component to existing supplier group
          existingGroup.components.push({
            component: sc.component,
            shortfall: sc.shortfall,
            quantity_required: sc.quantity_required,
            quantity_on_order: sc.quantity_on_order,
            // Add global requirement fields
            total_required_all_orders: sc.total_required_all_orders,
            order_count: sc.order_count,
            global_apparent_shortfall: sc.global_apparent_shortfall,
            global_real_shortfall: sc.global_real_shortfall,
            selectedSupplier: {
              supplier: sc.supplier,
              price: sc.price,
              supplier_component_id: sc.supplier_component_id
            },
            supplierOptions: [{
              supplier: sc.supplier,
              price: sc.price,
              supplier_component_id: sc.supplier_component_id
            }]
          });
        }
      } else {
        // Create a new supplier group
        groups.push({
          supplier: sc.supplier,
          components: [{
            component: sc.component,
            shortfall: sc.shortfall,
            quantity_required: sc.quantity_required,
            quantity_on_order: sc.quantity_on_order,
            // Add global requirement fields
            total_required_all_orders: sc.total_required_all_orders,
            order_count: sc.order_count,
            global_apparent_shortfall: sc.global_apparent_shortfall,
            global_real_shortfall: sc.global_real_shortfall,
            selectedSupplier: {
              supplier: sc.supplier,
              price: sc.price,
              supplier_component_id: sc.supplier_component_id
            },
            supplierOptions: [{
              supplier: sc.supplier,
              price: sc.price,
              supplier_component_id: sc.supplier_component_id
            }]
          }]
        });
      }
      
      return groups;
    }, []);
    
    // Sort suppliers by those that can provide the most components
    supplierGroups.sort((a, b) => b.components.length - a.components.length);
    
    console.log(`[DEBUG] Grouped into ${supplierGroups.length} supplier groups`);
    
    return supplierGroups;
  } catch (error) {
    console.error(`[ERROR] Error in fetchComponentSuppliers:`, error);
    return [];
  }
}

// Define types for suppliers and components
type SupplierInfo = {
  supplier_id: number;
  name: string;
  contact_person: string;
  emails: string[];  // Changed from single email to array
  phone: string;
};

// Define the SupplierComponent type
type SupplierComponent = {
  component: any;
  shortfall: number;
  // Add global requirement fields
  total_required_all_orders?: number;
  order_count?: number;
  global_apparent_shortfall?: number;
  global_real_shortfall?: number;
  selectedSupplier: { 
    supplier_component_id: number;
    supplier: SupplierInfo; 
    price: number; 
  };
};

// Define the SupplierGroup type
type SupplierGroup = {
  supplier: SupplierInfo;
  components: SupplierComponent[];
};

// Implement the real purchase order creation function
async function createComponentPurchaseOrders(
  selectedComponents: Record<number, boolean>,
  supplierGroups: SupplierGroup[],
  notes: Record<string, string>,
  orderQuantities: Record<number, number>,
  allocation: Record<number, { forThisOrder: number; forStock: number }>,
  orderId: string
) {
  try {
    // Get the draft status ID
    const { data: statusData, error: statusError } = await supabase
      .from('supplier_order_statuses')
      .select('status_id')
      .eq('status_name', 'Draft')
      .single();

    if (statusError || !statusData) {
      throw new Error('Could not find Draft status in the system');
    }
    
    const draftStatusId = statusData.status_id;
    const today = new Date().toISOString();
    const purchaseOrderIds: number[] = [];
    
    // Process each supplier group that has selected components
    await Promise.all(
      supplierGroups
        .filter(group => 
          group.components.some(c => selectedComponents[c.component.component_id])
        )
        .map(async (group) => {
          // Filter to only selected components
          const selectedComponentsForSupplier = group.components
            .filter(c => selectedComponents[c.component.component_id]);
          
          if (selectedComponentsForSupplier.length === 0) return;
          
          // 1. Create the purchase order
          const { data: purchaseOrder, error: purchaseOrderError } = await supabase
            .from('purchase_orders')
            .insert({
              order_date: today,
              status_id: draftStatusId,
              notes: notes[group.supplier.supplier_id] || '',
              supplier_id: group.supplier.supplier_id,
            })
            .select('purchase_order_id')
            .single();

          if (purchaseOrderError) {
            throw new Error(`Failed to create purchase order for ${group.supplier.name}`);
          }
          
          purchaseOrderIds.push(purchaseOrder.purchase_order_id);
          
          // 2. Create supplier orders for each selected component
          await Promise.all(
            selectedComponentsForSupplier.map(async (component) => {
              const componentId = component.component.component_id;
              // Use orderQuantities if available, otherwise use shortfall
              const orderQuantity = orderQuantities[componentId] || component.shortfall;
              
              // Get allocation or calculate default allocation
              const componentAllocation = allocation[componentId] || {
                forThisOrder: Math.min(orderQuantity, component.shortfall),
                forStock: Math.max(0, orderQuantity - component.shortfall)
              };
              
              // Create supplier order
              const { data: supplierOrder, error: orderError } = await supabase
                .from('supplier_orders')
                .insert({
                  supplier_component_id: component.selectedSupplier.supplier_component_id,
                  order_quantity: orderQuantity, // Removed Math.round to keep decimal quantities
                  order_date: today,
                  status_id: draftStatusId,
                  total_received: 0,
                  purchase_order_id: purchaseOrder.purchase_order_id,
                })
                .select('order_id')
                .single();
              
              if (orderError) {
                throw new Error(`Failed to create order for component ${component.component.internal_code}`);
              }
              
              // 3. Create junction record to link this supplier order to the customer order
              const { error: junctionError } = await supabase
                .from('supplier_order_customer_orders')
                .insert({
                  supplier_order_id: supplierOrder.order_id,
                  order_id: parseInt(orderId), // Parse string to number for the database
                  component_id: componentId,
                  quantity_for_order: componentAllocation.forThisOrder, // Removed Math.round to keep decimal quantities
                  quantity_for_stock: componentAllocation.forStock // Removed Math.round to keep decimal quantities
                });
              
              if (junctionError) {
                throw new Error(`Failed to link component order to customer order: ${junctionError.message}`);
              }
            })
          );
        })
    );
    
    return purchaseOrderIds;
  } catch (error) {
    console.error('Error creating purchase orders:', error);
    throw error;
  }
}

// OrderComponentsDialog component
const OrderComponentsDialog = ({
  orderId,
  open,
  onOpenChange,
  onCreated
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) => {
  const [step, setStep] = useState<'select' | 'review'>('select');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedComponents, setSelectedComponents] = useState<Record<number, boolean>>({});
  const [orderQuantities, setOrderQuantities] = useState<Record<number, number>>({});
  const [allocation, setAllocation] = useState<Record<number, { forThisOrder: number; forStock: number }>>({});
  const [apparentShortfallExists, setApparentShortfallExists] = useState(false);
  
  // Group components by supplier
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['component-suppliers', orderId],
    queryFn: () => fetchComponentSuppliers(Number(orderId)),
  });

  useEffect(() => {
    if (data) {
      // Check if there are components with apparent shortfall but no real shortfall
      const checkApparentShortfall = async () => {
        try {
          const requirements = await fetchOrderComponentRequirements(Number(orderId));
          const hasApparentShortfall = requirements.some(req => 
            req.components.some(comp => comp.apparent_shortfall > 0 && comp.real_shortfall === 0)
          );
          setApparentShortfallExists(hasApparentShortfall);
        } catch (err) {
          console.error("Error checking for apparent shortfall:", err);
        }
      };
      
      checkApparentShortfall();
      
      // Initialize order quantities with shortfall values when data is loaded
      const quantities: Record<number, number> = {};
      const newAllocation: Record<number, { forThisOrder: number; forStock: number }> = {};
      
      data.forEach(group => {
        group.components.forEach(component => {
          const componentId = component.component.component_id;
          quantities[componentId] = component.shortfall;
          newAllocation[componentId] = {
            forThisOrder: component.shortfall,
            forStock: 0
          };
        });
      });
      
      setOrderQuantities(quantities);
      setAllocation(newAllocation);
    }
  }, [data, orderId]);

  const handleReset = () => {
    setStep('select');
    setNotes({});
    setSelectedComponents({});
    
    if (data) {
      const quantities: Record<number, number> = {};
      const newAllocation: Record<number, { forThisOrder: number; forStock: number }> = {};
      
      data.forEach(group => {
        group.components.forEach(component => {
          const componentId = component.component.component_id;
          quantities[componentId] = component.shortfall;
          newAllocation[componentId] = {
            forThisOrder: component.shortfall,
            forStock: 0
          };
        });
      });
      
      setOrderQuantities(quantities);
      setAllocation(newAllocation);
    }
  };

  const handleSelectComponent = (componentId: number, selected: boolean) => {
    setSelectedComponents(prev => ({
      ...prev,
      [componentId]: selected,
    }));
  };

  const handleQuantityChange = (componentId: number, quantity: number) => {
    const newQuantity = Math.max(0, quantity);
    setOrderQuantities(prev => ({
      ...prev,
      [componentId]: newQuantity
    }));
    
    // Update allocation when quantity changes
    updateAllocation(componentId, newQuantity);
  };
  
  const updateAllocation = (componentId: number, totalQuantity: number) => {
    // Find the component to get the shortfall
    let shortfall = 0;
    
    data?.forEach(group => {
      group.components.forEach(component => {
        if (component.component.component_id === componentId) {
          shortfall = component.shortfall;
        }
      });
    });
    
    // Default allocation: prioritize this order's needs first
    const forThisOrder = Math.min(totalQuantity, shortfall);
    const forStock = Math.max(0, totalQuantity - shortfall);
    
    setAllocation(prev => ({
      ...prev,
      [componentId]: { forThisOrder, forStock }
    }));
  };
  
  const handleAllocationChange = (
    componentId: number, 
    field: 'forThisOrder' | 'forStock', 
    value: number
  ) => {
    const newValue = Math.max(0, value);
    
    // Find the component to get the shortfall
    let shortfall = 0;
    data?.forEach(group => {
      group.components.forEach(component => {
        if (component.component.component_id === componentId) {
          shortfall = component.shortfall;
        }
      });
    });
    
    const currentAllocation = allocation[componentId] || { forThisOrder: 0, forStock: 0 };
    let newAllocation = { ...currentAllocation };
    
    if (field === 'forThisOrder') {
      newAllocation = {
        forThisOrder: newValue,
        // If we're decreasing forThisOrder, keep total the same
        forStock: currentAllocation.forThisOrder + currentAllocation.forStock - newValue
      };
    } else {
      newAllocation = {
        // If we're decreasing forStock, keep total the same
        forThisOrder: currentAllocation.forThisOrder + currentAllocation.forStock - newValue,
        forStock: newValue
      };
    }
    
    // Ensure values are not negative
    newAllocation.forThisOrder = Math.max(0, newAllocation.forThisOrder);
    newAllocation.forStock = Math.max(0, newAllocation.forStock);
    
    // Update total quantity to match allocation
    const totalQuantity = newAllocation.forThisOrder + newAllocation.forStock;
    
    setOrderQuantities(prev => ({
      ...prev,
      [componentId]: totalQuantity
    }));
    
    setAllocation(prev => ({
      ...prev,
      [componentId]: newAllocation
    }));
  };

  const handleNoteChange = (supplierId: string, note: string) => {
    setNotes(prev => ({
      ...prev,
      [supplierId]: note,
    }));
  };

  const handleCreatePurchaseOrders = async () => {
    try {
      await createComponentPurchaseOrders(
        selectedComponents, 
        data || [], 
        notes, 
        orderQuantities,
        allocation,
        orderId
      );
      
      // Reset form and close dialog
      handleReset();
      onOpenChange(false);
      if (onCreated) onCreated();
      toast.success("Purchase orders created successfully!");
    } catch (error) {
      console.error('Error creating purchase orders:', error);
      toast.error("Failed to create purchase orders. Please try again.");
    }
  };

  if (isLoading) {
  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Order Components</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="mr-2 h-8 w-8 animate-spin" />
            <span>Loading component information...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Order Components</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-red-500">
            <p>Error loading component information: {error?.toString()}</p>
            <Button onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Order Components</DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? 'Select components to order from suppliers'
              : 'Review and confirm your order'}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-6 max-h-[600px] overflow-y-auto">
            {data && data.length > 0 ? (
              data.map((group) => (
                <Card key={group.supplier.supplier_id} className="overflow-hidden">
                  <CardHeader className="bg-muted">
                    <div className="flex justify-between items-center">
                      <CardTitle>{group.supplier.name}</CardTitle>
                      <div className="text-sm text-muted-foreground">
                        {group.components.length} component(s)
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]"></TableHead>
                          <TableHead>Component</TableHead>
                          <TableHead>Shortfall</TableHead>
                          <TableHead>Order Quantity</TableHead>
                          <TableHead>Allocation</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.components.map((component) => (
                          <TableRow key={component.component.component_id}>
                            <TableCell>
                              <Checkbox
                                checked={selectedComponents[component.component.component_id] === true}
                                onCheckedChange={(checked) =>
                                  handleSelectComponent(
                                    component.component.component_id,
                                    checked === true
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">
                                {component.component.internal_code}
                                {component.total_required_all_orders > component.shortfall && (
                                  <span className="ml-2 inline-flex items-center text-xs font-medium text-blue-500">
                                    <Users className="h-3 w-3 mr-1" />
                                    <span className="sr-only">Required in multiple orders</span>
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {component.component.description}
                              </div>
                              {component.total_required_all_orders > component.shortfall && (
                                <div className="text-xs text-blue-600 mt-1">
                                  Total needed across all orders: {component.total_required_all_orders} 
                                  <span className="mx-1">•</span>
                                  Global shortfall: {component.global_real_shortfall}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className={component.shortfall > 0 ? "text-red-600 font-medium" : ""}>
                                {component.shortfall}
                              </span>
                              {component.global_real_shortfall > component.shortfall && (
                                <div className="text-xs text-amber-600">
                                  +{component.global_real_shortfall - component.shortfall} in other orders
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                value={orderQuantities[component.component.component_id] || 0}
                                onChange={(e) => 
                                  handleQuantityChange(
                                    component.component.component_id, 
                                    parseInt(e.target.value || '0')
                                  )
                                }
                                className="w-20"
                                disabled={!selectedComponents[component.component.component_id]}
                              />
                            </TableCell>
                            <TableCell>
                              {selectedComponents[component.component.component_id] && (
                                <div className="flex flex-col space-y-2">
                                  <div className="flex items-center space-x-2">
                                    <Label htmlFor={`forOrder-${component.component.component_id}`} className="w-20 text-xs">
                                      For Order:
                                    </Label>
                                    <Input
                                      id={`forOrder-${component.component.component_id}`}
                                      type="number"
                                      min="0"
                                      value={allocation[component.component.component_id]?.forThisOrder || 0}
                                      onChange={(e) => 
                                        handleAllocationChange(
                                          component.component.component_id,
                                          'forThisOrder',
                                          parseInt(e.target.value || '0')
                                        )
                                      }
                                      className="w-16 h-8"
                                    />
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <Label htmlFor={`forStock-${component.component.component_id}`} className="w-20 text-xs">
                                      For Stock:
                                    </Label>
                                    <Input
                                      id={`forStock-${component.component.component_id}`}
                                      type="number"
                                      min="0"
                                      value={allocation[component.component.component_id]?.forStock || 0}
                                      onChange={(e) => 
                                        handleAllocationChange(
                                          component.component.component_id,
                                          'forStock',
                                          parseInt(e.target.value || '0')
                                        )
                                      }
                                      className="w-16 h-8"
                                    />
                                  </div>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(component.selectedSupplier.price)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                  <CardFooter className="bg-muted/50 p-4">
                    <div className="w-full">
                      <Label htmlFor={`notes-${group.supplier.supplier_id}`}>Notes for Supplier</Label>
                      <Textarea
                        id={`notes-${group.supplier.supplier_id}`}
                        placeholder="Add any special instructions for this supplier..."
                        value={notes[group.supplier.supplier_id] || ''}
                        onChange={(e) => handleNoteChange(group.supplier.supplier_id, e.target.value)}
                        className="mt-2"
                      />
                    </div>
                  </CardFooter>
                </Card>
              ))
            ) : (
              <div className="text-center p-8">
                <p>No component suppliers found or all components are in stock.</p>
                {apparentShortfallExists && (
                  <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-amber-800">
                      <AlertCircle className="h-4 w-4 inline-block mr-2" />
                      Some components show shortfall but they're already on order. Check the "On Order" column in the Component Requirements table.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-6 max-h-[600px] overflow-y-auto">
            <div className="text-sm text-muted-foreground mb-4">
              Review your selections before creating purchase orders
            </div>

            {data && data.length > 0 ? (
              data
                .filter((group) =>
                  group.components.some(
                    (c) => selectedComponents[c.component.component_id]
                  )
                )
                .map((group) => (
                  <Card key={group.supplier.supplier_id}>
                    <CardHeader>
                      <CardTitle>{group.supplier.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Component</TableHead>
                            <TableHead>Order Qty</TableHead>
                            <TableHead>Allocation</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.components
                            .filter(
                              (c) => selectedComponents[c.component.component_id]
                            )
                            .map((component) => {
                              const orderQty = orderQuantities[component.component.component_id] || component.shortfall;
                              const currentAllocation = allocation[component.component.component_id] || {
                                forThisOrder: component.shortfall,
                                forStock: 0
                              };
                              
                              return (
                                <TableRow key={component.component.component_id}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {component.component.internal_code}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                      {component.component.description}
                                    </div>
                                  </TableCell>
                                  <TableCell>{orderQty}</TableCell>
                                  <TableCell>
                                    <div className="text-xs">
                                      <div>For Order: {currentAllocation.forThisOrder}</div>
                                      <div>For Stock: {currentAllocation.forStock}</div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(component.selectedSupplier.price)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(
                                      component.selectedSupplier.price * orderQty
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell colSpan={4}>Total</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(
                                group.components
                                  .filter(
                                    (c) => selectedComponents[c.component.component_id]
                                  )
                                  .reduce(
                                    (sum, component) =>
                                      sum +
                                      component.selectedSupplier.price *
                                        (orderQuantities[component.component.component_id] ||
                                          component.shortfall),
                                    0
                                  )
                              )}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>

                      {notes[group.supplier.supplier_id] && (
                        <div className="mt-4 p-3 bg-muted rounded-md">
                          <h4 className="font-medium mb-1">Notes:</h4>
                          <p className="text-sm whitespace-pre-line">
                            {notes[group.supplier.supplier_id]}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
            ) : (
              <div className="text-center p-8">
                <p>No components selected for ordering.</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between">
          {step === 'select' ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep('review')}
                disabled={
                  !data ||
                  !Object.values(selectedComponents).some((selected) => selected)
                }
              >
                Review Order
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button onClick={handleCreatePurchaseOrders}>
                Create Purchase Orders
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Add Products Dialog component
function AddProductsDialog({ 
  orderId, 
  onSuccess 
}: { 
  orderId: number | string; // Updated type to accept both number and string
  onSuccess?: () => void; 
}) {
  const [selectedProducts, setSelectedProducts] = useState<Record<number, { quantity: number; price: number }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch available products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['availableProducts'],
    queryFn: fetchAvailableProducts,
  });
  
  // Filter products based on search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    
    const query = searchQuery.toLowerCase();
    return products.filter((product: any) => 
      (product.name || '').toLowerCase().includes(query) || 
      (product.sku || '').toLowerCase().includes(query) ||
      (product.description || '').toLowerCase().includes(query)
    );
  }, [products, searchQuery]);
  
  // Toggle product selection
  const toggleProductSelection = (productId: number) => {
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };
      
      if (newState[productId]) {
        // Product is already selected, unselect it
        delete newState[productId];
      } else {
        // Product is not selected, select it
        const product = products.find((p: any) => p.product_id === productId);
        newState[productId] = {
          quantity: 1,
          price: product?.unit_price || 0
        };
      }
      
      return newState;
    });
  };
  
  // Handle quantity change for a product
  const handleQuantityChange = (productId: number, quantity: number) => {
    if (quantity < 1) return;
    
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };
      
      if (newState[productId]) {
        newState[productId] = {
          ...newState[productId],
          quantity
        };
      }
      
      return newState;
    });
  };
  
  // Handle price change for a product
  const handlePriceChange = (productId: number, price: number) => {
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };
      
      if (newState[productId]) {
        newState[productId] = {
          ...newState[productId],
          price
        };
      }
      
      return newState;
    });
  };
  
  const selectedCount = useMemo(() => {
    return Object.keys(selectedProducts).length;
  }, [selectedProducts]);
  
  const handleSubmit = async () => {
    if (selectedCount === 0) return;
    
    setIsSubmitting(true);
    
    try {
      console.log('[DEBUG] Starting product add submission', { selectedProducts });
      
      // Transform selected products for the API - ensure unit_price is a valid number
      const lineItems = Object.entries(selectedProducts).map(([productId, data]) => ({
        product_id: parseInt(productId),
        quantity: data.quantity,
        unit_price: parseFloat(data.price.toString()) || 0
      }));
      
      console.log('[DEBUG] Prepared line items for submission:', lineItems);
      
      // Convert orderId to number if it's a string
      const orderIdNum = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
      
      if (isNaN(orderIdNum)) {
        throw new Error(`Invalid order ID: ${orderId}`);
      }
      
      console.log('[DEBUG] Converted orderId:', { original: orderId, converted: orderIdNum });
      
      // Show adding toast
      const addingToast = toast.loading('Adding products to order...');
      
      try {
        // Add products to order with simple approach
        const result = await addProductsToOrder(orderIdNum, lineItems);
        
        console.log('[DEBUG] Add products result:', result);
        
        // Dismiss the loading toast
        toast.dismiss(addingToast);
        
        if (result && result.success) {
          const productCount = result.insertedDetails?.length || selectedCount;
          toast.success(`Added ${productCount} product(s) to the order`);
          
          if (onSuccess) {
            // Call the success callback to refresh the order data
            onSuccess();
          }
          
          // Reset form
          setSelectedProducts({});
          setSearchQuery('');
        } else {
          toast.error('Failed to add products to order');
        }
      } catch (error) {
        // Dismiss the loading toast on error
        toast.dismiss(addingToast);
        throw error; // Re-throw to be caught by the outer catch
      }
    } catch (error) {
      console.error('[ERROR] Error adding products to order:', error);
      
      // Show a more informative error message
      let errorMessage = 'Failed to add products to order';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="flex items-center gap-1">
          <Plus className="h-4 w-4" />
          Add Products
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Add Products to Order</DialogTitle>
          <DialogDescription>
            Select products to add to this order.
          </DialogDescription>
        </DialogHeader>
        
        {/* Search input */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products by name, SKU, or description..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading products...</span>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No products found.
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium"></th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Product</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Price</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredProducts.map((product: any) => {
                  const isSelected = !!selectedProducts[product.product_id];
                  return (
                    <tr 
                      key={product.product_id} 
                      className={isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'}
                    >
                      <td className="px-4 py-3 text-center">
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={() => toggleProductSelection(product.product_id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {product.sku || 'No SKU'} 
                            {product.description && ` • ${product.description.substring(0, 50)}${product.description.length > 50 ? '...' : ''}`}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSelected ? (
                          <div className="flex items-center justify-end">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={selectedProducts[product.product_id]?.price || 0}
                              onChange={(e) => handlePriceChange(product.product_id, parseFloat(e.target.value) || 0)}
                              className="w-24 h-8 text-right border rounded px-2"
                            />
                          </div>
                        ) : (
                          <span>{formatCurrency(product.unit_price || 0)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right w-32">
                        {isSelected && (
                          <div className="flex items-center justify-end">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleQuantityChange(product.product_id, Math.max(1, (selectedProducts[product.product_id]?.quantity || 1) - 1))}
                              disabled={selectedProducts[product.product_id]?.quantity <= 1}
                            >
                              <span className="sr-only">Decrease quantity</span>
                              <span className="text-xs">-</span>
                            </Button>
                            <input
                              type="number"
                              min="1"
                              value={selectedProducts[product.product_id]?.quantity || 1}
                              onChange={(e) => handleQuantityChange(product.product_id, parseInt(e.target.value) || 1)}
                              className="w-12 h-8 mx-1 text-center border rounded"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleQuantityChange(product.product_id, (selectedProducts[product.product_id]?.quantity || 1) + 1)}
                            >
                              <span className="sr-only">Increase quantity</span>
                              <span className="text-xs">+</span>
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        
        <DialogFooter className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedCount} product{selectedCount !== 1 ? 's' : ''} selected
          </div>
          <Button 
            onClick={handleSubmit} 
            disabled={selectedCount === 0 || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding Products...
              </>
            ) : (
              'Add to Order'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Function to delete an attachment
async function deleteAttachment(attachmentId: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('order_attachments')
      .delete()
      .eq('attachment_id', attachmentId);

    if (error) {
      console.error('Error deleting attachment:', error);
      throw new Error('Failed to delete attachment');
    }

    return true;
  } catch (error) {
    console.error('Error in deleteAttachment:', error);
    return false;
  }
}

// Debug function to inspect the billofmaterials table
async function inspectBillOfMaterials(productId: number) {
  console.log(`[DEBUG] Inspecting BOM for product ${productId}`);
  
  try {
    // Check what tables exist in the public schema
    const { data: tables, error: tablesError } = await supabase
      .from('pg_catalog.pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');
    
    console.log(`[DEBUG] Available tables:`, tables?.map(t => t.tablename).join(', ') || 'None found');
    
    if (tablesError) {
      console.error(`[ERROR] Error listing tables:`, tablesError);
    }
    
    // Try various possible BOM table names
    const possibleBomTables = ['billofmaterials', 'bill_of_materials', 'product_components', 'bom'];
    
    for (const tableName of possibleBomTables) {
      console.log(`[DEBUG] Checking if table exists: ${tableName}`);
      
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('count(*)')
          .limit(1);
        
        if (!error) {
          console.log(`[DEBUG] Table ${tableName} exists!`);
          
          // If table exists, check for product's BOM
          const { data: productBom, error: productBomError } = await supabase
            .from(tableName)
            .select('*')
            .eq('product_id', productId);
          
          if (!productBomError && productBom && productBom.length > 0) {
            console.log(`[DEBUG] Found ${productBom.length} BOM items for product ${productId} in table ${tableName}`);
            console.log(`[DEBUG] First BOM item:`, JSON.stringify(productBom[0]));
          } else {
            console.log(`[DEBUG] No BOM found for product ${productId} in table ${tableName}`);
          }
        } else {
          console.log(`[DEBUG] Table ${tableName} doesn't exist or not accessible`);
        }
      } catch (err) {
        console.error(`[ERROR] Error checking table ${tableName}:`, err);
      }
    }
    
    // Also try a direct query to see component relationships
    try {
      const { data: productComponents, error: pcError } = await supabase
        .rpc('get_product_components', { product_id: productId });
      
      if (pcError) {
        console.log(`[DEBUG] RPC get_product_components not available:`, pcError.message);
      } else {
        console.log(`[DEBUG] Product components via RPC:`, productComponents);
      }
    } catch (err) {
      console.log(`[DEBUG] RPC not available:`, err);
    }
    
    return {
      tables,
      message: 'Check console logs for full inspection results'
    };
  } catch (error) {
    console.error(`[ERROR] Error in inspectBillOfMaterials:`, error);
    return null;
  }
}

// Add the fetchOrderStatuses function
async function fetchOrderStatuses() {
  try {
    const { data, error } = await supabase
      .from('order_statuses')
      .select('*')
      .order('status_name');

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

// Add updateOrderStatus function
async function updateOrderStatus(orderId: number, statusId: number): Promise<boolean> {
  try {
    const { error } = await supabase
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

// Add fetchAvailableProducts function
async function fetchAvailableProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*');

  if (error) {
    console.error('Error fetching products:', error);
    return [];
  }

  return data;
}

// Add addProductsToOrder function
async function addProductsToOrder(orderId: number, products: { product_id: number; quantity: number; unit_price: number }[]) {
  try {
    console.log('[DEBUG] Starting to add products to order:', { orderId, products });
    
    if (!orderId || !products.length) {
      console.error('[ERROR] Invalid input parameters:', { orderId, productsLength: products.length });
      throw new Error('Invalid parameters for adding products');
    }
    
    // Prepare order details with only the exact fields in the database schema
    const orderDetails = products.map(product => ({
      order_id: orderId,
      product_id: product.product_id,
      quantity: product.quantity,
      unit_price: product.unit_price
    }));
    
    console.log('[DEBUG] Prepared order details:', orderDetails);
    
    // Use a simple single insert operation
    const { data: insertedDetails, error: insertError } = await supabase
      .from('order_details')
      .insert(orderDetails)
      .select();
    
    if (insertError) {
      console.error('[ERROR] Error adding products to order:', insertError);
      throw new Error(`Failed to add products to order: ${insertError.message}`);
    }
    
    console.log('[DEBUG] Successfully added products:', insertedDetails);
    
    // Calculate the total increase
    const totalIncrease = products.reduce((sum, product) => 
      sum + (product.unit_price * product.quantity), 0);
    
    // Update the order total
    if (totalIncrease > 0) {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('order_id', orderId)
        .single();
      
      if (orderError) {
        console.error('[ERROR] Error fetching order total:', orderError);
        // Continue anyway since the products were added successfully
      } else {
        const currentTotal = orderData?.total_amount || 0;
        const newTotal = parseFloat(currentTotal.toString()) + totalIncrease;
        
        console.log('[DEBUG] Updating order total:', { currentTotal, totalIncrease, newTotal });
        
        const { error: updateError } = await supabase
          .from('orders')
          .update({ total_amount: newTotal })
          .eq('order_id', orderId);
        
        if (updateError) {
          console.error('[ERROR] Error updating order total:', updateError);
          // Continue anyway since the products were added successfully
        }
      }
    }
    
    return {
      success: true,
      insertedDetails: insertedDetails || [],
      totalIncrease
    };
  } catch (error) {
    console.error('[ERROR] Error in addProductsToOrder:', error);
    throw error;
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

// Add determineSections function
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

// Add interface for sections
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

// Using shared types from '@/types/orders' for Order, Customer, and OrderDetail

interface SupplierInfo {
  supplier_id: number;
  name: string;
  contact_person: string;
  emails: string[];  // Changed from single email to array
  phone: string;
}

interface SupplierGroup {
  supplier: SupplierInfo;
  components: Array<{
    component: {
      component_id: number;
      internal_code: string;
      description: string;
    };
    shortfall: number;
    quantity_required: number;
    quantity_on_order: number;
    selectedSupplier: {
      supplier: SupplierInfo;
      price: number;
      supplier_component_id: number;
    };
    supplierOptions?: Array<{
      supplier: SupplierInfo;
      price: number;
      supplier_component_id: number;
    }>;
  }>;
}

interface SupplierOrder {
  supplier_id: number;
  order_date: string;
  status: string;
  notes?: string;
  components: Array<{
    supplier_component_id: number;
    order_quantity: number;
    unit_price: number;
  }>;
}

interface OrderComponentsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  onOrderPlaced?: () => void;
}

interface OrderBreakdown {
  order_id: number;
  quantity: number;
  order_date: string;
  status: string;
}

interface SupplierOrderBreakdown {
  supplier_order_id: number;
  supplier_name: string;
  quantity: number;
  received: number;
  status: string;
  order_date: string;
}

interface ComponentRequirement {
  component_id: number;
  internal_code: string;
  description: string;
  total_required: number;
  order_breakdown: OrderBreakdown[];
  in_stock: number;
  on_order: number;
  on_order_breakdown: SupplierOrderBreakdown[];
  apparent_shortfall: number;
  real_shortfall: number;
  supplier_options: Array<{
    supplier: SupplierInfo;
    price: number;
    supplier_component_id: number;
  }>;
  selected_supplier: {
    supplier: SupplierInfo;
    price: number;
    supplier_component_id: number;
  } | null;
}

interface ProductRequirement {
  order_detail_id: number;
  product_id: number;
  product_name: string;
  order_quantity: number;
  components: ComponentRequirement[];
  error?: string;
}

// Add new components for tooltips
function RequirementTooltip({ breakdown }: { breakdown: OrderBreakdown[] }) {
  return (
    <div className="p-2 max-w-sm">
      <p className="font-semibold mb-2">Order Breakdown:</p>
      <ul className="space-y-1">
        {breakdown?.map((order) => (
          <li key={order.order_id} className="text-sm">
            Order #{order.order_id}: {order.quantity} units ({order.status})
            <br />
            <span className="text-xs text-muted-foreground">
              {new Date(order.order_date).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OnOrderTooltip({ breakdown }: { breakdown: SupplierOrderBreakdown[] }) {
  return (
    <div className="p-2 max-w-sm">
      <p className="font-semibold mb-2">Supplier Orders:</p>
      <ul className="space-y-2">
        {breakdown?.map((order) => (
          <li key={order.supplier_order_id} className="text-sm">
            <div className="flex justify-between">
              <span>PO #{order.supplier_order_id}</span>
              <span>{order.status}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {order.supplier_name}
            </div>
            <div className="text-xs">
              Ordered: {order.quantity} | Received: {order.received}
              <br />
              {new Date(order.order_date).toLocaleDateString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Update the component requirements table to use the new tooltips
function ComponentRequirementsTable({ requirements }: { requirements: ComponentRequirement[] }) {
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>Component</TableHead>
          <TableHead className="text-right">Required</TableHead>
          <TableHead className="text-right whitespace-nowrap">
            Total Across Orders
            <span className="sr-only">(Total required across all orders)</span>
          </TableHead>
          <TableHead className="text-right">In Stock</TableHead>
          <TableHead className="text-right">On Order</TableHead>
          <TableHead className="text-right">Apparent Shortfall</TableHead>
          <TableHead className="text-right">Real Shortfall</TableHead>
          <TableHead className="text-right whitespace-nowrap">
            Global Shortfall
            <span className="sr-only">(Total shortfall across all orders)</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requirements?.map((req, index) => (
          <TableRow 
            key={req.component_id}
            className={cn(
              index % 2 === 0 ? "bg-white" : "bg-muted/20",
              "hover:bg-muted/30 transition-all duration-200 ease-in-out"
            )}
          >
            <TableCell>
              <div>
                <p className="font-medium">{req.internal_code}</p>
                <p className="text-sm text-muted-foreground">{req.description}</p>
              </div>
            </TableCell>
            <TableCell className="text-right">
              <Popover>
                <PopoverTrigger>
                  <div className="cursor-help inline-flex items-center">
                    {req.total_required}
                    <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="p-0">
                  <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                    <RequirementTooltip breakdown={req.order_breakdown || []} />
                  </div>
                </PopoverContent>
              </Popover>
            </TableCell>
            <TableCell className="text-right">
              <Popover>
                <PopoverTrigger>
                  <div className="cursor-help inline-flex items-center">
                    <span className={cn(
                      req.total_required_all_orders > req.total_required 
                        ? "text-blue-600" 
                        : "",
                      "font-medium"
                    )}>
                      {req.total_required_all_orders || 0}
                    </span>
                    {req.order_count > 1 && (
                      <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                    )}
                  </div>
                </PopoverTrigger>
                <PopoverContent className="p-0">
                  <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                    <p className="text-sm font-medium mb-2">Required across {req.order_count} orders:</p>
                    <div className="space-y-1 text-sm">
                      {(req.order_breakdown || [])?.map((order: any) => (
                        <div key={order.order_id} className="flex justify-between">
                          <span>Order #{order.order_id}:</span>
                          <span>{order.quantity} units</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </TableCell>
            <TableCell className="text-right font-medium">{req.in_stock}</TableCell>
            <TableCell className="text-right">
              {req.on_order > 0 ? (
                <Popover>
                  <PopoverTrigger>
                    <div className="cursor-help inline-flex items-center">
                      {req.on_order}
                      <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="p-0">
                    <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                      <OnOrderTooltip breakdown={req.on_order_breakdown || []} />
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                req.on_order
              )}
            </TableCell>
            <TableCell className="text-right">
              <span className={cn(
                req.apparent_shortfall > 0 
                  ? "text-orange-600" 
                  : "text-green-600",
                "font-medium"
              )}>
                {req.apparent_shortfall}
              </span>
            </TableCell>
            <TableCell className="text-right">
              {req.apparent_shortfall > 0 && req.real_shortfall === 0 ? (
                <Popover>
                  <PopoverTrigger>
                    <div className="cursor-help inline-flex items-center">
                      <span className="text-green-600 font-medium">{req.real_shortfall}</span>
                      <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="p-0">
                    <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                      <p className="text-sm">This apparent shortfall is covered by existing supplier orders.</p>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <span className={cn(
                  req.real_shortfall > 0 
                    ? "text-red-600" 
                    : "text-green-600",
                  "font-medium"
                )}>
                  {req.real_shortfall}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <span className={cn(
                req.global_real_shortfall > 0 
                  ? "text-red-600" 
                  : req.global_apparent_shortfall > 0 
                    ? "text-amber-600" 
                    : "text-green-600",
                "font-medium"
              )}>
                {req.global_real_shortfall || 0}
              </span>
              {req.global_apparent_shortfall > 0 && req.global_real_shortfall === 0 && (
                <span className="text-xs text-muted-foreground ml-1">(Covered)</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

async function fetchComponentRequirements(orderId: number): Promise<ComponentRequirement[]> {
  const { data, error } = await supabase.rpc('get_detailed_component_status', { p_order_id: orderId });
  
  if (error) {
    console.error('Error fetching component requirements:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    component_id: item.component_id,
    internal_code: item.internal_code,
    description: item.description,
    total_required: item.order_required,
    in_stock: item.in_stock,
    on_order: item.on_order,
    apparent_shortfall: item.apparent_shortfall,
    real_shortfall: item.real_shortfall,
    // Add the new global requirement fields
    total_required_all_orders: item.total_required,
    order_count: item.order_count,
    global_apparent_shortfall: item.global_apparent_shortfall,
    global_real_shortfall: item.global_real_shortfall,
    order_breakdown: item.order_breakdown || [],
    on_order_breakdown: item.on_order_breakdown || [],
    supplier_options: item.supplier_options?.map((opt: any) => ({
      supplier: {
        supplier_id: opt.supplier.supplier_id,
        name: opt.supplier.name,
        contact_person: opt.supplier.contact_person || '',
        emails: opt.supplier.emails || [],
        phone: opt.supplier.phone || ''
      },
      price: opt.price,
      supplier_component_id: opt.supplier_component_id
    })) || [],
    selected_supplier: item.selected_supplier ? {
      supplier: {
        supplier_id: item.selected_supplier.supplier.supplier_id,
        name: item.selected_supplier.supplier.name,
        contact_person: item.selected_supplier.supplier.contact_person || '',
        emails: item.selected_supplier.supplier.emails || [],
        phone: item.selected_supplier.supplier.phone || ''
      },
      price: item.selected_supplier.price,
      supplier_component_id: item.selected_supplier.supplier_component_id
    } : null
  }));
}

export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  const orderId = parseInt(params.orderId, 10);
  // Set initial tab back to details
  const [activeTab, setActiveTab] = useState<string>('details');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [orderComponentsOpen, setOrderComponentsOpen] = useState<boolean>(false);
  const [statusOptions, setStatusOptions] = useState<any[]>([]);
  // Add state for expanded rows
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Add toggle function for product row expansion
  const toggleRowExpansion = (productId: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [productId]: !prev[productId]
    }));
  };

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
  useEffect(() => {
    const getOrderStatuses = async () => {
      try {
        const statuses = await fetchOrderStatuses();
        setStatusOptions(statuses);
      } catch (error) {
        console.error('Error fetching order statuses:', error);
      }
    };
    
    getOrderStatuses();
  }, []);

  // Update order status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ statusId }: { statusId: number }) => updateOrderStatus(orderId, statusId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      toast.success("Order status has been updated successfully");
    },
    onError: () => {
      toast.error("Failed to update order status. Please try again.");
    },
  });

  // Inside the OrderDetailPage component, add this query for component requirements
  const { 
    data: componentRequirements = [], 
    refetch: refetchComponentRequirements
  } = useQuery({
    queryKey: ['orderComponentRequirements', orderId],
    queryFn: () => fetchOrderComponentRequirements(orderId),
    onSuccess: (data) => {
      console.log('Component requirements loaded:', JSON.stringify(data, null, 2));
    }
  });

  // Calculate totals from component requirements
  const totals = useMemo(() => {
    let totalComponents = 0;
    let totalShortfall = 0;
    
    componentRequirements.forEach((productReq: ProductRequirement) => {
      productReq.components.forEach((component: ComponentRequirement) => {
        totalComponents++;
        if (component.real_shortfall > 0) {
          totalShortfall++;
        }
      });
    });
    
    return {
      totalComponents,
      totalShortfall
    };
  }, [componentRequirements]);

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

  // Debug log for tab changes
  const handleTabChange = (value: string) => {
    console.log('Tab changed to:', value);
    setActiveTab(value);
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      await deleteAttachment(attachmentId);
      
      toast.success('Attachment deleted successfully');
      
      // Refresh attachment list
      queryClient.invalidateQueries({ queryKey: ['orderAttachments', orderId] });
    } catch (error) {
      console.error('Error deleting attachment:', error);
      toast.error('Failed to delete attachment');
    }
  };

  if (orderLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          </CardContent>
        </Card>
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

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="space-y-4">
          {/* Content for details tab */}
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Order Dashboard</h2>
            <AddProductsDialog 
              orderId={orderId} 
              onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['order', orderId] });
                queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
                toast.success("Products added successfully");
              }} 
            />
      </div>

          {/* Order Summary Card */}
          <Card>
          <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
          </CardHeader>
          <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-medium mb-2">Customer Details</h3>
                  <p className="text-sm">
                    <span className="font-medium">Customer:</span> {order?.customer?.name || 'N/A'}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Contact:</span> {order?.customer?.contact_person || 'N/A'}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Email:</span> {order?.customer?.email || 'N/A'}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Phone:</span> {order?.customer?.phone || 'N/A'}
                  </p>
                </div>
                <div>
                  <h3 className="font-medium mb-2">Order Information</h3>
                  <p className="text-sm">
                    <span className="font-medium">Order Date:</span> {order?.created_at && format(new Date(order.created_at), 'MMMM d, yyyy')}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Delivery Date:</span> {order?.delivery_date && format(new Date(order.delivery_date), 'MMMM d, yyyy')}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Status:</span> <StatusBadge status={order?.status?.status_name || 'Unknown'} />
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Reference:</span> {order?.customer_reference || 'N/A'}
                  </p>
                </div>
                </div>
          </CardContent>
        </Card>

          {/* Products List */}
          <Card>
          <CardHeader>
              <CardTitle className="text-lg">Products ({order?.details?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {order?.details && order.details.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.details.map((detail: any) => (
                      <TableRow key={detail.order_detail_id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{detail.product?.name}</p>
                            <p className="text-sm text-muted-foreground truncate max-w-md">
                              {detail.product?.description || 'No description available'}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{detail.quantity}</TableCell>
                        <TableCell className="text-right">{formatCurrency(detail.unit_price || 0)}</TableCell>
                        <TableCell className="text-right">{formatCurrency((detail.quantity || 0) * (detail.unit_price || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right">{formatCurrency(order.total_amount || 0)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground">No products in this order</p>
                                </div>
              )}
            </CardContent>
          </Card>

          {/* Components Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Components Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <h3 className="text-sm font-medium text-blue-800 mb-2">Total Components</h3>
                  <p className="text-2xl font-bold text-blue-900">{totals.totalComponents}</p>
                          </div>
                <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                  <h3 className="text-sm font-medium text-amber-800 mb-2">Components with Shortfall</h3>
                  <p className="text-2xl font-bold text-amber-900">{totals.totalShortfall}</p>
                        </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                  <h3 className="text-sm font-medium text-green-800 mb-2">Ready to Assemble</h3>
                  <p className="text-2xl font-bold text-green-900">{totals.totalComponents - totals.totalShortfall}</p>
                      </div>
                </div>
              <div className="mt-4">
                <Link href="#" onClick={(e) => { e.preventDefault(); setActiveTab('components'); }}>
                  <Button variant="outline" size="sm" className="gap-1">
                    <ChevronRight className="h-4 w-4" />
                    View Detailed Components
                  </Button>
                </Link>
              </div>
          </CardContent>
        </Card>

          {/* Financial Summary */}
          <Card>
          <CardHeader>
              <CardTitle className="text-lg">Financial Summary</CardTitle>
          </CardHeader>
          <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(order?.total_amount || 0)}</span>
              </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Tax (15%)</span>
                  <span className="font-medium">{formatCurrency((order?.total_amount || 0) * 0.15)}</span>
                </div>
                <div className="flex justify-between py-1 border-t">
                  <span className="font-medium">Total (incl. tax)</span>
                  <span className="font-bold">{formatCurrency((order?.total_amount || 0) * 1.15)}</span>
                </div>
              </div>
          </CardContent>
        </Card>
        </TabsContent>
        
        <TabsContent value="components" className="space-y-6">
          {/* Debug information card removed */}
          
          {!componentRequirements || componentRequirements.length === 0 ? (
            <Alert className="bg-muted">
              <Terminal className="h-4 w-4" />
              <AlertTitle>No components to display</AlertTitle>
              <AlertDescription>
                No products with bill of materials in this order.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Calculate component totals and global requirements */}
              {(() => {
                // Initialize totals object
                const totals = {
                  totalComponents: 0,
                  totalShortfall: 0,
                  totalGlobalShortfall: 0,
                  multiOrderComponents: 0
                };
                
                // Calculate totals from all components
                componentRequirements?.forEach(prodReq => {
                  if (!prodReq?.components) return;
                  
                  prodReq.components?.forEach(comp => {
                    totals.totalComponents++;
                    
                    if (comp.real_shortfall > 0) {
                      totals.totalShortfall++;
                    }
                    
                    if (comp.global_real_shortfall > 0) {
                      totals.totalGlobalShortfall++;
                    }
                    
                    if (comp.order_count > 1) {
                      totals.multiOrderComponents++;
                    }
                  });
                });
                
                return (
                  <>
                    <div className="flex justify-between items-center mb-3">
                      <h2 className="text-xl font-semibold tracking-tight">
                        Component Requirements
                      </h2>
                      <Button onClick={() => setOrderComponentsOpen(true)} size="sm">
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Order Components
                      </Button>
                    </div>
                    <Card className="shadow-sm border border-muted/40 overflow-hidden">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle>Components needed for this order</CardTitle>
                          <div className="flex items-center gap-2">
                            {totals.totalShortfall > 0 ? (
                              <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-100">
                                {totals.totalShortfall} components with shortfall
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-green-100 text-green-700 hover:bg-green-100">
                                All components available
                              </Badge>
                            )}
                            
                            {/* Global requirements summary */}
                            {totals.totalGlobalShortfall > 0 && (
                              <Badge variant="outline" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                                {totals.totalGlobalShortfall} global shortfalls
                              </Badge>
                            )}
                          </div>
                        </div>
                        <CardDescription>
                          {componentRequirements.length} products with {totals.totalComponents || 0} component requirements
                          {totals.multiOrderComponents > 0 && (
                            <span className="ml-1">
                              (<span className="text-blue-600 font-medium">{totals.multiOrderComponents}</span> components needed across multiple orders)
                            </span>
                          )}
                        </CardDescription>
                        
                        {/* Add global requirements alert if there are components with high global demand */}
                        {totals.multiOrderComponents > 0 && (
                          <div className="mt-2 text-xs p-2 bg-blue-50 text-blue-700 rounded-md flex items-start">
                            <Info className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                            <span>
                              Some components are required by multiple orders. "Total Across Orders" shows the total quantity 
                              needed for all open orders, and "Global Shortfall" indicates potential shortages across all orders.
                            </span>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* Display component requirements here */}
                        <div className="space-y-4">
                          {componentRequirements?.map((productReq: any, index: number) => {
                            const hasShortfall = productReq?.components && productReq.components?.some((c: any) => c.shortfall > 0);
                            const productId = productReq.product_id || `product-${index}`;
                            const isExpanded = !!expandedRows[productId];
                            
                            return (
                              <div key={productReq.order_detail_id || index} className="border rounded-lg overflow-hidden shadow-sm hover:shadow transition-all duration-200">
                                <div 
                                  className={cn(
                                    "p-4 flex justify-between items-center cursor-pointer",
                                    hasShortfall ? 'bg-red-50' : 'bg-white'
                                  )}
                                  onClick={() => toggleRowExpansion(productId)}
                                >
                                  <div>
                                    <h4 className="font-medium flex items-center">
                                      {productReq.product_name || 'Unknown Product'} 
                                      {hasShortfall && (
                                        <Badge variant="destructive" className="ml-2">Shortfall</Badge>
                                      )}
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      Order quantity: {productReq.order_quantity || 0} × {productReq.components?.length || 0} component types
                                    </p>
                                  </div>
                                  <div className="flex items-center">
                                    <Button variant="ghost" size="sm" className="ml-2">
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                                
                                {/* Expanded view with component details */}
                                {isExpanded && productReq.components && productReq.components.length > 0 && (
                                  <div className="bg-muted/30 p-4 border-t animate-in fade-in duration-300">
                                    <div className="overflow-x-auto">
                                      <Table>
                                        <TableHeader className="bg-muted/50">
                                          <TableRow>
                                            <TableHead>Component</TableHead>
                                            <TableHead className="text-right">Required</TableHead>
                                            <TableHead className="text-right whitespace-nowrap">
                                              Total Across Orders
                                              <span className="sr-only">(Total required across all orders)</span>
                                            </TableHead>
                                            <TableHead className="text-right">In Stock</TableHead>
                                            <TableHead className="text-right">On Order</TableHead>
                                            <TableHead className="text-right">Apparent Shortfall</TableHead>
                                            <TableHead className="text-right">Real Shortfall</TableHead>
                                            <TableHead className="text-right whitespace-nowrap">
                                              Global Shortfall
                                              <span className="sr-only">(Total shortfall across all orders)</span>
                                            </TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {productReq.components?.map((component: any, compIndex: number) => (
                                            <TableRow 
                                              key={component.component_id || `comp-${compIndex}`}
                                              className={cn(
                                                compIndex % 2 === 0 ? "bg-white" : "bg-muted/20",
                                                "hover:bg-muted/30 transition-all duration-200 ease-in-out"
                                              )}
                                            >
                                              <TableCell>
                                                <div className="font-medium">{component.internal_code || 'Unknown'}</div>
                                                <div className="text-sm text-muted-foreground">{component.description || 'No description'}</div>
                                              </TableCell>
                                              <TableCell className="text-right font-medium">{component.quantity_required || 0}</TableCell>
                                              <TableCell className="text-right">
                                                <Popover>
                                                  <PopoverTrigger>
                                                    <div className="cursor-help inline-flex items-center">
                                                      <span className={cn(
                                                        component.total_required_all_orders > component.quantity_required 
                                                          ? "text-blue-600" 
                                                          : "",
                                                        "font-medium"
                                                      )}>
                                                        {component.total_required_all_orders || 0}
                                                      </span>
                                                      {component.order_count > 1 && (
                                                        <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                                                      )}
                                                    </div>
                                                  </PopoverTrigger>
                                                  <PopoverContent className="p-0">
                                                    <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                                                      <p className="text-sm font-medium mb-2">Required across {component.order_count} orders:</p>
                                                      <div className="space-y-1 text-sm">
                                                        {(component.order_breakdown || [])?.map((order: any) => (
                                                          <div key={order.order_id} className="flex justify-between">
                                                            <span>Order #{order.order_id}:</span>
                                                            <span>{order.quantity} units</span>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    </div>
                                                  </PopoverContent>
                                                </Popover>
                                              </TableCell>
                                              <TableCell className="text-right font-medium">{component.quantity_in_stock || 0}</TableCell>
                                              <TableCell className="text-right">
                                                {component.quantity_on_order > 0 ? (
                                                  <span className="text-blue-600 font-medium">{component.quantity_on_order}</span>
                                                ) : (
                                                  component.quantity_on_order || 0
                                                )}
                                              </TableCell>
                                              <TableCell className="text-right">
                                                <span className={cn(
                                                  component.apparent_shortfall > 0 
                                                    ? "text-orange-600" 
                                                    : "text-green-600",
                                                  "font-medium"
                                                )}>
                                                  {component.apparent_shortfall || 0}
                                                </span>
                                              </TableCell>
                                              <TableCell className="text-right">
                                                {component.apparent_shortfall > 0 && component.real_shortfall === 0 ? (
                                                  <Popover>
                                                    <PopoverTrigger>
                                                      <div className="cursor-help inline-flex items-center">
                                                        <span className="text-green-600 font-medium">{component.real_shortfall || 0}</span>
                                                        <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                                                      </div>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="p-0">
                                                      <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
                                                        <p className="text-sm">This apparent shortfall is covered by existing supplier orders.</p>
                                                      </div>
                                                    </PopoverContent>
                                                  </Popover>
                                                ) : (
                                                  <span className={cn(
                                                    component.real_shortfall > 0 
                                                      ? "text-red-600" 
                                                      : "text-green-600",
                                                    "font-medium"
                                                  )}>
                                                    {component.real_shortfall || 0}
                                                  </span>
                                                )}
                                              </TableCell>
                                              <TableCell className="text-right">
                                                <span className={cn(
                                                  component.global_real_shortfall > 0 
                                                    ? "text-red-600" 
                                                    : component.global_apparent_shortfall > 0 
                                                      ? "text-amber-600" 
                                                      : "text-green-600",
                                                  "font-medium"
                                                )}>
                                                  {component.global_real_shortfall || 0}
                                                </span>
                                                {component.global_apparent_shortfall > 0 && component.global_real_shortfall === 0 && (
                                                  <span className="text-xs text-muted-foreground ml-1">(Covered)</span>
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                    <OrderComponentsDialog 
                      orderId={orderId.toString()} 
                      open={orderComponentsOpen} 
                      onOpenChange={setOrderComponentsOpen} 
                      onCreated={() => refetchComponentRequirements()}
                    />
                  </>
                );
              })()}
            </>
          )}
        </TabsContent>
        
        <TabsContent value="documents" className="space-y-4">
          {/* Content for documents tab */}
        </TabsContent>
      </Tabs>
    </div>
  );
} 