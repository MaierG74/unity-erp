'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, Edit, Plus, Trash2, Save, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { ImageGallery } from '@/components/features/products/image-gallery';
import { CategoryDialog } from '@/components/features/products/category-dialog';
import { ProductBOM } from '@/components/features/products/product-bom';
import { ProductBOL } from '@/components/features/products/product-bol';
import ProductCosting from '@/components/features/products/product-costing';
import { useToast } from '@/components/ui/use-toast';

interface ProductDetailPageProps {
  params: {
    productId: string;
  };
}

interface Product {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
  primary_image?: string | null;
  images?: ProductImage[];
  categories?: ProductCategory[];
}

interface ProductImage {
  id: string;
  product_id: string;
  image_url: string;
  is_primary: boolean;
}

interface ProductCategory {
  product_cat_id: number;
  categoryname: string;
}

// Fetch a single product by ID
async function fetchProduct(productId: number): Promise<Product | null> {
  try {
    // Fetch the product
    const { data: product, error } = await supabase
      .from('products')
      .select(`
        product_id,
        internal_code,
        name,
        description
      `)
      .eq('product_id', productId)
      .single();

    if (error) throw error;
    if (!product) return null;

    // Fetch images for this product
    const { data: images, error: imagesError } = await supabase
      .from('product_images')
      .select('*')
      .eq('product_id', productId);

    if (imagesError) throw imagesError;

    // Fetch categories for this product
    const { data: categoryAssignments, error: catError } = await supabase
      .from('product_category_assignments')
      .select(`
        product_cat_id
      `)
      .eq('product_id', productId);

    if (catError) throw catError;

    let categories: ProductCategory[] = [];
    if (categoryAssignments && categoryAssignments.length > 0) {
      const catIds = categoryAssignments.map(c => c.product_cat_id);
      const { data: cats, error: catsError } = await supabase
        .from('product_categories')
        .select('*')
        .in('product_cat_id', catIds);

      if (catsError) throw catsError;
      categories = cats || [];
    }

    // Find primary image
    const primaryImage = images?.find(img => img.is_primary)?.image_url || 
                         (images && images.length > 0 ? images[0].image_url : null);

    return {
      ...product,
      primary_image: primaryImage,
      images: images || [],
      categories: categories
    };
  } catch (error) {
    console.error('Error fetching product:', error);
    return null;
  }
}

export default function ProductDetailPage({ params }: ProductDetailPageProps) {
  const productId = parseInt(params.productId, 10);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('details');
  const { toast } = useToast();

  console.log('ProductDetailPage mounted, productId:', productId);

  // Fetch product
  const { data: product, isLoading, error, refetch } = useQuery({
    queryKey: ['product', productId],
    queryFn: async () => {
      console.log('Fetching product data for ID:', productId);
      const result = await fetchProduct(productId);
      console.log('Product data fetched:', result);
      return result;
    },
  });

  // Handle back button
  const handleBack = () => {
    console.log('Back button clicked');
    router.push('/products');
  };

  if (isLoading) {
    console.log('Product detail page is loading...');
    return <div className="p-8 text-center">Loading product details...</div>;
  }

  if (error || !product) {
    console.error('Error loading product:', error);
    return (
      <div className="p-8 text-center text-destructive">
        Error loading product details. The product may not exist.
        <div className="mt-4">
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Products
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <div className="text-sm px-2 py-1 bg-muted rounded-md">
            {product.internal_code}
          </div>
        </div>
        <Button>
          <Edit className="h-4 w-4 mr-2" />
          Edit Product
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="bom">Bill of Materials</TabsTrigger>
          <TabsTrigger value="bol">Bill of Labor</TabsTrigger>
          <TabsTrigger value="costing">Costing</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Product image */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Product Image</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                {product.primary_image ? (
                  <div className="relative h-60 w-60 rounded-md overflow-hidden bg-card ring-0 dark:bg-white/5 dark:ring-1 dark:ring-white/10">
                    <Image 
                      src={product.primary_image}
                      alt={product.name}
                      fill
                      className="object-contain dark:brightness-110 dark:drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]"
                    />
                  </div>
                ) : (
                  <div className="h-60 w-60 bg-muted rounded-md flex items-center justify-center">
                    <Package className="h-24 w-24 text-muted-foreground/50" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Product details */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Product Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Product Code
                  </h3>
                  <p className="mt-1">{product.internal_code}</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Name
                  </h3>
                  <p className="mt-1">{product.name}</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Description
                  </h3>
                  <p className="mt-1 whitespace-pre-line">
                    {product.description || 'No description provided'}
                  </p>
                </div>

                {/* Categories */}
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Categories
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {product.categories && product.categories.length > 0 ? (
                      product.categories.map(category => (
                        <div 
                          key={category.product_cat_id}
                          className="px-2 py-1 text-xs rounded-full bg-muted"
                        >
                          {category.categoryname}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No categories assigned</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product Images</CardTitle>
              <CardDescription>
                Manage product images. You can upload new images, set a primary image, and delete images.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImageGallery
                productId={product.product_id.toString()}
                productCode={product.internal_code}
                images={product.images || []}
                onImagesChange={() => refetch()}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product Categories</CardTitle>
              <CardDescription>
                Manage product category assignments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {product.categories && product.categories.length > 0 ? (
                    product.categories.map(category => (
                      <div 
                        key={category.product_cat_id}
                        className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted"
                      >
                        <span>{category.categoryname}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0 hover:bg-transparent hover:opacity-50"
                          onClick={async () => {
                            try {
                              const { error } = await supabase
                                .from('product_category_assignments')
                                .delete()
                                .eq('product_id', product.product_id)
                                .eq('product_cat_id', category.product_cat_id)

                              if (error) throw error

                              toast({
                                title: "Success",
                                description: "Category removed successfully",
                              })

                              refetch()
                            } catch (error) {
                              console.error('Error removing category:', error)
                              toast({
                                title: "Error",
                                description: "Failed to remove category",
                                variant: "destructive",
                              })
                            }
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No categories assigned</p>
                  )}
                </div>
                <CategoryDialog
                  productId={product.product_id.toString()}
                  existingCategories={product.categories || []}
                  onCategoriesChange={() => refetch()}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="bom" className="space-y-4">
          <ProductBOM productId={product.product_id} />
        </TabsContent>
        
        <TabsContent value="bol" className="space-y-4">
          <ProductBOL productId={product.product_id} />
        </TabsContent>

        <TabsContent value="costing" className="space-y-4">
          <ProductCosting productId={product.product_id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
