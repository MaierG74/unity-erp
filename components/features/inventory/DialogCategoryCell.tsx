'use client'

import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Pencil } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface DialogCategoryCellProps {
  value: string
  onSave: (value: string) => Promise<void>
  componentId: number | string
}

export function DialogCategoryCell({ value: initialValue, onSave, componentId }: DialogCategoryCellProps) {
  const [value, setValue] = useState(initialValue)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  
  // Update local value when initialValue changes
  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  // Fetch available categories
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_categories")
        .select("cat_id, categoryname")
        .order("categoryname")
      if (error) throw error
      console.log("Fetched categories:", data?.length || 0, "items")
      return data
    },
  })

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    console.log("Double click on category cell")
    setIsDialogOpen(true)
  }

  const handleCategorySelect = async (categoryName: string) => {
    console.log(`Selected category: ${categoryName}`)
    try {
      setValue(categoryName)
      await onSave(categoryName)
      setIsDialogOpen(false)
    } catch (error) {
      console.error("Failed to save category:", error)
      setValue(initialValue) // Revert on error
    }
  }

  return (
    <>
      {/* Display the current category value */}
      <div 
        className="p-2 h-full w-full cursor-pointer hover:bg-muted/50 rounded flex items-center justify-between"
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title="Double-click to change category"
      >
        <span className="truncate">{value}</span>
        {isHovered && <Pencil className="h-3.5 w-3.5 ml-2 opacity-60" />}
      </div>

      {/* Dialog for category selection */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Select Category</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto mt-4">
            <div className="space-y-2 p-1">
              <Button
                key="uncategorized"
                variant={value === "Uncategorized" ? "default" : "outline"}
                className="w-full justify-start text-left"
                onClick={() => handleCategorySelect("Uncategorized")}
              >
                Uncategorized
              </Button>
              
              {categories.map((category) => (
                <Button
                  key={category.cat_id}
                  variant={value === category.categoryname ? "default" : "outline"}
                  className="w-full justify-start text-left"
                  onClick={() => handleCategorySelect(category.categoryname)}
                >
                  {category.categoryname}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
} 