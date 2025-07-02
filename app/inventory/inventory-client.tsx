'use client'

import { useState, useCallback } from 'react'
import { DataGrid } from '@/components/features/inventory/DataGrid'
import { InventoryFilters } from '@/components/features/inventory/Filters'
import { Button } from '@/components/ui/button'
import { useQueryClient } from '@tanstack/react-query'
import { ComponentDialog } from '@/components/features/inventory/ComponentDialog'
import { InventoryDetails } from '@/components/features/inventory/Details'
import { TransactionHistory } from '@/components/features/inventory/TransactionHistory'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { InventoryItem } from '@/types/inventory'

export type Filters = {
  categoryId: string
  stockLevel: string
  search: string
}

export function InventoryClient() {
  const queryClient = useQueryClient()
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [isComponentDialogOpen, setIsComponentDialogOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>({
    categoryId: 'all',
    stockLevel: 'all',
    search: ''
  })

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }, [queryClient])

  const handleComponentEdit = useCallback((item: InventoryItem) => {
    setSelectedItem(item)
    setIsComponentDialogOpen(true)
  }, [])

  const handleRowSelect = useCallback((item: InventoryItem) => {
    setSelectedItem(item);
  }, []);

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Inventory Management</h1>
        <div className="space-x-2">
          <Button onClick={handleRefresh}>Refresh</Button>
        </div>
      </div>

      <InventoryFilters 
        filters={filters}
        onFiltersChange={setFilters}
      />

      <div className="grid grid-cols-3 gap-6 mt-6">
        <div className="col-span-2">
          <DataGrid 
            onEdit={handleComponentEdit} 
            onRowSelect={handleRowSelect}
            filters={filters}
          />
        </div>
        <div className="space-y-6">
          <Tabs defaultValue="details">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="mt-4">
              <InventoryDetails selectedItem={selectedItem || undefined} />
            </TabsContent>
            <TabsContent value="transactions" className="mt-4">
              <TransactionHistory componentId={selectedItem?.component.component_id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {selectedItem && (
        <ComponentDialog
          open={isComponentDialogOpen}
          onOpenChange={setIsComponentDialogOpen}
          selectedItem={selectedItem}
        />
      )}
    </div>
  )
}