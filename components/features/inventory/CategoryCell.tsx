'use client'

import { useState, useRef, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Check, X, Pin, Copy, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"

// Global state for sticky category mode
let stickyCategory: string | null = null
let stickyModeListeners: Set<() => void> = new Set()

function getStickyCategory() {
  return stickyCategory
}

function setStickyCategory(category: string | null) {
  stickyCategory = category
  stickyModeListeners.forEach(listener => listener())
}

function subscribeStickyMode(listener: () => void) {
  stickyModeListeners.add(listener)
  return () => {
    stickyModeListeners.delete(listener)
  }
}

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
  const [currentStickyCategory, setCurrentStickyCategory] = useState(getStickyCategory())
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const selectRef = useRef<HTMLDivElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  const newCategoryInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Subscribe to sticky mode changes
  useEffect(() => {
    return subscribeStickyMode(() => {
      setCurrentStickyCategory(getStickyCategory())
    })
  }, [])

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
    if (isEditing && selectRef.current && !isCreatingNew) {
      // Focus and open the select after a short delay
      setTimeout(() => {
        const trigger = selectRef.current?.querySelector('button[role="combobox"]')
        if (trigger) {
          console.log("Clicking select trigger")
          ;(trigger as HTMLButtonElement).click()
        }
      }, 10)
    }
  }, [isEditing, isCreatingNew])

  // Focus the input when creating new category
  useEffect(() => {
    if (isCreatingNew && newCategoryInputRef.current) {
      newCategoryInputRef.current.focus()
    }
  }, [isCreatingNew])

  // Keyboard shortcuts for copy/paste/escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return
      
      // Escape: Cancel new category creation, editing, or turn off Quick Apply mode
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        
        if (isCreatingNew) {
          // Cancel new category creation
          setIsCreatingNew(false)
          setNewCategoryName("")
        } else if (isEditing) {
          // Cancel editing
          handleCancel()
        } else if (currentStickyCategory) {
          // Turn off Quick Apply mode
          setStickyCategory(null)
          toast({
            title: "Quick Apply disabled",
            description: "Sticky category mode turned off",
            duration: 2000,
          })
        }
        return
      }
      
      // Only handle other shortcuts if cell is focused and not editing
      if (!cellRef.current?.contains(document.activeElement) || isEditing) return
      
      // Copy: Cmd/Ctrl + C
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard.writeText(value)
        toast({
          title: "Category copied",
          description: `"${value}" copied to clipboard`,
          duration: 2000,
        })
      }
      
      // Paste: Cmd/Ctrl + V
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard.readText().then(text => {
          if (text && text !== value) {
            handleSave(text)
          }
        })
      }
    }

    const cell = cellRef.current
    if (cell) {
      cell.addEventListener('keydown', handleKeyDown)
      return () => cell.removeEventListener('keydown', handleKeyDown)
    }
  }, [value, disabled, isEditing, toast, currentStickyCategory, isCreatingNew])

  const handleClick = async () => {
    if (disabled) return
    
    // If sticky mode is active, apply the sticky category immediately
    if (currentStickyCategory && currentStickyCategory !== value) {
      await handleSave(currentStickyCategory)
      return
    }
    
    // Otherwise, open the editor (single-click to edit)
    console.log("Click detected on category cell:", initialValue)
    setIsEditing(true)
  }

  const toggleStickyMode = () => {
    if (currentStickyCategory === value) {
      // Turn off sticky mode
      setStickyCategory(null)
      toast({
        title: "Quick Apply disabled",
        description: "Category pinning turned off",
        duration: 2000,
      })
    } else {
      // Turn on sticky mode with this category
      setStickyCategory(value)
      toast({
        title: "Quick Apply enabled",
        description: `Click any row to apply "${value}"`,
        duration: 3000,
      })
    }
  }

  const handleSave = async (newValue: string) => {
    try {
      console.log(`Saving category "${newValue}" for component ${componentId}`)
      await onSave(newValue)
      setIsEditing(false)
      setIsCreatingNew(false)
      setNewCategoryName("")
    } catch (error) {
      console.error("Failed to save category:", error)
      setValue(initialValue || "Uncategorized") // Revert on error
      setIsEditing(false)
      setIsCreatingNew(false)
      setNewCategoryName("")
    }
  }

  const handleCancel = () => {
    console.log("Canceling category edit")
    setValue(initialValue || "Uncategorized")
    setIsEditing(false)
    setIsCreatingNew(false)
    setNewCategoryName("")
  }

  const handleCreateNewCategory = async () => {
    const trimmedName = newCategoryName.trim()
    if (!trimmedName) {
      toast({
        title: "Invalid category name",
        description: "Category name cannot be empty",
        variant: "destructive",
        duration: 2000,
      })
      return
    }
    
    await handleSave(trimmedName)
    // Invalidate categories cache so all dropdowns show the new category
    queryClient.invalidateQueries({ queryKey: ["categories"] })
  }

  // NON-EDITING MODE - Show a clickable cell with visual indicators
  if (!isEditing) {
    const isStickyActive = currentStickyCategory === value
    const canApplySticky = currentStickyCategory && currentStickyCategory !== value
    
    return (
      <div 
        ref={cellRef}
        className={cn(
          "group relative p-2 h-full w-full cursor-pointer rounded truncate flex items-center justify-between gap-2",
          "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary",
          isStickyActive && "bg-primary/10 ring-2 ring-primary",
          canApplySticky && "bg-green-50 dark:bg-green-900/20"
        )}
        onClick={(e) => {
          e.stopPropagation()
          handleClick()
        }}
        tabIndex={0}
        title={
          isStickyActive 
            ? `${value} (Quick Apply active - click other cells to apply, Esc to cancel)`
            : canApplySticky
            ? `Click to apply "${currentStickyCategory}" (Esc to cancel Quick Apply)`
            : `${value} (click to edit, Ctrl+C to copy, Ctrl+V to paste)`
        }
      >
        <span className="truncate flex-1">
          {value}
          {canApplySticky && (
            <span className="ml-2 text-xs text-green-600 dark:text-green-400">
              ← will apply "{currentStickyCategory}"
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(value)
              toast({
                title: "Category copied",
                description: `"${value}" copied to clipboard`,
                duration: 2000,
              })
            }}
            title="Copy category (Ctrl+C)"
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6",
              isStickyActive && "bg-primary text-primary-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation()
              toggleStickyMode()
            }}
            title={isStickyActive ? "Disable Quick Apply" : "Enable Quick Apply"}
          >
            <Pin className={cn("h-3 w-3", isStickyActive && "fill-current")} />
          </Button>
        </div>
      </div>
    )
  }

  // EDITING MODE - Show either the select dropdown or new category input
  if (isCreatingNew) {
    return (
      <div 
        className="p-1 relative flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          ref={newCategoryInputRef}
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleCreateNewCategory()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setIsCreatingNew(false)
              setNewCategoryName("")
            }
          }}
          placeholder="New category name..."
          className="h-8 flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleCreateNewCategory}
          title="Create category"
        >
          <Check className="h-4 w-4 text-green-600" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => {
            setIsCreatingNew(false)
            setNewCategoryName("")
          }}
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

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
          if (newValue === "__CREATE_NEW__") {
            setIsCreatingNew(true)
            return
          }
          const validValue = newValue || "Uncategorized"
          setValue(validValue)
          handleSave(validValue)
        }}
        onOpenChange={(open) => {
          if (!open && !isCreatingNew) {
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
          {categories
            .filter((category) => 
              category.categoryname && 
              category.categoryname.trim() !== "" &&
              category.categoryname.trim() !== "Uncategorized"
            )
            .map((category) => (
              <SelectItem 
                key={category.cat_id} 
                value={category.categoryname}>
                {category.categoryname}
              </SelectItem>
            ))}
          <div className="relative flex items-center">
            <div className="flex-1 h-px bg-border my-1" />
          </div>
          <SelectItem 
            value="__CREATE_NEW__"
            className="text-primary font-medium"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span>Create new category...</span>
            </div>
          </SelectItem>
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