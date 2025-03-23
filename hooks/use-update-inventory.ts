import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/components/ui/use-toast"

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
      const { data: updated, error } = await supabase
        .from("inventory")
        .update(data)
        .eq("inventory_id", inventoryId)
        .select()
        .single()

      if (error) throw error
      return updated
    },
    onSuccess: () => {
      // Invalidate relevant queries to trigger a refresh
      queryClient.invalidateQueries({ queryKey: ["inventory", "components"] })
      
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