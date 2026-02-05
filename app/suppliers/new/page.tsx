'use client';

import { SupplierForm } from '@/components/features/suppliers/supplier-form';
import type { SupplierFormSubmitData } from '@/components/features/suppliers/supplier-form';
import { createSupplier, addSupplierEmail } from '@/lib/api/suppliers';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';

export default function NewSupplierPage() {
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: createSupplier,
  });

  const handleSubmit = async (data: SupplierFormSubmitData) => {
    const { emails, ...supplierData } = data;
    const newSupplier = await mutation.mutateAsync(supplierData);

    // Create email records if provided
    if (emails && emails.length > 0) {
      for (let i = 0; i < emails.length; i++) {
        await addSupplierEmail({
          supplier_id: newSupplier.supplier_id,
          email: emails[i],
          is_primary: i === 0,
        });
      }
    }

    router.push('/suppliers');
    router.refresh();
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
        <SupplierForm onSubmit={handleSubmit} showEmailFields />
      </div>
    </div>
  );
}
