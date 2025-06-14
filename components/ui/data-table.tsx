'use client'

import { useState, useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { EditableCell } from '@/components/inventory/EditableCell'
import { CategoryCell } from '@/components/inventory/CategoryCell'
import { useUpdateComponent } from '@/hooks/use-update-component'
import { useChangeCategory } from '@/hooks/use-change-category'
import { useUpdateInventory } from '@/hooks/use-update-inventory'

interface DataTableProps<T> {
  columns: {
    accessorKey: string
    header: string
    cell?: (row: T) => React.ReactNode
    enableFiltering?: boolean
    editable?: boolean
    filterValue?: (row: T) => string
  }[]
  data: T[]
  onRowClick?: (row: T) => void
  selectedId?: string | number
  hideFilters?: boolean
}

function getValue(obj: any, path: string) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj)
}

export function DataTable<T extends { [key: string]: any }>({
  columns,
  data,
  onRowClick,
  selectedId,
  hideFilters = false,
}: DataTableProps<T>) {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const [filterValue, setFilterValue] = useState('')
  const [columnFilters, setColumnFilters] = useState<{ [key: string]: string }>({})

  // Hooks for inline editing
  const updateComponent = useUpdateComponent()
  const changeCategory = useChangeCategory()
  const updateInventory = useUpdateInventory()

  // Get unique values for filterable columns
  const filterOptions = useMemo(() => {
    const options: { [key: string]: Set<string> } = {}
    columns.forEach(column => {
      if (column.enableFiltering) {
        options[column.accessorKey] = new Set()
        data.forEach(row => {
          let value;
          
          // If column has a custom filterValue function, use it
          if (column.filterValue) {
            value = column.filterValue(row);
          } else {
            // Otherwise, use the accessor path or cell renderer
            value = column.cell ? column.cell(row) : getValue(row, column.accessorKey)
          }
          
          if (value != null) {
            // If value contains multiple items (like a comma-separated list),
            // add each item individually for better filtering
            if (typeof value === 'string' && value.includes(',')) {
              value.split(',').forEach(item => {
                const trimmed = item.trim();
                if (trimmed) {
                  options[column.accessorKey].add(trimmed);
                }
              });
            } else {
              options[column.accessorKey].add(String(value))
            }
          }
        })
      }
    })
    return options
  }, [columns, data])

  // Filter data
  const filteredData = data.filter(row => {
    // Text search filter
    const matchesSearch = !filterValue || columns.some(column => {
      let value;
      
      // If column has a custom filterValue function, use it
      if (column.filterValue) {
        value = column.filterValue(row);
      } else {
        // Otherwise, use the accessor path or cell renderer
        value = column.cell ? column.cell(row) : getValue(row, column.accessorKey)
      }
      
      if (value == null) return false
      return String(value).toLowerCase().includes(filterValue.toLowerCase())
    })

    // Column-specific filters
    const matchesColumnFilters = Object.entries(columnFilters).every(([key, filterValue]) => {
      if (!filterValue || filterValue === '_all') return true // Skip empty filters or '_all'
      const column = columns.find(col => col.accessorKey === key)
      if (!column) return true
      
      let value;
      
      // If column has a custom filterValue function, use it
      if (column.filterValue) {
        value = column.filterValue(row);
      } else {
        // Otherwise, use the accessor path or cell renderer
        value = column.cell ? column.cell(row) : getValue(row, key)
      }
      
      // For columns with comma-separated values (like suppliers),
      // check if any of the values match the filter
      if (typeof value === 'string' && value.includes(',')) {
        return value.split(',').some(item => 
          item.trim().toLowerCase() === filterValue.toLowerCase()
        );
      }
      
      return String(value).toLowerCase() === filterValue.toLowerCase()
    })

    return matchesSearch && matchesColumnFilters
  })

  // Sort data
  const sortedData = [...filteredData].sort((a, b) => {
    if (!sortBy) return 0
    const aValue = getValue(a, sortBy.key)
    const bValue = getValue(b, sortBy.key)

    // Special handling for internal_code sorting
    if (sortBy.key === 'internal_code') {
      // If one has a code and the other doesn't, prioritize the one with a code
      if (aValue && !bValue) return -1
      if (!aValue && bValue) return 1
    }

    // Regular null handling
    if (aValue == null && bValue == null) return 0
    if (aValue == null) return 1
    if (bValue == null) return -1

    // String comparison
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortBy.direction === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
    }

    // Number comparison
    return sortBy.direction === 'asc'
      ? aValue > bValue ? 1 : -1
      : bValue > aValue ? 1 : -1
  })

  // Paginate data
  const pageCount = Math.ceil(sortedData.length / pageSize)
  const paginatedData = sortedData.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize
  )

  // Helper for rendering cell content
  const renderCellContent = (row: T, column: typeof columns[0], accessorKey: string) => {
    // If the column has a custom cell renderer, use it
    if (column.cell) {
      return column.cell(row)
    }

    const value = getValue(row, accessorKey)
    
    // Handle editable cells
    if (column.editable) {
      // Handle different types of editable cells based on accessorKey
      if (accessorKey === 'internal_code' || accessorKey === 'description') {
        return (
          <EditableCell
            value={value != null ? String(value) : ''}
            onSave={async (newValue) => {
              await updateComponent.mutateAsync({
                componentId: row.component_id,
                data: { [accessorKey]: newValue }
              })
            }}
          />
        )
      }
      else if (accessorKey === 'category.categoryname') {
        console.log("Rendering category cell for:", row.component_id, "value:", value);
        return (
          <CategoryCell
            value={value != null ? String(value) : 'Uncategorized'}
            componentId={row.component_id}
            onSave={async (newValue) => {
              console.log("Category save triggered with:", newValue);
              await changeCategory.mutateAsync({
                componentId: row.component_id,
                categoryName: newValue
              })
            }}
          />
        )
      }
      // Handle inventory paths with array notation (inventory.0.field)
      else if (accessorKey.startsWith('inventory.0.') && row.inventory?.[0]) {
        const inventoryField = accessorKey.split('.')[2]
        return (
          <EditableCell
            value={row.inventory[0][inventoryField] != null ? String(row.inventory[0][inventoryField]) : '0'}
            onSave={async (newValue) => {
              await updateInventory.mutateAsync({
                inventoryId: row.inventory[0].inventory_id,
                data: { 
                  [inventoryField]: inventoryField === 'location' ? newValue : Number(newValue) || 0
                }
              })
            }}
          />
        )
      }
    }
    
    // Default rendering for non-editable cells
    return value
  }

  return (
    <div className="space-y-4">
      {!hideFilters && (
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search all columns..."
              value={filterValue}
              onChange={(e) => {
                setFilterValue(e.target.value)
                setPageIndex(0) // Reset to first page when filtering
              }}
              className="max-w-sm"
            />
          </div>
          {columns.map(column => column.enableFiltering && (
            <div key={column.accessorKey} className="min-w-[200px]">
              <Select
                value={columnFilters[column.accessorKey] || '_all'}
                onValueChange={(value) => {
                  setColumnFilters(prev => ({
                    ...prev,
                    [column.accessorKey]: value === 'all' ? '_all' : value
                  }))
                  setPageIndex(0)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Filter ${column.header}`} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="_all">All {column.header.endsWith('s') ? column.header : `${column.header}s`}</SelectItem>
                  {Array.from(filterOptions[column.accessorKey] || []).sort().map(value => (
                    value ? (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ) : null
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => {
              setPageSize(Number(value))
              setPageIndex(0)
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select page size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 per page</SelectItem>
              <SelectItem value="10">10 per page</SelectItem>
              <SelectItem value="20">20 per page</SelectItem>
              <SelectItem value="50">50 per page</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.accessorKey}
                  className="cursor-pointer"
                  onClick={() => {
                    if (sortBy?.key === column.accessorKey) {
                      setSortBy(
                        sortBy.direction === 'asc'
                          ? { key: column.accessorKey, direction: 'desc' }
                          : null
                      )
                    } else {
                      setSortBy({ key: column.accessorKey, direction: 'asc' })
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    {column.header}
                    {sortBy?.key === column.accessorKey && (
                      sortBy.direction === 'asc' ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.map((row, rowIndex) => (
              <TableRow
                key={rowIndex}
                className={`cursor-pointer hover:bg-muted/50 ${
                  selectedId !== undefined && row.component_id === selectedId ? 'bg-muted' : ''
                }`}
                onClick={(e) => {
                  // Only prevent row selection if clicking on an actual interactive element
                  // like input, select, or button - not the entire editable cell
                  const target = e.target as HTMLElement;
                  const isInteractiveElement = target.tagName === 'INPUT' || 
                                              target.tagName === 'SELECT' || 
                                              target.tagName === 'BUTTON' ||
                                              target.closest('button') ||  // For nested buttons
                                              target.closest('select') ||  // For select styling wrappers
                                              target.closest('input');     // Just in case
                  
                  if (isInteractiveElement) {
                    console.log(`Interactive element ${target.tagName} clicked, ignoring row click`);
                    return;
                  }
                  
                  e.preventDefault();
                  console.log("Row clicked:", row);
                  if (onRowClick) {
                    onRowClick(row);
                    console.log("onRowClick called with:", row);
                  }
                }}
              >
                {columns.map((column) => (
                  <TableCell 
                    key={column.accessorKey}
                  >
                    {renderCellContent(row, column, column.accessorKey)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {pageCount}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex(Math.min(pageCount - 1, pageIndex + 1))}
            disabled={pageIndex === pageCount - 1}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
} 