'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth-provider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import Image from 'next/image';
import { Plus, ImageOff, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComponentDialog } from '@/components/inventory/ComponentDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DataTable } from '../../components/ui/data-table';
import { InventoryDetails } from "@/components/inventory/Details"
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryError } from '@/components/ui/query-error';
import { useToast } from "@/components/ui/toast";

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
  },
  {
    accessorKey: 'description',
    header: 'Description',
    cell: (row: Component) => row.description || '-'
  },
  {
    accessorKey: 'category.categoryname',
    header: 'Category',
    cell: (row: Component) => row.category?.categoryname || 'Uncategorized',
    enableFiltering: true
  },
]

export default function InventoryPage() {
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [imageError, setImageError] = useState<{[key: string]: boolean}>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Replace useEffect with useQuery for data fetching
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
        
        // Process inventory data to ensure numeric values
        const processedData = data?.map(component => {
          if (component.inventory && component.inventory.length > 0) {
            // Ensure inventory array items have numeric values
            return {
              ...component,
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
          return component;
        });
        
        return processedData || [];
      } catch (e) {
        console.error('Error fetching components:', e);
        throw e;
      }
    },
    retry: 2, // Retry failed queries up to 2 times
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    staleTime: 10 * 1000, // Consider data stale after 10 seconds
    refetchInterval: 30 * 1000, // Refetch data every 30 seconds
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // Add back the effect to update selected component when components change
  useEffect(() => {
    if (selectedComponent && components.length > 0) {
      const updatedComponent = components.find(c => c.component_id === selectedComponent.component_id);
      if (updatedComponent) {
        setSelectedComponent(updatedComponent);
      }
    }
  }, [components, selectedComponent?.component_id]);

  // Get unique categories
  const categories = useMemo(() => {
    const uniqueCategories = Array.from(new Set(components.map(c => c.category?.categoryname || 'Uncategorized')));
    return ['all', ...uniqueCategories].sort();
  }, [components]);

  // Filter, sort, and paginate components
  const { paginatedComponents, totalPages } = useMemo(() => {
    const filtered = components
      .filter(component => {
        const matchesFilter = (
          component.internal_code?.toLowerCase().includes(filterText.toLowerCase()) ||
          component.description?.toLowerCase().includes(filterText.toLowerCase())
        );
        const matchesCategory = selectedCategory === 'all' || 
          (component.category?.categoryname || 'Uncategorized') === selectedCategory;
        return matchesFilter && matchesCategory;
      })
      .sort((a, b) => {
        if (a.internal_code && !b.internal_code) return -1;
        if (!a.internal_code && b.internal_code) return 1;
        return (a.internal_code || '').localeCompare(b.internal_code || '');
      });

    const totalPages = Math.ceil(filtered.length / pageSize);
    const start = (currentPage - 1) * pageSize;
    const paginatedComponents = filtered.slice(start, start + pageSize);

    return { paginatedComponents, totalPages };
  }, [components, filterText, selectedCategory, currentPage, pageSize]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterText, selectedCategory, pageSize]);

  const getStockStatusColor = (quantity: number, reorderLevel: number | null) => {
    if (quantity <= 0) return "bg-destructive/10 border-destructive text-destructive";
    if (reorderLevel && quantity <= reorderLevel) return "bg-warning/10 border-warning text-warning";
    return "bg-muted border-border";
  };

  const handleDelete = async () => {
    if (!selectedComponent) return;

    try {
      // Delete in order of dependencies
      // 1. Delete inventory transactions
      const { error: transactionsError } = await supabase
        .from('inventory_transactions')
        .delete()
        .eq('component_id', selectedComponent.component_id);

      if (transactionsError) throw transactionsError;

      // 2. Delete inventory records
      const { error: inventoryError } = await supabase
        .from('inventory')
        .delete()
        .eq('component_id', selectedComponent.component_id);

      if (inventoryError) throw inventoryError;

      // 3. Delete supplier components
      const { error: supplierComponentsError } = await supabase
        .from('suppliercomponents')
        .delete()
        .eq('component_id', selectedComponent.component_id);

      if (supplierComponentsError) throw supplierComponentsError;

      // 4. Finally delete the component
      const { error: componentError } = await supabase
        .from('components')
        .delete()
        .eq('component_id', selectedComponent.component_id);

      if (componentError) throw componentError;

      // Update by refreshing data instead of manipulating local state
      refreshData();
      setSelectedComponent(null);
      setDeleteDialogOpen(false);
    } catch (e) {
      console.error('Error deleting component:', e);
      alert('Error deleting component. Please try again.');
    }
  };

  // Function to manually refresh data
  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
    toast({
      title: "Data refreshed",
      children: (
        <p>The inventory data has been refreshed from the database.</p>
      ),
      duration: 3000,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading components...</div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="p-4">
        <QueryError 
          error={queryError} 
          queryKey={['inventory', 'components']} 
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Components</h1>
        <div className="flex space-x-2">
          <Button onClick={refreshData} size="sm" variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedComponent(null)
              setDialogOpen(true)
            }}
          >
            Add Component
          </Button>
        </div>
      </div>

      <div className="flex flex-row gap-4">
        {/* Left side - Component list */}
        <div className="flex-1 overflow-auto">
          <DataTable
            columns={columns}
            data={components}
            onRowClick={setSelectedComponent}
            selectedId={selectedComponent?.component_id}
          />
        </div>

        {/* Right side - Component details */}
        <div className="w-[400px] shrink-0">
          <div className="sticky top-4">
            <InventoryDetails 
              selectedItem={selectedComponent && selectedComponent.inventory && selectedComponent.inventory.length > 0 ? {
                inventory_id: selectedComponent.inventory[0]?.inventory_id || null,
                quantity_on_hand: selectedComponent.inventory[0]?.quantity_on_hand !== null && 
                  selectedComponent.inventory[0]?.quantity_on_hand !== undefined 
                  ? Number(selectedComponent.inventory[0]?.quantity_on_hand) 
                  : 0,
                location: selectedComponent.inventory[0]?.location || "",
                reorder_level: selectedComponent.inventory[0]?.reorder_level !== null && 
                  selectedComponent.inventory[0]?.reorder_level !== undefined 
                  ? Number(selectedComponent.inventory[0]?.reorder_level) 
                  : 0,
                component: {
                  component_id: selectedComponent.component_id || 0,
                  internal_code: selectedComponent.internal_code || "",
                  description: selectedComponent.description || "",
                  image_url: selectedComponent.image_url,
                  category: selectedComponent.category || { cat_id: 0, categoryname: "Uncategorized" },
                  unit: selectedComponent.unit || { unit_id: 0, unit_name: "N/A" }
                },
                supplierComponents: Array.isArray(selectedComponent.supplierComponents) 
                  ? selectedComponent.supplierComponents.map(sc => ({
                      supplier_id: sc?.supplier_id || 0,
                      supplier_code: sc?.supplier_code || "",
                      price: sc?.price || 0,
                      supplier: {
                        name: sc?.supplier?.name || "Unknown Supplier"
                      }
                    }))
                  : []
              } : undefined}
            />
            
            {selectedComponent && (
              <div className="flex gap-2 mt-4 justify-end">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDialogOpen(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Component</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this component? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </div>
      </div>

      <ComponentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        selectedItem={selectedComponent && selectedComponent.inventory && selectedComponent.inventory.length > 0 ? {
          inventory_id: selectedComponent.inventory[0].inventory_id || null,
          quantity_on_hand: selectedComponent.inventory[0].quantity_on_hand !== null && 
            selectedComponent.inventory[0].quantity_on_hand !== undefined 
            ? Number(selectedComponent.inventory[0].quantity_on_hand) 
            : 0,
          location: selectedComponent.inventory[0].location || "",
          reorder_level: selectedComponent.inventory[0].reorder_level !== null && 
            selectedComponent.inventory[0].reorder_level !== undefined
            ? Number(selectedComponent.inventory[0].reorder_level)
            : 0,
          component: {
            component_id: selectedComponent.component_id,
            internal_code: selectedComponent.internal_code,
            description: selectedComponent.description || "",
            image_url: selectedComponent.image_url,
            category: selectedComponent.category || { cat_id: 0, categoryname: "Uncategorized" },
            unit: selectedComponent.unit || { unit_id: 0, unit_name: "N/A" }
          },
          supplierComponents: selectedComponent.supplierComponents?.map(sc => ({
            supplier_id: sc.supplier_id,
            supplier_code: sc.supplier_code,
            price: sc.price,
            supplier: {
              name: sc.supplier?.name || "Unknown Supplier"
            }
          })) || []
        } : undefined}
      />
    </div>
  );
} 