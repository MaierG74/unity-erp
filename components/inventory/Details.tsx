'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { InventoryItem } from '@/types/inventory'

type InventoryDetailsProps = {
  selectedItem?: InventoryItem
}

export function InventoryDetails({ selectedItem }: InventoryDetailsProps) {
  if (!selectedItem) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Item Details</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          Select an item to view details
        </CardContent>
      </Card>
    )
  }

  const stockStatus = selectedItem.quantity_on_hand === 0 
    ? "Out of Stock"
    : selectedItem.quantity_on_hand <= selectedItem.reorder_level
    ? "Low Stock"
    : "In Stock"

  const stockStatusColor = {
    "Out of Stock": "destructive",
    "Low Stock": "warning",
    "In Stock": "success"
  }[stockStatus] as "destructive" | "warning" | "success"

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle>{selectedItem.component.internal_code}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {selectedItem.component.description}
            </p>
          </div>
          <Avatar className="h-16 w-16">
            <AvatarImage src={selectedItem.component.image_url || undefined} />
            <AvatarFallback>
              {selectedItem.component.internal_code.substring(0, 2)}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={stockStatusColor}>{stockStatus}</Badge>
          <Badge variant="outline">{selectedItem.component.category.categoryname}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium">Quantity on Hand</p>
            <p className="text-2xl font-bold">{selectedItem.quantity_on_hand}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Reorder Level</p>
            <p className="text-2xl font-bold">{selectedItem.reorder_level}</p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Location</p>
          <p className="text-muted-foreground">{selectedItem.location || "Not set"}</p>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Unit</p>
          <p className="text-muted-foreground">{selectedItem.component.unit?.unit_name || "Not set"}</p>
        </div>

        {selectedItem.supplierComponents && selectedItem.supplierComponents.length > 0 ? (
          <div>
            <p className="text-sm font-medium mb-2">Suppliers ({selectedItem.supplierComponents.length})</p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {selectedItem.supplierComponents.map((sc, index) => (
                <div
                  key={`supplier-${sc.supplier_id}-${index}`}
                  className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{sc.supplier?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Code: {sc.supplier_code}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-medium">
                    {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(sc.price) || 0)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium mb-2">Suppliers</p>
            <p className="text-muted-foreground">No suppliers linked</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
} 