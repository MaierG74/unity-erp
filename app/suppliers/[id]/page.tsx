'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupplier, updateSupplier } from '@/lib/api/suppliers';
import { SupplierForm } from '@/components/features/suppliers/supplier-form';
import { SupplierEmails } from '@/components/features/suppliers/supplier-emails';
import { SupplierComponents } from '@/components/features/suppliers/supplier-components';
import { SupplierPricelists } from '@/components/features/suppliers/supplier-pricelists';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const supplierId = Number(params.id);

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
    return <div>Loading supplier details...</div>;
  }

  if (error) {
    return <div>Error loading supplier: {error.message}</div>;
  }

  if (!supplier) {
    return <div>Supplier not found</div>;
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

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="pricelists">Price Lists</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <div className="border rounded-lg p-6 bg-card">
            <SupplierForm
              supplier={supplier}
              onSubmit={async (data) => {
                await updateMutation.mutateAsync(data);
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="emails" className="space-y-4">
          <SupplierEmails supplier={supplier} />
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <SupplierComponents supplier={supplier} />
        </TabsContent>

        <TabsContent value="pricelists" className="space-y-4">
          <SupplierPricelists supplier={supplier} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
