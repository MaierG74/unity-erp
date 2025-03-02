'use client'

import { useMemo, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  getFilteredRowModel,
  Row,
  type Table as TableType,
} from "@tanstack/react-table"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import type { InventoryItem } from '@/types/inventory'
import type { Filters } from '@/app/inventory/inventory-client'
import { Button } from "@/components/ui/button"
import { Pencil, Loader2, PlusCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface DataGridProps {
  onRowSelect?: (item: InventoryItem) => void
  onEdit?: (item: InventoryItem) => void
  filters: Filters
}

const columns = [
  {
    accessorKey: "component.internal_code",
    header: "Code",
  },
  {
    accessorKey: "component.description",
    header: "Description",
  },
  {
    accessorKey: "component.unit.unit_name",
    header: "Unit",
  },
  {
    accessorKey: "component.category.categoryname",
    header: "Category",
  },
  {
    accessorKey: "quantity_on_hand",
    header: "Quantity",
  },
  {
    accessorKey: "reorder_level",
    header: "Reorder Level",
  },
  {
    id: "actions",
    cell: ({ row, table }: { row: Row<InventoryItem>; table: TableType<InventoryItem> }) => {
      const item = row.original
      const { onEdit } = table.options.meta as { onEdit?: (item: InventoryItem) => void }
      
      return (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation() // Prevent row selection
            onEdit?.(item)
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )
    },
  }
]

// Sample data for demonstration
const sampleData: InventoryItem[] = [
  {
    inventory_id: 1,
    quantity_on_hand: 50,
    location: 'Shelf A-1',
    reorder_level: 10,
    component: {
      component_id: 1,
      internal_code: 'E001',
      description: 'Microcontroller Board',
      image_url: null,
      category: {
        cat_id: 1,
        categoryname: 'Electronics'
      },
      unit: {
        unit_id: 1,
        unit_name: 'Each'
      }
    },
    supplierComponents: [
      {
        supplier_id: 1,
        supplier_code: 'SUP-ACM-E001',
        price: 45.99,
        supplier: {
          name: 'Acme Electronics'
        }
      }
    ]
  },
  {
    inventory_id: 2,
    quantity_on_hand: 25,
    location: 'Shelf B-3',
    reorder_level: 15,
    component: {
      component_id: 2,
      internal_code: 'E002',
      description: 'LED Display Module',
      image_url: null,
      category: {
        cat_id: 1,
        categoryname: 'Electronics'
      },
      unit: {
        unit_id: 1,
        unit_name: 'Each'
      }
    },
    supplierComponents: [
      {
        supplier_id: 1,
        supplier_code: 'SUP-ACM-E002',
        price: 32.50,
        supplier: {
          name: 'Acme Electronics'
        }
      }
    ]
  },
  {
    inventory_id: 3,
    quantity_on_hand: 100,
    location: 'Shelf C-2',
    reorder_level: 20,
    component: {
      component_id: 3,
      internal_code: 'M001',
      description: 'Aluminum Enclosure',
      image_url: null,
      category: {
        cat_id: 2,
        categoryname: 'Mechanical'
      },
      unit: {
        unit_id: 1,
        unit_name: 'Each'
      }
    },
    supplierComponents: [
      {
        supplier_id: 2,
        supplier_code: 'SUP-GLO-M001',
        price: 18.75,
        supplier: {
          name: 'Global Parts Inc.'
        }
      }
    ]
  },
  {
    inventory_id: 4,
    quantity_on_hand: 5,
    location: 'Shelf D-4',
    reorder_level: 25,
    component: {
      component_id: 4,
      internal_code: 'F001',
      description: 'M3 Screws',
      image_url: null,
      category: {
        cat_id: 3,
        categoryname: 'Fasteners'
      },
      unit: {
        unit_id: 5,
        unit_name: 'Pack'
      }
    },
    supplierComponents: [
      {
        supplier_id: 3,
        supplier_code: 'SUP-FAS-F001',
        price: 8.99,
        supplier: {
          name: 'FastFix Supplies'
        }
      }
    ]
  },
  {
    inventory_id: 5,
    quantity_on_hand: 75,
    location: 'Shelf E-1',
    reorder_level: 30,
    component: {
      component_id: 5,
      internal_code: 'R001',
      description: 'Copper Wire',
      image_url: null,
      category: {
        cat_id: 4,
        categoryname: 'Raw Materials'
      },
      unit: {
        unit_id: 3,
        unit_name: 'Meter'
      }
    },
    supplierComponents: [
      {
        supplier_id: 4,
        supplier_code: 'SUP-RAW-R001',
        price: 12.25,
        supplier: {
          name: 'Raw Materials Co.'
        }
      }
    ]
  }
];

export function DataGrid({ onRowSelect, onEdit, filters }: DataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const queryClient = useQueryClient()
  
  const { data: inventoryData = [], isLoading, isError, error } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      try {
        // Fetch inventory with related data using Supabase relationships
        const { data, error } = await supabase
          .from('inventory')
          .select(`
            inventory_id,
            quantity_on_hand,
            location,
            reorder_level,
            component:component_id (
              component_id,
              internal_code,
              description,
              image_url,
              category:category_id (
                cat_id,
                categoryname
              ),
              unit:unit_id (
                unit_id,
                unit_name
              )
            )
          `)
          .order('inventory_id')
        
        if (error) {
          console.error('Error fetching inventory:', error)
          throw error
        }
        
        if (!data || data.length === 0) {
          console.log('No inventory data found')
          return []
        }
        
        // Extract component IDs for supplier query
        const componentIds = data.map(item => {
          // Ensure component exists and has a component_id
          if (!item.component || typeof item.component !== 'object') {
            console.warn('Invalid component data:', item)
            return null
          }
          return (item.component as any).component_id
        }).filter(Boolean) as number[]
        
        // Fetch supplier components for each inventory item
        const { data: supplierComponentsData, error: supplierError } = await supabase
          .from('suppliercomponents')
          .select(`
            supplier_component_id,
            component_id,
            supplier_id,
            supplier_code,
            price,
            supplier:supplier_id (
              name
            )
          `)
          .in('component_id', componentIds)
        
        if (supplierError) {
          console.error('Error fetching supplier components:', supplierError)
          // Continue without supplier data rather than failing completely
        }
        
        // Group supplier components by component_id
        const supplierComponentsMap: Record<number, any[]> = {}
        
        if (supplierComponentsData) {
          supplierComponentsData.forEach(sc => {
            const componentId = (sc as any).component_id
            if (!componentId) return
            
            if (!supplierComponentsMap[componentId]) {
              supplierComponentsMap[componentId] = []
            }
            
            const supplier = (sc as any).supplier
            
            supplierComponentsMap[componentId].push({
              supplier_id: (sc as any).supplier_id,
              supplier_code: (sc as any).supplier_code || '',
              price: (sc as any).price || 0,
              supplier: {
                name: supplier && typeof supplier === 'object' ? supplier.name || 'Unknown Supplier' : 'Unknown Supplier'
              }
            })
          })
        }
        
        // Map the data to the InventoryItem type
        return data.map(item => {
          const component = item.component as any
          
          if (!component) {
            console.warn('Missing component data for item:', item)
            return null
          }
          
          const category = component.category || { cat_id: 0, categoryname: 'Unknown' }
          const unit = component.unit || { unit_id: 0, unit_name: 'Unknown' }
          
          return {
            inventory_id: item.inventory_id,
            quantity_on_hand: item.quantity_on_hand || 0,
            location: item.location || '',
            reorder_level: item.reorder_level || 0,
            component: {
              component_id: component.component_id,
              internal_code: component.internal_code || '',
              description: component.description || '',
              image_url: component.image_url,
              category: {
                cat_id: category.cat_id || 0,
                categoryname: category.categoryname || 'Unknown'
              },
              unit: {
                unit_id: unit.unit_id || 0,
                unit_name: unit.unit_name || 'Unknown'
              }
            },
            supplierComponents: supplierComponentsMap[component.component_id] || []
          }
        }).filter(Boolean) as InventoryItem[]
      } catch (error) {
        console.error('Error fetching data:', error)
        throw error
      }
    }
  })

  // Mutation to add sample data
  const addSampleDataMutation = useMutation({
    mutationFn: async () => {
      // Add sample categories
      const categories = [
        { categoryname: 'Electronics' },
        { categoryname: 'Mechanical' },
        { categoryname: 'Fasteners' },
        { categoryname: 'Raw Materials' },
        { categoryname: 'Packaging' }
      ];
      
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('component_categories')
        .upsert(categories, { onConflict: 'categoryname' })
        .select();
      
      if (categoriesError) {
        throw new Error(`Error adding categories: ${categoriesError.message}`);
      }
      
      // Add units
      const units = [
        { unit_code: 'EA', unit_name: 'Each' },
        { unit_code: 'KG', unit_name: 'Kilogram' },
        { unit_code: 'M', unit_name: 'Meter' },
        { unit_code: 'L', unit_name: 'Liter' },
        { unit_code: 'PK', unit_name: 'Pack' }
      ];
      
      const { data: unitsData, error: unitsError } = await supabase
        .from('unitsofmeasure')
        .upsert(units, { onConflict: 'unit_code' })
        .select();
      
      if (unitsError) {
        throw new Error(`Error adding units: ${unitsError.message}`);
      }
      
      // Add suppliers
      const suppliers = [
        { name: 'Acme Electronics', contact_info: 'contact@acme.com' },
        { name: 'Global Parts Inc.', contact_info: 'sales@globalparts.com' },
        { name: 'FastFix Supplies', contact_info: 'info@fastfix.com' },
        { name: 'Raw Materials Co.', contact_info: 'orders@rawmaterials.com' },
        { name: 'PackRight Solutions', contact_info: 'service@packright.com' }
      ];
      
      const { data: suppliersData, error: suppliersError } = await supabase
        .from('suppliers')
        .upsert(suppliers, { onConflict: 'name' })
        .select();
      
      if (suppliersError) {
        throw new Error(`Error adding suppliers: ${suppliersError.message}`);
      }
      
      // Add components
      const components = [
        {
          internal_code: 'E001',
          description: 'Microcontroller Board',
          unit_id: unitsData?.find(u => u.unit_code === 'EA')?.unit_id || 1,
          category_id: categoriesData?.find(c => c.categoryname === 'Electronics')?.cat_id || 1,
          image_url: null
        },
        {
          internal_code: 'E002',
          description: 'LED Display Module',
          unit_id: unitsData?.find(u => u.unit_code === 'EA')?.unit_id || 1,
          category_id: categoriesData?.find(c => c.categoryname === 'Electronics')?.cat_id || 1,
          image_url: null
        },
        {
          internal_code: 'M001',
          description: 'Aluminum Enclosure',
          unit_id: unitsData?.find(u => u.unit_code === 'EA')?.unit_id || 1,
          category_id: categoriesData?.find(c => c.categoryname === 'Mechanical')?.cat_id || 2,
          image_url: null
        },
        {
          internal_code: 'F001',
          description: 'M3 Screws',
          unit_id: unitsData?.find(u => u.unit_code === 'PK')?.unit_id || 5,
          category_id: categoriesData?.find(c => c.categoryname === 'Fasteners')?.cat_id || 3,
          image_url: null
        },
        {
          internal_code: 'R001',
          description: 'Copper Wire',
          unit_id: unitsData?.find(u => u.unit_code === 'M')?.unit_id || 3,
          category_id: categoriesData?.find(c => c.categoryname === 'Raw Materials')?.cat_id || 4,
          image_url: null
        }
      ];
      
      const { data: componentsData, error: componentsError } = await supabase
        .from('components')
        .upsert(components, { onConflict: 'internal_code' })
        .select();
      
      if (componentsError) {
        throw new Error(`Error adding components: ${componentsError.message}`);
      }
      
      // Add inventory items
      const inventory = componentsData?.map(component => ({
        component_id: component.component_id,
        quantity_on_hand: Math.floor(Math.random() * 100),
        location: `Shelf ${String.fromCharCode(65 + Math.floor(Math.random() * 6))}-${Math.floor(Math.random() * 10) + 1}`,
        reorder_level: Math.floor(Math.random() * 20) + 5
      })) || [];
      
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .upsert(inventory, { onConflict: 'component_id' })
        .select();
      
      if (inventoryError) {
        throw new Error(`Error adding inventory: ${inventoryError.message}`);
      }
      
      // Add supplier components
      const supplierComponents: Array<{
        component_id: number;
        supplier_id: number;
        supplier_code: string;
        price: number;
        lead_time: number;
        min_order_quantity: number;
      }> = [];
      
      if (componentsData && suppliersData) {
        // For each component, add 1-3 supplier options
        componentsData.forEach(component => {
          const numSuppliers = Math.floor(Math.random() * 3) + 1;
          // Create a copy of the suppliers array and shuffle it
          const shuffledSuppliers = [...suppliersData].sort(() => 0.5 - Math.random());
          
          for (let i = 0; i < numSuppliers && i < shuffledSuppliers.length; i++) {
            const supplier = shuffledSuppliers[i];
            supplierComponents.push({
              component_id: component.component_id,
              supplier_id: supplier.supplier_id,
              supplier_code: `SUP-${supplier.name.substring(0, 3).toUpperCase()}-${component.internal_code}`,
              price: parseFloat((Math.random() * 100 + 10).toFixed(2)),
              lead_time: Math.floor(Math.random() * 14) + 1,
              min_order_quantity: Math.floor(Math.random() * 10) + 1
            });
          }
        });
      }
      
      if (supplierComponents.length > 0) {
        const { error: supplierComponentsError } = await supabase
          .from('suppliercomponents')
          .upsert(supplierComponents);
        
        if (supplierComponentsError) {
          throw new Error(`Error adding supplier components: ${supplierComponentsError.message}`);
        }
      }
      
      // Add inventory transactions
      const transactions: Array<{
        component_id: number;
        quantity: number;
        transaction_type: 'IN' | 'OUT';
        transaction_date: string;
        order_id: null;
      }> = [];
      
      if (inventoryData) {
        // For each inventory item, add 0-5 transactions
        inventoryData.forEach(item => {
          const numTransactions = Math.floor(Math.random() * 6);
          
          for (let i = 0; i < numTransactions; i++) {
            const isIncoming = Math.random() > 0.5;
            const quantity = Math.floor(Math.random() * 20) + 1;
            
            // Create transaction date within the last 30 days
            const date = new Date();
            date.setDate(date.getDate() - Math.floor(Math.random() * 30));
            
            transactions.push({
              component_id: item.component_id,
              quantity: isIncoming ? quantity : -quantity,
              transaction_type: isIncoming ? 'IN' : 'OUT',
              transaction_date: date.toISOString(),
              order_id: null
            });
          }
        });
      }
      
      if (transactions.length > 0) {
        const { error: transactionsError } = await supabase
          .from('inventory_transactions')
          .upsert(transactions);
        
        if (transactionsError) {
          throw new Error(`Error adding transactions: ${transactionsError.message}`);
        }
      }
      
      return true;
    },
    onSuccess: () => {
      // Invalidate queries to refetch data
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    }
  });

  // Memoize the filtered data
  const filteredData = useMemo(() => {
    // If no real data, use sample data for demonstration
    const dataToFilter = inventoryData.length > 0 ? inventoryData : [];
    
    return dataToFilter.filter(item => {
      // Category filter
      if (filters.categoryId !== 'all' && item.component?.category?.cat_id.toString() !== filters.categoryId) {
        return false
      }

      // Stock level filter
      if (filters.stockLevel !== 'all') {
        switch (filters.stockLevel) {
          case 'in-stock':
            if (item.quantity_on_hand <= 0) return false
            break
          case 'low-stock':
            if (item.quantity_on_hand > item.reorder_level) return false
            break
          case 'out-of-stock':
            if (item.quantity_on_hand > 0) return false
            break
        }
      }

      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        return (
          item.component.internal_code.toLowerCase().includes(searchLower) ||
          item.component.description.toLowerCase().includes(searchLower)
        )
      }

      return true
    })
  }, [inventoryData, filters.categoryId, filters.stockLevel, filters.search])

  // Memoize the table instance
  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
    meta: {
      onEdit,
    },
  })

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
        <p>Loading inventory data...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-8 text-center text-destructive">
        <p>Error loading inventory data</p>
        <p className="text-sm">{error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    )
  }

  // If no data, show a message and option to add sample data
  if (inventoryData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Inventory Data</CardTitle>
          <CardDescription>
            There are no inventory items in the database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-4">
            You can add sample data to get started with the inventory management system.
          </p>
          <Button 
            onClick={() => addSampleDataMutation.mutate()}
            disabled={addSampleDataMutation.isPending}
          >
            {addSampleDataMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding Sample Data...
              </>
            ) : (
              <>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Sample Data
              </>
            )}
          </Button>
          {addSampleDataMutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              Error: {addSampleDataMutation.error instanceof Error 
                ? addSampleDataMutation.error.message 
                : 'Unknown error'}
            </p>
          )}
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          Alternatively, you can manually add inventory items using the component dialog.
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onRowSelect?.(row.original as InventoryItem)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end space-x-2 p-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  )
} 