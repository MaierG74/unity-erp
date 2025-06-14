'use client'

import { useState, useRef, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CategoryCellProps {
  value: string
  onSave: (value: string) => Promise<void>
  componentId: number | string
  disabled?: boolean
}

export function CategoryCell({ 
  value: initialValue, 
  onSave, 
  componentId, 
  disabled = false 
}: CategoryCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(initialValue || "Uncategorized")
  const selectRef = useRef<HTMLDivElement>(null)

  // Fetch available categories
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_categories")
        .select("cat_id, categoryname")
        .order("categoryname")
      if (error) throw error
      console.log("Fetched categories count:", data?.length || 0)
      return data
    },
  })

  // Update local value when initialValue changes, ensuring empty string is replaced
  useEffect(() => {
    setValue(initialValue || "Uncategorized")
  }, [initialValue])

  // When entering edit mode, focus the select
  useEffect(() => {
    if (isEditing && selectRef.current) {
      // Focus and open the select after a short delay
      setTimeout(() => {
        const trigger = selectRef.current?.querySelector('button[role="combobox"]')
        if (trigger) {
          console.log("Clicking select trigger")
          ;(trigger as HTMLButtonElement).click()
        }
      }, 10)
    }
  }, [isEditing])

  const handleDoubleClick = () => {
    if (!disabled) {
      console.log("Double-click detected on category cell:", initialValue)
      setIsEditing(true)
    }
  }

  const handleSave = async (newValue: string) => {
    try {
      console.log(`Saving category "${newValue}" for component ${componentId}`)
      await onSave(newValue)
      setIsEditing(false)
    } catch (error) {
      console.error("Failed to save category:", error)
      setValue(initialValue || "Uncategorized") // Revert on error
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    console.log("Canceling category edit")
    setValue(initialValue || "Uncategorized")
    setIsEditing(false)
  }

  // NON-EDITING MODE - Show a simple div with double-click handler
  if (!isEditing) {
    return (
      <div 
        className="p-2 h-full w-full cursor-pointer hover:bg-muted/50 rounded truncate"
        onDoubleClick={(e) => {
          e.stopPropagation()
          handleDoubleClick()
        }}
        title={value}
      >
        {value}
      </div>
    )
  }

  // EDITING MODE - Show the select dropdown
  return (
    <div 
      className="p-1 relative"
      onClick={(e) => e.stopPropagation()}
      ref={selectRef}
    >
      <Select
        defaultOpen={true}
        value={value || "Uncategorized"}
        onValueChange={(newValue) => {
          const validValue = newValue || "Uncategorized"
          setValue(validValue)
          handleSave(validValue)
        }}
        onOpenChange={(open) => {
          if (!open) {
            // If dropdown closes without selection, cancel edit
            handleCancel()
          }
        }}
      >
        <SelectTrigger className="h-8 w-full">
          <SelectValue placeholder="Select category" />
        </SelectTrigger>
        <SelectContent 
          position="popper" 
          className="max-h-[300px] z-[100]"
        >
          <SelectItem value="Uncategorized">Uncategorized</SelectItem>
          {categories.map((category) => (
            <SelectItem 
              key={category.cat_id} 
              value={category.categoryname || "Uncategorized"}>
              {category.categoryname || "Uncategorized"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="absolute right-0 top-1 flex space-x-0">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-6 rounded-none"
          onClick={() => handleCancel()}
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}