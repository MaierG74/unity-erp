'use client'

import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

interface SimpleCategoryCellProps {
  value: string
  onSave: (value: string) => Promise<void>
  componentId: number | string
}

export function SimpleCategoryCell({ value: initialValue, onSave, componentId }: SimpleCategoryCellProps) {
  const [value, setValue] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)
  
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

  // Make sure we capture all events on the component and its children
  const stopEvent = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    if ('preventDefault' in e) {
      e.preventDefault()
    }
    console.log(`Captured ${e.type} event on category select`)
  }

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    stopEvent(e)
    const newValue = e.target.value
    console.log(`Changing category to "${newValue}" for component ${componentId}`)
    setValue(newValue)
    try {
      await onSave(newValue)
      console.log("Category saved successfully")
    } catch (error) {
      console.error("Failed to save category:", error)
      setValue(initialValue) // Revert on error
    }
  }

  const handleFocus = (e: React.FocusEvent) => {
    stopEvent(e)
    setIsFocused(true)
    console.log("Select focused")
  }

  const handleBlur = (e: React.FocusEvent) => {
    stopEvent(e)
    setIsFocused(false)
    console.log("Select blurred")
  }

  return (
    <div 
      className="h-full w-full relative" 
      style={{ zIndex: 100 }}
      data-editable="true"
      onClick={stopEvent}
      onMouseDown={stopEvent}
      onMouseUp={stopEvent}
      onDoubleClick={stopEvent}
      onKeyDown={stopEvent}
      onKeyUp={stopEvent}
    >
      <select
        ref={selectRef}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={stopEvent}
        onMouseDown={stopEvent}
        onMouseUp={stopEvent}
        onKeyDown={stopEvent}
        onKeyUp={stopEvent}
        className="w-full h-full bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
        style={{ 
          padding: '8px',
          border: isFocused ? '1px solid #888' : 'none',
          borderRadius: '4px',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          appearance: 'none',
          background: 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23888\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E") no-repeat right 4px center',
        }}
      >
        <option value="Uncategorized">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.cat_id} value={category.categoryname}>
            {category.categoryname}
          </option>
        ))}
      </select>
    </div>
  )
} 