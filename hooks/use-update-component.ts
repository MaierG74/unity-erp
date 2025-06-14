import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/components/ui/use-toast"

export function useUpdateComponent() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async ({ 
      componentId, 
      data 
    }: { 
      componentId: number, 
      data: {
        internal_code?: string,
        description?: string,
        category_id?: number,
        unit_id?: number
      }
    }) => {
      const { data: updated, error } = await supabase
        .from("components")
        .update(data)
        .eq("component_id", componentId)
        .select()
        .single()

      if (error) throw error
      return updated
    },
    onSuccess: () => {
      // Invalidate relevant queries to trigger a refresh
      queryClient.invalidateQueries({ queryKey: ["inventory", "components"] })
      
      toast({
        title: "Component updated",
        description: "The component has been successfully updated",
      })
    },
    onError: (error) => {
      console.error("Failed to update component:", error)
      
      toast({
        title: "Update failed",
        description: "Failed to update component. Please try again.",
        variant: "destructive"
      })
    }
  })
} 