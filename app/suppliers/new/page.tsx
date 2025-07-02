'use client';

import { SupplierForm } from '@/components/features/suppliers/supplier-form';
import { createSupplier } from '@/lib/api/suppliers';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';

export default function NewSupplierPage() {
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      router.push('/suppliers');
      router.refresh();
    },
  });

  const handleSubmit = async (data: Parameters<typeof createSupplier>[0]) => {
    await mutation.mutateAsync(data);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add New Supplier</h1>
        <p className="text-muted-foreground">
          Create a new supplier record in the system.
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <SupplierForm onSubmit={handleSubmit} />
      </div>
    </div>
  );
}