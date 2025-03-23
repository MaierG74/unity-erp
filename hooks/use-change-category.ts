import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useToast } from "@/components/ui/use-toast"

export function useChangeCategory() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async ({ 
      componentId, 
      categoryName 
    }: { 
      componentId: number, 
      categoryName: string 
    }) => {
      // First, get or create the category
      let categoryId: number

      // Try to find existing category
      const { data: existingCategory, error: findError } = await supabase
        .from("component_categories")
        .select("cat_id")
        .eq("categoryname", categoryName)
        .maybeSingle()

      if (findError) throw findError

      if (existingCategory) {
        categoryId = existingCategory.cat_id
      } else {
        // Create new category
        const { data: newCategory, error: createError } = await supabase
          .from("component_categories")
          .insert({ categoryname: categoryName })
          .select()
          .single()

        if (createError) throw createError
        categoryId = newCategory.cat_id
      }

      // Update component with new category
      const { data, error } = await supabase
        .from("components")
        .update({ category_id: categoryId })
        .eq("component_id", componentId)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      // Invalidate relevant queries to trigger a refresh
      queryClient.invalidateQueries({ queryKey: ["inventory", "components"] })
      
      toast({
        title: "Category updated",
        description: "The component category has been successfully updated",
      })
    },
    onError: (error) => {
      console.error("Failed to update category:", error)
      
      toast({
        title: "Update failed",
        description: "Failed to update component category. Please try again.",
        variant: "destructive"
      })
    },
  })
} 