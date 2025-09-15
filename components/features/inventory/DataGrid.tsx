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
import { supabase } from '@/lib/supabase'
import type { InventoryItem } from '@/types/inventory'
import type { Filters } from '@/app/inventory/inventory-client'
import { Button } from "@/components/ui/button"
import { Pencil, Loader2, PlusCircle, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { EditableCell } from './EditableCell'
import { useUpdateComponent } from '@/hooks/use-update-component'
import { useChangeCategory } from '@/hooks/use-change-category'
import { useUpdateInventory } from '@/hooks/use-update-inventory'
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
} from "@/components/ui/alert-dialog"

interface DataGridProps {
  onRowSelect?: (item: InventoryItem) => void
  onEdit?: (item: InventoryItem) => void
  filters: Filters
}

export function DataGrid({ onRowSelect, onEdit, filters }: DataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const queryClient = useQueryClient()
  const updateComponentMutation = useUpdateComponent()
  const changeCategoryMutation = useChangeCategory()
  const updateInventoryMutation = useUpdateInventory()
  
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
            component:components (
              component_id,
              internal_code,
              description,
              image_url,
              category:component_categories (
                cat_id,
                categoryname
              ),
              unit:unitsofmeasure (
                unit_id,
                unit_name
              )
            ),
            supplierComponents:suppliercomponents (
              supplier_id,
              supplier_code,
              price,
              supplier:suppliers (
                name
              )
            )
          `)

        if (error) throw error
        return data || []
      } catch (e) {
        console.error('Error fetching inventory:', e)
        throw e
      }
    }
  })

  // Columns with editable cells
  const columns = [
    {
      accessorKey: "component.internal_code",
      header: "Code",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const value = row.getValue("component.internal_code") as string
        
        return (
          <EditableCell 
            value={value}
            onSave={async (newValue) => {
              await updateComponentMutation.mutateAsync({
                componentId: row.original.component.component_id,
                data: { internal_code: newValue }
              })
            }}
          />
        )
      }
    },
    {
      accessorKey: "component.description",
      header: "Description",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const value = row.getValue("component.description") as string
        
        return (
          <EditableCell 
            value={value || ""}
            onSave={async (newValue) => {
              await updateComponentMutation.mutateAsync({
                componentId: row.original.component.component_id,
                data: { description: newValue }
              })
            }}
          />
        )
      }
    },
    {
      accessorKey: "component.category.categoryname",
      header: "Category",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const value = row.getValue("component.category.categoryname") as string
        
        return (
          <EditableCell 
            value={value || "Uncategorized"}
            onSave={async (newValue) => {
              await changeCategoryMutation.mutateAsync({
                componentId: row.original.component.component_id,
                categoryName: newValue
              })
            }}
          />
        )
      }
    },
    {
      accessorKey: "quantity_on_hand",
      header: "Quantity",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const value = row.getValue("quantity_on_hand") as number
        
        return (
          <EditableCell 
            value={value?.toString() || "0"}
            onSave={async (newValue) => {
              await updateInventoryMutation.mutateAsync({
                inventoryId: row.original.inventory_id,
                data: { 
                  quantity_on_hand: Number(newValue) || 0
                }
              })
            }}
          />
        )
      }
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const value = row.getValue("location") as string
        
        return (
          <EditableCell 
            value={value || ""}
            onSave={async (newValue) => {
              await updateInventoryMutation.mutateAsync({
                inventoryId: row.original.inventory_id,
                data: { location: newValue }
              })
            }}
          />
        )
      }
    },
    {
      accessorKey: "reorder_level",
      header: "Reorder Level",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const value = row.getValue("reorder_level") as number
        
        return (
          <EditableCell 
            value={value?.toString() || "0"}
            onSave={async (newValue) => {
              await updateInventoryMutation.mutateAsync({
                inventoryId: row.original.inventory_id,
                data: { 
                  reorder_level: Number(newValue) || 0
                }
              })
            }}
          />
        )
      }
    },
    {
      id: "actions",
      cell: ({ row }: { row: Row<InventoryItem> }) => {
        const item = row.original

        const handleDelete = async () => {
          // Call server route to cascade delete using service role
          const res = await fetch(`/api/inventory/components/${item.component.component_id}`, {
            method: 'DELETE'
          })
          if (!res.ok) {
            const msg = await res.text().catch(() => 'Failed to delete')
            throw new Error(msg)
          }
          // Refresh list
          await queryClient.invalidateQueries({ queryKey: ['inventory'] })
        }

        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit?.(item)}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructiveSoft" size="icon" title="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Component</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the component and related data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )
      },
    }
  ]

  // Apply filters
  const filteredData = useMemo(() => {
    return inventoryData.filter(item => {
      // Text search
      const matchesSearch = !filters.search || [
        item.component?.internal_code,
        item.component?.description
      ].some(field => 
        field?.toLowerCase().includes(filters.search.toLowerCase())
      )

      // Category filter
      const matchesCategory = !filters.categoryId || 
        item.component?.category?.categoryname === filters.categoryId

      // Stock status filter
      let matchesStatus = true
      if (filters.stockLevel === 'in-stock') {
        matchesStatus = (item.quantity_on_hand || 0) > 0
      } else if (filters.stockLevel === 'out-of-stock') {
        matchesStatus = (item.quantity_on_hand || 0) <= 0
      } else if (filters.stockLevel === 'low-stock') {
        matchesStatus = (item.quantity_on_hand || 0) <= (item.reorder_level || 0) && (item.quantity_on_hand || 0) > 0
      }

      return matchesSearch && matchesCategory && matchesStatus
    })
  }, [inventoryData, filters])

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
      onEdit
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Failed to load inventory data</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </CardContent>
        <CardFooter>
          <Button 
            variant="outline" 
            onClick={() => queryClient.invalidateQueries({ queryKey: ['inventory'] })}
          >
            Retry
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => {
                    // On row click, select and open edit dialog per spec
                    onRowSelect?.(row.original)
                    onEdit?.(row.original)
                  }}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, {
                        ...cell.getContext(),
                        row: row
                      })}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      <div className="flex items-center justify-end space-x-2">
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
