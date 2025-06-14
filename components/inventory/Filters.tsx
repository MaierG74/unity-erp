'use client'

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { Label } from "@/components/ui/label"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect, useMemo, useCallback } from "react"
import type { Filters } from '@/app/inventory/inventory-client'
import { useDebounce } from '@/hooks/use-debounce'

type Category = {
  cat_id: number
  categoryname: string
}

interface InventoryFiltersProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
}

export function InventoryFilters({ filters, onFiltersChange }: InventoryFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search)
  const debouncedSearch = useDebounce(searchInput, 300)

  // Update filters when debounced search changes
  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ ...filters, search: debouncedSearch })
    }
  }, [debouncedSearch, filters, onFiltersChange])

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_categories")
        .select("cat_id, categoryname")
        .order("categoryname")
      if (error) throw error
      return data as Category[]
    },
  })

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
  }, [])

  const handleCategoryChange = useCallback((value: string) => {
    onFiltersChange({ 
      ...filters, 
      categoryId: value === 'all' ? 'all' : parseInt(value) 
    })
  }, [filters, onFiltersChange])

  const handleStockLevelChange = useCallback((value: string) => {
    onFiltersChange({ ...filters, stockLevel: value })
  }, [filters, onFiltersChange])

  const handleReset = useCallback(() => {
    setSearchInput('')
    onFiltersChange({ categoryId: 'all', stockLevel: 'all', search: '' })
  }, [onFiltersChange])

  return (
    <div className="flex gap-4 items-end">
      <div className="flex-1 space-y-2">
        <Label>Search</Label>
        <Input
          placeholder="Search by code or description..."
          className="max-w-sm"
          value={searchInput}
          onChange={handleSearchChange}
        />
      </div>
      
      <div className="w-[200px] space-y-2">
        <Label>Category</Label>
        <Select 
          value={filters.categoryId === 'all' ? 'all' : filters.categoryId.toString()}
          onValueChange={handleCategoryChange}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select category">
              {filters.categoryId !== 'all'
                ? categories.find((category) => category.cat_id === filters.categoryId)?.categoryname
                : "All categories"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem 
                key={category.cat_id} 
                value={category.cat_id.toString()}
              >
                {category.categoryname}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-[200px] space-y-2">
        <Label>Stock Level</Label>
        <Select 
          value={filters.stockLevel}
          onValueChange={handleStockLevelChange}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="in-stock">In Stock</SelectItem>
            <SelectItem value="low-stock">Low Stock</SelectItem>
            <SelectItem value="out-of-stock">Out of Stock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button 
        variant="outline"
        onClick={handleReset}
      >
        Reset Filters
      </Button>
    </div>
  )
} 