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

interface DataTableProps<T> {
  columns: {
    accessorKey: string
    header: string
    cell?: (row: T) => React.ReactNode
    enableFiltering?: boolean
  }[]
  data: T[]
  onRowClick?: (row: T) => void
  selectedId?: string | number
}

function getValue(obj: any, path: string) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj)
}

export function DataTable<T extends { [key: string]: any }>({
  columns,
  data,
  onRowClick,
  selectedId,
}: DataTableProps<T>) {
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const [filterValue, setFilterValue] = useState('')
  const [columnFilters, setColumnFilters] = useState<{ [key: string]: string }>({})

  // Get unique values for filterable columns
  const filterOptions = useMemo(() => {
    const options: { [key: string]: Set<string> } = {}
    columns.forEach(column => {
      if (column.enableFiltering) {
        options[column.accessorKey] = new Set()
        data.forEach(row => {
          const value = column.cell ? column.cell(row) : getValue(row, column.accessorKey)
          if (value != null) {
            options[column.accessorKey].add(String(value))
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
      const value = column.cell ? column.cell(row) : getValue(row, column.accessorKey)
      if (value == null) return false
      return String(value).toLowerCase().includes(filterValue.toLowerCase())
    })

    // Column-specific filters
    const matchesColumnFilters = Object.entries(columnFilters).every(([key, filterValue]) => {
      if (!filterValue) return true
      const column = columns.find(col => col.accessorKey === key)
      if (!column) return true
      const value = column.cell ? column.cell(row) : getValue(row, key)
      return String(value) === filterValue
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

  return (
    <div className="space-y-4">
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
              value={columnFilters[column.accessorKey] || 'all'}
              onValueChange={(value) => {
                setColumnFilters(prev => ({
                  ...prev,
                  [column.accessorKey]: value === 'all' ? '' : value
                }))
                setPageIndex(0)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={`Filter ${column.header}`} />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">All {column.header}s</SelectItem>
                {Array.from(filterOptions[column.accessorKey] || []).sort().map(value => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
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
                  e.preventDefault();
                  onRowClick?.(row);
                }}
              >
                {columns.map((column) => (
                  <TableCell key={column.accessorKey}>
                    {column.cell ? column.cell(row) : getValue(row, column.accessorKey)}
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
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={pageIndex === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
            disabled={pageIndex === pageCount - 1}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
} 