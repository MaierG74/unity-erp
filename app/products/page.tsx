'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, Plus, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

// Types for our data
interface Product {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
  primary_image?: string | null;
  images?: ProductImage[];
}

interface ProductCategory {
  product_cat_id: number;
  categoryname: string;
}

interface ProductImage {
  image_id: number;
  product_id: number;
  image_url: string;
  is_primary: boolean;
  display_order: number;
  alt_text: string | null;
}

// Fetch products with optional category filter
async function fetchProducts(categoryId?: string): Promise<Product[]> {
  try {
    if (categoryId && categoryId !== 'all') {
      // First get product IDs from the selected category
      const { data: productIds, error: idsError } = await supabase
        .from('product_category_assignments')
        .select('product_id')
        .eq('product_cat_id', categoryId);
      
      if (idsError) throw idsError;
      
      if (!productIds || productIds.length === 0) {
        return [];
      }
      
      // Then fetch products with those IDs
      const { data, error } = await supabase
        .from('products')
        .select(`
          product_id,
          internal_code,
          name,
          description
        `)
        .in('product_id', productIds.map(item => item.product_id));

      if (error) throw error;
      
      // Fetch primary images for these products
      const productsWithImages = await attachProductImages(data || []);
      return productsWithImages;
    } else {
      // Fetch all products
      const { data, error } = await supabase
        .from('products')
        .select(`
          product_id,
          internal_code,
          name,
          description
        `);

      if (error) throw error;
      
      // Fetch primary images for these products
      const productsWithImages = await attachProductImages(data || []);
      return productsWithImages;
    }
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

// Helper function to attach images to products
async function attachProductImages(products: Product[]): Promise<Product[]> {
  if (!products || products.length === 0) return [];
  
  try {
    // Get primary images for all products
    const { data: images, error } = await supabase
      .from('product_images')
      .select('*')
      .in('product_id', products.map(p => p.product_id))
      .order('display_order', { ascending: true });
      
    if (error) throw error;
    
    // Group images by product_id
    const imagesByProduct: { [key: number]: ProductImage[] } = {};
    images?.forEach(img => {
      if (!imagesByProduct[img.product_id]) {
        imagesByProduct[img.product_id] = [];
      }
      imagesByProduct[img.product_id].push(img);
    });
    
    // Add images to respective products
    return products.map(product => {
      const productImages = imagesByProduct[product.product_id] || [];
      const primaryImage = productImages.find(img => img.is_primary)?.image_url || 
                          (productImages.length > 0 ? productImages[0].image_url : null);
      
      return {
        ...product,
        primary_image: primaryImage,
        images: productImages
      };
    });
  } catch (error) {
    console.error('Error fetching product images:', error);
    return products; // Return products without images if there's an error
  }
}

// Fetch product categories
async function fetchProductCategories(): Promise<ProductCategory[]> {
  try {
    const { data, error } = await supabase
      .from('product_categories')
      .select('*');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching product categories:', error);
    return [];
  }
}

export default function ProductsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const router = useRouter();

  // Fetch product categories
  const { data: categories = [] } = useQuery({
    queryKey: ['productCategories'],
    queryFn: fetchProductCategories,
  });

  // Fetch products with category filter
  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ['products', selectedCategory],
    queryFn: () => fetchProducts(selectedCategory !== 'all' ? selectedCategory : undefined),
  });

  // Filtered products based on search query
  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      if (!searchQuery) return true;
      
      const query = searchQuery.toLowerCase();
      return (
        product.internal_code?.toLowerCase().includes(query) ||
        product.name?.toLowerCase().includes(query) ||
        product.description?.toLowerCase().includes(query)
      );
    });
  }, [products, searchQuery]);

  // Paginated products
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredProducts.slice(start, end);
  }, [filteredProducts, currentPage, pageSize]);

  // Total number of pages
  const totalPages = Math.ceil(filteredProducts.length / pageSize);

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Reset to first page when filters change
  useMemo(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory]);

  // Navigate to product detail page
  const handleViewProduct = (productId: number) => {
    router.push(`/products/${productId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Products</h1>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="w-full md:w-64">
          <Select
            value={selectedCategory}
            onValueChange={setSelectedCategory}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem 
                  key={category.product_cat_id} 
                  value={category.product_cat_id.toString()}
                >
                  {category.categoryname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-row gap-4">
        {/* Products list */}
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>Products</CardTitle>
            <CardDescription>
              {isLoading ? 'Loading products...' : `Showing ${paginatedProducts.length} of ${filteredProducts.length} products`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-4">Loading products...</div>
            ) : error ? (
              <div className="text-center py-4 text-destructive">Error loading products. Please try again.</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">No products found.</div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden md:table-cell">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedProducts.map((product) => (
                        <TableRow 
                          key={product.product_id}
                          onClick={() => setSelectedProduct(product)}
                          className={`cursor-pointer ${selectedProduct?.product_id === product.product_id ? 'bg-muted' : ''}`}
                        >
                          <TableCell className="font-medium">{product.internal_code}</TableCell>
                          <TableCell>{product.name}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            {product.description || 'No description'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center mt-4">
                    <div className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Product details */}
        {selectedProduct && (
          <div className="w-96 shrink-0">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-xl">Product Details</CardTitle>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleViewProduct(selectedProduct.product_id)}
                >
                  View Full Details
                </Button>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center mb-4">
                  {selectedProduct.primary_image ? (
                    <div className="h-48 w-48 relative rounded-md overflow-hidden">
                      <Image 
                        src={selectedProduct.primary_image}
                        alt={selectedProduct.name}
                        fill
                        className="object-contain"
                      />
                    </div>
                  ) : (
                    <div className="h-48 w-48 bg-muted rounded-md flex items-center justify-center">
                      <Package className="h-16 w-16 text-muted-foreground/50" />
                    </div>
                  )}
                </div>

                {/* Image gallery if multiple images */}
                {selectedProduct.images && selectedProduct.images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                    {selectedProduct.images.map(image => (
                      <div 
                        key={image.image_id}
                        className={`
                          h-16 w-16 relative rounded-md overflow-hidden flex-shrink-0 cursor-pointer
                          ${image.is_primary ? 'ring-2 ring-primary' : 'ring-1 ring-border hover:ring-primary/50'}
                        `}
                      >
                        <Image 
                          src={image.image_url}
                          alt={image.alt_text || selectedProduct.name}
                          fill
                          className="object-contain"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium text-sm text-muted-foreground">Product Code</h3>
                    <p className="mt-1">{selectedProduct.internal_code}</p>
                  </div>
                  <div>
                    <h3 className="font-medium text-sm text-muted-foreground">Name</h3>
                    <p className="mt-1">{selectedProduct.name}</p>
                  </div>
                  <div>
                    <h3 className="font-medium text-sm text-muted-foreground">Description</h3>
                    <p className="mt-1">{selectedProduct.description || 'No description'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
} 