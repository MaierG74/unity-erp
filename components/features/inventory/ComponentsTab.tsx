'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { ComponentDialog } from '@/components/features/inventory/ComponentDialog';
import { DataTable } from '@/components/ui/data-table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from "@/lib/utils";
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

type Component = {
  component_id: number;
  internal_code: string;
  description: string | null;
  image_url: string | null;
  category: {
    cat_id: number;
    categoryname: string;
  } | null;
  unit: {
    unit_id: number;
    unit_code: string;
    unit_name: string;
  } | null;
  inventory: Array<{
    inventory_id: number;
    quantity_on_hand: number;
    location: string | null;
    reorder_level: number | null;
  }> | null;
  supplierComponents: {
    supplier_component_id: number;
    supplier_id: number;
    supplier_code: string;
    price: number;
    supplier?: {
      name: string;
    };
  }[];
};

// Define columns for the DataTable
const columns = [
  {
    accessorKey: 'internal_code',
    header: 'Code',
    editable: true
  },
  {
    accessorKey: 'description',
    header: 'Description',
    cell: (row: Component) => row.description || '-',
    editable: true
  },
  {
    accessorKey: 'category.categoryname',
    header: 'Category',
    enableFiltering: true,
    editable: true
  },
  {
    accessorKey: 'inventory.0.quantity_on_hand',
    header: 'Stock',
    cell: (row: Component) => {
      const quantity = row.inventory?.[0]?.quantity_on_hand || 0;
      const reorderLevel = row.inventory?.[0]?.reorder_level || 0;
      const isLowStock = quantity <= reorderLevel && quantity > 0;
      const isOutOfStock = quantity <= 0;
      
      return (
        <span className={cn(
          isOutOfStock && "text-destructive",
          isLowStock && "text-amber-500"
        )}>
          {quantity}
        </span>
      );
    },
    editable: true
  },
  {
    accessorKey: 'inventory.0.reorder_level',
    header: 'Reorder Level',
    cell: (row: Component) => row.inventory?.[0]?.reorder_level || 0,
    editable: true
  },
  {
    accessorKey: 'on_order_quantity',
    header: 'On Order',
    cell: (row: Component) => {
      const quantity = (row as any).on_order_quantity || 0;
      return (
        <span className={cn(
          quantity > 0 && "text-blue-600 font-medium"
        )}>
          {quantity}
        </span>
      );
    },
    editable: false
  }
]

export function ComponentsTab() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const debouncedFilterText = useDebounce(filterText, 300);
  const [selectedCategory, setSelectedCategory] = useState<string>('_all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('_all');
  const [categorySearch, setCategorySearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch components data
  const { data: components = [], isLoading, error: queryError } = useQuery({
    queryKey: ['inventory', 'components'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('components')
          .select(`
            *,
            category:component_categories (
              cat_id,
              categoryname
            ),
            unit:unitsofmeasure (
              unit_id,
              unit_code,
              unit_name
            ),
            inventory:inventory (
              inventory_id,
              quantity_on_hand,
              location,
              reorder_level
            ),
            transactions:inventory_transactions (
              transaction_id,
              quantity,
              transaction_type,
              transaction_date
            ),
            supplierComponents:suppliercomponents (
              supplier_component_id,
              supplier_id,
              supplier_code,
              price,
              supplier:suppliers (
                name
              )
            )
          `);

        if (error) {
          console.error('Supabase error:', error);
          throw new Error(`Failed to fetch components: ${error.message}`);
        }

        // Fetch on-order quantities from open purchase orders
        const { data: onOrderData, error: onOrderError } = await supabase
          .from('supplier_orders')
          .select(`
            supplier_component_id,
            order_quantity,
            total_received,
            purchase_order:purchase_orders!inner (
              purchase_order_id
            ),
            suppliercomponents!inner (
              component_id
            ),
            status:supplier_order_statuses!inner (
              status_name
            )
          `)
          .in('status.status_name', ['Open', 'In Progress', 'Approved', 'Partially Received', 'Pending Approval']);

        if (onOrderError) {
          console.error('Error fetching on-order data:', onOrderError);
        }

        // Calculate on-order quantity per component
        const onOrderByComponent = new Map<number, number>();
        if (onOrderData) {
          onOrderData.forEach((so: any) => {
            const componentId = so.suppliercomponents?.component_id;
            if (componentId) {
              const pending = (so.order_quantity || 0) - (so.total_received || 0);
              const current = onOrderByComponent.get(componentId) || 0;
              onOrderByComponent.set(componentId, current + pending);
            }
          });
        }

        // Fetch required quantities across all active orders
        const { data: activeOrders, error: ordersError } = await supabase
          .from('orders')
          .select(`
            order_id,
            status:order_statuses!inner (
              status_name
            )
          `)
          .not('status.status_name', 'in', '(Completed,Cancelled)');

        const activeOrderIds = activeOrders?.map(o => o.order_id) || [];

        let requiredData: any[] = [];
        if (activeOrderIds.length > 0) {
          const { data: odData, error: requiredError } = await supabase
            .from('order_details')
            .select(`
              quantity,
              product_id,
              product:products (
                billofmaterials (
                  component_id,
                  quantity_required
                )
              )
            `)
            .in('order_id', activeOrderIds);

          if (requiredError) {
            console.error('Error fetching required-for-orders data:', requiredError);
          } else {
            requiredData = odData || [];
          }
        }

        const requiredByComponent = new Map<number, number>();
        if (requiredData.length > 0) {
          requiredData.forEach((od: any) => {
            const orderQty = Number(od.quantity || 0);
            const bomRows = od.product?.billofmaterials || [];
            if (Array.isArray(bomRows)) {
              bomRows.forEach((bom: any) => {
                const componentId = bom.component_id;
                const qtyRequired = Number(bom.quantity_required || 0);
                if (componentId && qtyRequired > 0) {
                  const totalRequired = orderQty * qtyRequired;
                  const current = requiredByComponent.get(componentId) || 0;
                  requiredByComponent.set(componentId, current + totalRequired);
                }
              });
            }
          });
        }
        
        const processedData = data?.map(component => {
          const onOrderQty = onOrderByComponent.get(component.component_id) || 0;
          const requiredQty = requiredByComponent.get(component.component_id) || 0;
          
          if (component.inventory && component.inventory.length > 0) {
            return {
              ...component,
              on_order_quantity: onOrderQty,
              required_for_orders: requiredQty > 0 ? requiredQty : null,
              inventory: component.inventory.map((inv: any) => ({
                ...inv,
                quantity_on_hand: inv.quantity_on_hand !== null && 
                  inv.quantity_on_hand !== undefined ? 
                  parseInt(inv.quantity_on_hand) : 0,
                reorder_level: inv.reorder_level !== null && 
                  inv.reorder_level !== undefined ? 
                  parseInt(inv.reorder_level) : 0
              }))
            };
          }
          return {
            ...component,
            on_order_quantity: onOrderQty,
            required_for_orders: requiredQty > 0 ? requiredQty : null
          };
        });
        
        return processedData || [];
      } catch (e) {
        console.error('Error fetching components:', e);
        throw e;
      }
    },
    retry: 2,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Get unique categories
  const categories = useMemo(() => {
    const uniqueCategories = Array.from(
      new Set(components.map(c => c.category?.categoryname || 'Uncategorized'))
    ) as string[];
    return ['_all', ...uniqueCategories].sort();
  }, [components]);

  // Get unique suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('supplier_id, name')
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  // Filter and sort components
  const filteredComponents = useMemo(() => {
    const filtered = components
      .filter(component => {
        const searchTerm = debouncedFilterText.toLowerCase();
        const matchesFilter = (
          (component.internal_code?.toLowerCase() ?? '').includes(searchTerm) ||
          (component.description?.toLowerCase() ?? '').includes(searchTerm)
        );
        const matchesCategory = selectedCategory === '_all' || 
          (component.category?.categoryname || 'Uncategorized') === selectedCategory;
          
        const matchesSupplier = selectedSupplier === '_all' || 
          component.supplierComponents?.some(sc => 
            sc.supplier?.name === selectedSupplier
          );
          
        return matchesFilter && matchesCategory && matchesSupplier;
      })
      .sort((a, b) => {
        if (a.internal_code && !b.internal_code) return -1;
        if (!a.internal_code && b.internal_code) return 1;
        return (a.internal_code || '').localeCompare(b.internal_code || '');
      });
    return filtered;
  }, [components, debouncedFilterText, selectedCategory, selectedSupplier]);

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!categorySearch) return categories.filter(c => c !== '_all');
    return categories
      .filter(c => c !== '_all')
      .filter(c => c.toLowerCase().includes(categorySearch.toLowerCase()));
  }, [categories, categorySearch]);

  // Filter suppliers based on search
  const filteredSuppliers = useMemo(() => {
    if (!supplierSearch) return suppliers;
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(supplierSearch.toLowerCase())
    );
  }, [suppliers, supplierSearch]);

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
    toast({
      title: "Data refreshed",
      description: "The inventory data has been refreshed from the database."
    });
  }, [queryClient, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg">Loading components...</div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="p-4">
        <div className="text-destructive">Error loading components: {(queryError as Error).message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="inline-flex gap-2 p-3 bg-card rounded-xl border shadow-sm">
        <Button onClick={refreshData} className="h-9" variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
          <Button
            className="h-9"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Component
          </Button>
      </div>

      {/* Filter row */}
      <div className="p-3 bg-card rounded-xl border shadow-sm">
        <div className="mx-auto flex flex-col md:flex-row max-w-5xl items-center justify-center gap-4">
          {/* Search */}
          <div className="relative w-full md:w-[520px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by code or description..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full h-9 pl-9 pr-10 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                aria-label="Clear search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Category */}
          <div className="inline-flex items-center gap-2 w-full md:w-auto">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Category</span>
            <Select 
              value={selectedCategory} 
              onValueChange={(value) => {
                setSelectedCategory(value);
                setCategorySearch('');
              }}
            >
              <SelectTrigger className="h-9 w-full md:w-44">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Categories</SelectItem>
                <div className="p-2 border-t border-b">
                  <Input
                    placeholder="Search categories..."
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    className="mb-1 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                {filteredCategories.length > 0 ? (
                  filteredCategories.map(category => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))
                ) : (
                  <div className="p-2 text-center text-sm text-muted-foreground">
                    No matching categories
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Supplier */}
          <div className="inline-flex items-center gap-2 w-full md:w-auto">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Supplier</span>
            <Select 
              value={selectedSupplier} 
              onValueChange={(value) => {
                setSelectedSupplier(value);
                setSupplierSearch('');
              }}
            >
              <SelectTrigger className="h-9 w-full md:w-48">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Suppliers</SelectItem>
                <div className="p-2 border-t border-b">
                  <Input
                    placeholder="Search suppliers..."
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    className="mb-1 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                {filteredSuppliers.length > 0 ? (
                  filteredSuppliers.map(supplier => (
                    <SelectItem key={supplier.supplier_id} value={supplier.name}>
                      {supplier.name}
                    </SelectItem>
                  ))
                ) : (
                  <div className="p-2 text-center text-sm text-muted-foreground">
                    No matching suppliers
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Component list - full width */}
      <div className="rounded-xl border bg-card shadow-sm overflow-auto">
        <DataTable
          columns={columns}
          data={filteredComponents}
          onRowClick={(component: Component) => {
            router.push(`/inventory/components/${component.component_id}`);
          }}
          hideFilters={true}
        />
      </div>

      <ComponentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        selectedItem={undefined}
      />
    </div>
  );
}

