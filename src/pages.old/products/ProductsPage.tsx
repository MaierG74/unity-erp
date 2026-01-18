'use client';

/**
 * ProductsPage Component
 *
 * URL-based filter persistence for navigating back from detail pages.
 * Filters stored: q (search), category, page, pageSize, sort, sortDir
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProductsTable } from './ProductsTable';
import { ProductSearchBar } from './ProductSearchBar';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ProductCreateForm } from '@/components/features/products/product-create-form';
import supabase, { supabase as supabaseBrowser } from '@/lib/supabase';
import { useDebounce } from '@/hooks/use-debounce';
import { Package2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProductRow {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
}

interface ProductsResponse {
  data: ProductRow[];
  count: number;
}

export type ProductsQueryParams = {
  page: number;
  pageSize: number;
  search: string;
  categoryId: string;
  sortKey: string;
  sortDirection: 'asc' | 'desc';
};

async function fetchProducts(params: ProductsQueryParams): Promise<ProductsResponse> {
  const {
    page,
    pageSize,
    search,
    categoryId,
    sortKey,
    sortDirection,
  } = params;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const client = supabaseBrowser ?? supabase;

  const categoryJoinFragment =
    categoryId && categoryId !== 'all'
      ? `product_category_assignments!inner(product_cat_id, product_categories(product_cat_id, categoryname))`
      : `product_category_assignments!left(product_cat_id, product_categories(product_cat_id, categoryname))`;

  let query = client
    .from('products')
    .select(
      `
        product_id,
        internal_code,
        name,
        description,
        product_images(image_url, is_primary, display_order),
        ${categoryJoinFragment}
      `,
      { count: 'exact' }
    )
    .order(sortKey, { ascending: sortDirection === 'asc' })
    .range(from, to);

  if (search) {
    query = query.or(
      `internal_code.ilike.%${search}%,name.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  if (categoryId && categoryId !== 'all') {
    query = query.eq('product_category_assignments.product_cat_id', Number(categoryId));
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const transformed: ProductRow[] = (data ?? []).map((row: any) => {
    const images: any[] = row.product_images ?? [];
    const sortedImages = [...images].sort((a, b) => {
      if (a.is_primary === b.is_primary) {
        return (a.display_order ?? 0) - (b.display_order ?? 0);
      }
      return a.is_primary ? -1 : 1;
    });
    const primaryImage = sortedImages[0]?.image_url ?? null;

    const categoryAssignments: any[] = row.product_category_assignments ?? [];
    const firstAssignment = categoryAssignments[0];
    const categoryIdValue = firstAssignment?.product_cat_id ?? null;
    const categoryName = firstAssignment?.product_categories?.categoryname ?? null;

    return {
      product_id: row.product_id,
      internal_code: row.internal_code,
      name: row.name,
      description: row.description,
      category_id: categoryIdValue,
      category_name: categoryName,
      image_url: primaryImage,
    } satisfies ProductRow;
  });

  return {
    data: transformed,
    count: count ?? 0,
  };
}

interface CategoryOption {
  product_cat_id: number;
  categoryname: string;
}

async function fetchCategories(): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('product_cat_id, categoryname')
    .order('categoryname');

  if (error) {
    throw error;
  }

  return data ?? [];
}

const skeletonRows = Array.from({ length: 10 }, (_, index) => index);

export function ProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Initialize state from URL parameters
  const [page, setPage] = useState(() => {
    const p = searchParams?.get('page');
    return p ? parseInt(p, 10) : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const ps = searchParams?.get('pageSize');
    return ps ? parseInt(ps, 10) : 10;
  });
  const [search, setSearch] = useState(() => searchParams?.get('q') || '');
  const [categoryId, setCategoryId] = useState(() => searchParams?.get('category') || 'all');
  const [sortKey, setSortKey] = useState<'internal_code' | 'name'>(() => {
    const sk = searchParams?.get('sort');
    return sk === 'name' ? 'name' : 'internal_code';
  });
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    const sd = searchParams?.get('sortDir');
    return sd === 'desc' ? 'desc' : 'asc';
  });
  const debouncedSearch = useDebounce(search, 300);

  // Re-read URL params when navigating back (component doesn't remount)
  const searchParamsString = searchParams?.toString() || '';
  useEffect(() => {
    const urlPage = searchParams?.get('page');
    const urlPageSize = searchParams?.get('pageSize');
    const urlQuery = searchParams?.get('q') || '';
    const urlCategory = searchParams?.get('category') || 'all';
    const urlSort = searchParams?.get('sort');
    const urlSortDir = searchParams?.get('sortDir');

    const newPage = urlPage ? parseInt(urlPage, 10) : 1;
    const newPageSize = urlPageSize ? parseInt(urlPageSize, 10) : 10;
    const newSortKey = urlSort === 'name' ? 'name' : 'internal_code';
    const newSortDir = urlSortDir === 'desc' ? 'desc' : 'asc';

    if (newPage !== page) setPage(newPage);
    if (newPageSize !== pageSize) setPageSize(newPageSize);
    if (urlQuery !== search) setSearch(urlQuery);
    if (urlCategory !== categoryId) setCategoryId(urlCategory);
    if (newSortKey !== sortKey) setSortKey(newSortKey);
    if (newSortDir !== sortDirection) setSortDirection(newSortDir);
  }, [searchParamsString]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams();

    // Only add non-default values to keep URL clean
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (categoryId && categoryId !== 'all') params.set('category', categoryId);
    if (page > 1) params.set('page', page.toString());
    if (pageSize !== 10) params.set('pageSize', pageSize.toString());
    if (sortKey !== 'internal_code') params.set('sort', sortKey);
    if (sortDirection !== 'asc') params.set('sortDir', sortDirection);

    const query = params.toString();
    const url = query ? `/products?${query}` : '/products';
    router.replace(url, { scroll: false });
  }, [debouncedSearch, categoryId, page, pageSize, sortKey, sortDirection, router]);

  const queryParams = useMemo<ProductsQueryParams>(
    () => ({
      page,
      pageSize,
      search: debouncedSearch,
      categoryId,
      sortKey,
      sortDirection,
    }),
    [page, pageSize, debouncedSearch, categoryId, sortKey, sortDirection]
  );

  const {
    data: products,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['products', queryParams],
    queryFn: () => fetchProducts(queryParams),
    keepPreviousData: true,
  });

  const { data: categories } = useQuery({
    queryKey: ['product-categories'],
    queryFn: fetchCategories,
    staleTime: 1000 * 60 * 5,
  });

  const totalCount = products?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const handleSortChange = (key: string, direction: 'asc' | 'desc') => {
    setSortKey(key as 'internal_code' | 'name');
    setSortDirection(direction);
  };

  const handleRowActionError = (message: string) => {
    toast({
      title: 'Action failed',
      description: message,
      variant: 'destructive',
    });
  };

  return (
    // CHANGED: Reduced space-y from 6 to 2
    <div className="space-y-2">
      {/* CHANGED: Compact inline toolbar - title, count, search, category, and button in one row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-2 bg-card rounded-xl border shadow-sm">
        {/* Left: Small title + count */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-medium text-foreground">Products</span>
          <span className="text-xs text-muted-foreground">
            {totalCount > 0 ? `${totalCount.toLocaleString()} products` : ''}
          </span>
        </div>

        {/* Right: Search, category filter, and Add button */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 w-full md:w-auto">
          <ProductSearchBar
            value={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            categoryOptions={categories ?? []}
            selectedCategory={categoryId}
            onCategoryChange={(value) => {
              setCategoryId(value);
              setPage(1);
            }}
          />
          <ProductCreateForm
            onProductCreated={() => {
              setPage(1);
            }}
            trigger={
              <Button variant="default" size="sm" className="h-9 md:shrink-0">
                Add Product
              </Button>
            }
          />
        </div>
      </div>

      {/* Table card */}
      <Card className="border border-border shadow-sm">
        <CardContent className="p-2">
          <div className="relative">
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="loading-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-0.5 p-4"
                >
                  {skeletonRows.map((key) => (
                    <Skeleton key={key} className="h-[52px] w-full" />
                  ))}
                </motion.div>
              ) : isError ? (
                <motion.div
                  key="error-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center gap-2 p-12 text-center"
                >
                  <Package2 className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">
                    {(error as Error)?.message ?? 'Failed to load products'}
                  </p>
                  <Button variant="outline" onClick={() => setPage(1)}>
                    Retry
                  </Button>
                </motion.div>
              ) : products && products.data.length === 0 ? (
                <motion.div
                  key="empty-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
                    <Package2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-base font-medium text-foreground">No products found</h2>
                    <p className="text-sm text-muted-foreground">
                      Try adjusting your search or filters to find what you are looking for.
                    </p>
                  </div>
                  <ProductCreateForm
                    onProductCreated={() => setPage(1)}
                    trigger={<Button>Add your first product</Button>}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key={`table-${page}-${pageSize}-${categoryId}-${debouncedSearch}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="p-4"
                >
                  <ProductsTable
                    data={products?.data ?? []}
                    page={page}
                    pageSize={pageSize}
                    totalCount={totalCount}
                    onPageChange={setPage}
                    onPageSizeChange={(value) => {
                      setPageSize(value);
                      setPage(1);
                    }}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSortChange={handleSortChange}
                    onActionError={handleRowActionError}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <div
              className={cn(
                'pointer-events-none absolute inset-0 rounded-xl border border-transparent transition-opacity',
                isLoading ? 'opacity-40' : 'opacity-0'
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

