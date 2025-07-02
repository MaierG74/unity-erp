"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/lib/supabase"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

interface CategoryDialogProps {
  productId: string
  trigger?: React.ReactNode
  existingCategories: { product_cat_id: number; categoryname: string }[]
  onCategoriesChange?: () => void
}

export function CategoryDialog({ 
  productId, 
  trigger, 
  existingCategories,
  onCategoriesChange 
}: CategoryDialogProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [selectedCategories, setSelectedCategories] = React.useState<number[]>([])
  const [searchQuery, setSearchQuery] = React.useState("")
  const { toast } = useToast()

  // Fetch all available categories
  const { data: categories = [] } = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("*")
        .order("categoryname")
      
      if (error) throw error
      return data
    },
  })

  // Filter out already assigned categories
  const availableCategories = categories.filter(
    (category) => !existingCategories.some(
      (existing) => existing.product_cat_id === category.product_cat_id
    )
  )

  // Filter categories based on search query
  const filteredCategories = availableCategories.filter(
    (category) => 
      category.categoryname.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const toggleCategory = (categoryId: number) => {
    setSelectedCategories(prev => 
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  const handleAddCategories = async () => {
    if (selectedCategories.length === 0) return

    try {
      const assignments = selectedCategories.map(categoryId => ({
        product_id: productId,
        product_cat_id: categoryId,
      }))

      const { error } = await supabase
        .from("product_category_assignments")
        .insert(assignments)

      if (error) throw error

      toast({
        title: "Success",
        description: `${selectedCategories.length} ${selectedCategories.length === 1 ? 'category' : 'categories'} added successfully`,
      })

      if (onCategoriesChange) {
        onCategoriesChange()
      }

      setSelectedCategories([])
      setDialogOpen(false)
    } catch (error) {
      console.error("Error adding categories:", error)
      toast({
        title: "Error",
        description: "Failed to add categories",
        variant: "destructive",
      })
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Categories</DialogTitle>
          <DialogDescription>
            Select categories to add to this product. You can select multiple categories.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          
          {filteredCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No matching categories found
            </p>
          ) : (
            <div className="border rounded-md max-h-[200px] overflow-y-auto">
              {filteredCategories.map((category) => {
                const isChecked = selectedCategories.includes(category.product_cat_id);
                return (
                  <div
                    key={category.product_cat_id}
                    className="flex items-center p-2 hover:bg-muted cursor-pointer"
                    onClick={() => toggleCategory(category.product_cat_id)}
                  >
                    <Checkbox 
                      checked={isChecked}
                      className="mr-2 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCategory(category.product_cat_id);
                      }}
                    />
                    <span className="text-sm font-medium leading-none cursor-pointer">
                      {category.categoryname}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {selectedCategories.length > 0 && (
            <p className="text-sm mt-2">
              {selectedCategories.length} {selectedCategories.length === 1 ? 'category' : 'categories'} selected
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleAddCategories} 
            disabled={selectedCategories.length === 0}
          >
            Add {selectedCategories.length > 0 ? selectedCategories.length : ''} {selectedCategories.length === 1 ? 'Category' : 'Categories'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 