'use client'

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EditableCellProps {
  value: string
  onSave: (value: string) => Promise<void>
  disabled?: boolean
}

export function EditableCell({ value: initialValue, onSave, disabled = false }: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  // Update local value when initialValue changes
  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  const handleDoubleClick = () => {
    if (!disabled) {
      setIsEditing(true)
    }
  }

  const handleSave = async () => {
    try {
      await onSave(value)
      setIsEditing(false)
    } catch (error) {
      console.error("Failed to save:", error)
      // Reset to initial value on error
      setValue(initialValue)
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setValue(initialValue)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave()
    } else if (e.key === "Escape") {
      handleCancel()
    }
  }

  if (!isEditing) {
    return (
      <div 
        className={`p-2 h-full w-full ${disabled ? '' : 'cursor-pointer hover:bg-muted/50'} rounded truncate`}
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

  return (
    <div 
      className="relative flex items-center w-full" 
      onClick={(e) => e.stopPropagation()}
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 py-1 pr-16"
      />
      <div className="absolute right-0 flex space-x-0">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-6 rounded-none"
          onClick={handleSave}
          title="Save"
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-6 rounded-none"
          onClick={handleCancel}
          title="Cancel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
} 