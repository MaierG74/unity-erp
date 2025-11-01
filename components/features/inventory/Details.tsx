'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { InventoryItem } from '@/types/inventory'

type InventoryDetailsProps = {
  selectedItem?: InventoryItem & { on_order_quantity?: number }
}

export function InventoryDetails({ selectedItem }: InventoryDetailsProps) {
  // Simplified logging - keep only basic info
  console.log('Rendering InventoryDetails for:', selectedItem?.component.internal_code);
  
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

  // Ensure quantity_on_hand is a number and not NaN
  const qtyOnHand = selectedItem.quantity_on_hand !== null && 
                    selectedItem.quantity_on_hand !== undefined && 
                    !isNaN(selectedItem.quantity_on_hand) 
                    ? selectedItem.quantity_on_hand 
                    : 0;
                    
  const reorderLevel = selectedItem.reorder_level !== null && 
                       selectedItem.reorder_level !== undefined && 
                       !isNaN(selectedItem.reorder_level)
                       ? selectedItem.reorder_level 
                       : 0;

  const stockStatus = qtyOnHand === 0 
    ? "Out of Stock"
    : qtyOnHand <= reorderLevel
    ? "Low Stock"
    : "In Stock"
    
  const stockStatusColor = {
    "Out of Stock": "destructive",
    "Low Stock": "destructive",
    "In Stock": "success"
  }[stockStatus] as "destructive" | "success"

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
          <Badge variant={stockStatus === "In Stock" ? undefined : stockStatusColor} 
                 className={stockStatus === "In Stock" ? "badge-pastel-success" : ""}>
            {stockStatus}
          </Badge>
          <Badge variant="outline">{selectedItem.component.category.categoryname}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium">Quantity on Hand</p>
            <p className="text-2xl font-bold" data-testid="quantity-on-hand">{qtyOnHand}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Reorder Level</p>
            <p className="text-2xl font-bold">{reorderLevel}</p>
          </div>
          <div>
            <p className="text-sm font-medium">On Order</p>
            <p className="text-2xl font-bold text-blue-600">{selectedItem.on_order_quantity || 0}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Required for Orders</p>
            <p className="text-2xl font-bold text-muted-foreground">
              {selectedItem.required_for_orders !== null && selectedItem.required_for_orders !== undefined 
                ? selectedItem.required_for_orders 
                : '—'}
            </p>
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