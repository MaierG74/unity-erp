import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/components/ui/use-toast"
import { updateComponentStockLevel } from "@/lib/client/inventory"

export function useUpdateInventory() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async ({ 
      inventoryId, 
      data 
    }: { 
      inventoryId: number, 
      data: {
        quantity_on_hand?: number,
        location?: string,
        reorder_level?: number
      } 
    }) => {
      const quantityProvided = typeof data.quantity_on_hand === 'number'
      const metadataPatch = {
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.reorder_level !== undefined ? { reorder_level: data.reorder_level } : {}),
      }

      const { data: inventoryRow, error: inventoryLookupError } = await supabase
        .from("inventory")
        .select("inventory_id, component_id, quantity_on_hand")
        .eq("inventory_id", inventoryId)
        .single()

      if (inventoryLookupError) throw inventoryLookupError

      const nextQuantity = quantityProvided ? Number(data.quantity_on_hand) || 0 : Number(inventoryRow.quantity_on_hand || 0)
      const currentQuantity = Number(inventoryRow.quantity_on_hand || 0)

      if (quantityProvided && nextQuantity !== currentQuantity) {
        await updateComponentStockLevel(inventoryRow.component_id, {
          new_quantity: nextQuantity,
          reason: 'Data Entry Correction',
          notes: 'Updated via inventory grid inline edit',
          transaction_type: 'ADJUSTMENT',
        })
      }

      const updatePayload = {
        ...metadataPatch,
        ...(quantityProvided && nextQuantity === currentQuantity ? { quantity_on_hand: nextQuantity } : {}),
      }

      if (Object.keys(updatePayload).length === 0) {
        return inventoryRow
      }

      const { data: updated, error } = await supabase
        .from("inventory")
        .update(updatePayload)
        .eq("inventory_id", inventoryId)
        .select()
        .single()

      if (error) throw error
      return updated
    },
    onSuccess: () => {
      // Invalidate relevant queries to trigger a refresh
      queryClient.invalidateQueries({ queryKey: ["inventory", "components"] })
      queryClient.invalidateQueries({ queryKey: ["inventory", "snapshot"] })
      queryClient.invalidateQueries({ queryKey: ["component-stock-summary"] })
      
      toast({
        title: "Inventory updated",
        description: "The inventory data has been successfully updated",
      })
    },
    onError: (error) => {
      console.error("Failed to update inventory:", error)
      
      toast({
        title: "Update failed",
        description: "Failed to update inventory data. Please try again.",
        variant: "destructive"
      })
    }
  })
} 
