'use client';

import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProductsRowActions } from './ProductsRowActions';
import { ProductRow } from './ProductsPage';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ProductsTableProps {
  data: ProductRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  sortKey: string;
  sortDirection: 'asc' | 'desc';
  onSortChange: (key: string, direction: 'asc' | 'desc') => void;
  onActionError: (message: string) => void;
}

const pageSizeOptions = [10, 25, 50];

export function ProductsTable({
  data,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  sortKey,
  sortDirection,
  onSortChange,
  onActionError,
}: ProductsTableProps) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([
    { id: sortKey, desc: sortDirection === 'desc' },
  ]);

  const columns = tableColumns({ onActionError });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
    },
    onSortingChange: (updater) => {
      const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(nextSorting);
      if (nextSorting.length > 0) {
        onSortChange(nextSorting[0]?.id ?? 'internal_code', nextSorting[0]?.desc ? 'desc' : 'asc');
      } else {
        onSortChange('internal_code', 'asc');
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.ceil(totalCount / pageSize),
  });

  const handlePrevious = () => {
    if (page > 1) {
      onPageChange(page - 1);
    }
  };

  const handleNext = () => {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (page < totalPages) {
      onPageChange(page + 1);
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[640px]">
          <TableHeader className="sticky top-0 z-10 bg-muted/30 backdrop-blur">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted =
                    header.column.getIsSorted() === 'asc'
                      ? 'ascending'
                      : header.column.getIsSorted() === 'desc'
                        ? 'descending'
                        : undefined;

                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground',
                        header.id === 'actions' && 'text-right'
                      )}
                      scope="col"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="divide-y divide-border">
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/products/${row.original.product_id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    router.push(`/products/${row.original.product_id}`);
                  }
                }}
                className="group cursor-pointer bg-background transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn('px-4 py-2.5 text-sm text-muted-foreground', {
                      'text-right': cell.column.id === 'actions',
                      'text-left text-foreground': cell.column.id === 'name',
                    })}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <footer className="flex flex-col items-start gap-4 border-t border-border/60 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span>Rows per page:</span>
            <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger className="h-9 w-24 rounded-md border border-border bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="hidden md:inline">•</span>
            <span>
              {((page - 1) * pageSize + 1).toLocaleString()}–
              {Math.min(page * pageSize, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrevious}
              disabled={page === 1}
              aria-label="Go to previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {Math.max(1, Math.ceil(totalCount / pageSize))}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNext}
              disabled={page >= Math.ceil(totalCount / pageSize)}
              aria-label="Go to next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface TableColumnConfig {
  onActionError: (message: string) => void;
}

function tableColumns({ onActionError }: TableColumnConfig): ColumnDef<ProductRow>[] {
  return [
    {
      accessorKey: 'internal_code',
      header: 'Product Code',
      sortingFn: 'text',
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
      sortingFn: 'text',
      cell: ({ row }) => {
        const imageUrl = row.original.image_url;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              {imageUrl ? (
                <AvatarImage src={imageUrl} alt={row.original.name} />
              ) : (
                <AvatarFallback className="bg-muted/50" aria-hidden="true" />
              )}
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{row.original.name}</span>
              {row.original.category_name ? (
                <span className="text-xs text-muted-foreground">{row.original.category_name}</span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ getValue }) => {
        const description = getValue<string | null>();
        if (!description || description.trim().length === 0) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <span className="max-w-[320px] truncate text-xs text-muted-foreground">
            {description}
          </span>
        );
      },
    },
    {
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ProductsRowActions product={row.original} onError={onActionError} />
        </div>
      ),
    },
  ];
}
