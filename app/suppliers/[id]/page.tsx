'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupplier, updateSupplier } from '@/lib/api/suppliers';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Suspense, lazy, useState, useEffect } from 'react';

// Lazy load tab components
const SupplierForm = lazy(() => import('@/components/features/suppliers/supplier-form').then(m => ({ default: m.SupplierForm })));
const SupplierEmails = lazy(() => import('@/components/features/suppliers/supplier-emails').then(m => ({ default: m.SupplierEmails })));
const SupplierComponents = lazy(() => import('@/components/features/suppliers/supplier-components').then(m => ({ default: m.SupplierComponents })));
const SupplierPricelists = lazy(() => import('@/components/features/suppliers/supplier-pricelists').then(m => ({ default: m.SupplierPricelists })));

// Loading skeleton for tabs
const TabSkeleton = () => (
  <div className="space-y-4">
    <div className="border rounded-lg p-6 bg-card">
      <div className="space-y-4">
        <div className="h-4 bg-muted animate-pulse rounded w-1/4" />
        <div className="h-10 bg-muted animate-pulse rounded" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
        <div className="h-10 bg-muted animate-pulse rounded" />
      </div>
    </div>
  </div>
);

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const supplierId = Number(params.id);
  const defaultTab = searchParams?.get('tab') || 'details';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Update active tab when URL param changes
  useEffect(() => {
    const tab = searchParams?.get('tab') || 'details';
    setActiveTab(tab);
  }, [searchParams]);

  const { data: supplier, isLoading, error } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => getSupplier(supplierId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateSupplier>[1]) =>
      updateSupplier(supplierId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div>
          <div className="h-9 w-64 bg-muted animate-pulse rounded mb-2" />
          <div className="h-4 w-96 bg-muted animate-pulse rounded" />
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="h-10 w-24 bg-muted animate-pulse rounded" />
            <div className="h-10 w-24 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
          </div>
          <TabSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/suppliers" aria-label="Back to Suppliers">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
            </Link>
          </Button>
        </div>
        <div className="border border-destructive/50 rounded-lg p-6 bg-destructive/10">
          <h2 className="text-lg font-semibold text-destructive mb-2">Error loading supplier</h2>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="space-y-6">
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/suppliers" aria-label="Back to Suppliers">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
            </Link>
          </Button>
        </div>
        <div className="border rounded-lg p-6 bg-card">
          <h2 className="text-lg font-semibold mb-2">Supplier not found</h2>
          <p className="text-sm text-muted-foreground">The supplier you're looking for doesn't exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/suppliers" aria-label="Back to Suppliers">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-3xl font-bold">{supplier.name}</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="pricelists">Price Lists</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <div className="border rounded-lg p-6 bg-card">
              <SupplierForm
                supplier={supplier}
                onSubmit={async (data) => {
                  await updateMutation.mutateAsync(data);
                }}
              />
            </div>
          </Suspense>
        </TabsContent>

        <TabsContent value="emails" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierEmails supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierComponents supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="pricelists" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierPricelists supplier={supplier} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
