'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import type { Supplier } from '@/types/suppliers';

const supplierSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contact_info: z.string().nullable(),
});

type SupplierFormData = z.infer<typeof supplierSchema>;

interface SupplierFormProps {
  supplier?: Supplier;
  onSubmit: (data: SupplierFormData) => Promise<void>;
}

export function SupplierForm({ supplier, onSubmit }: SupplierFormProps) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: supplier?.name || '',
      contact_info: supplier?.contact_info || '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Name
          </label>
          <input
            type="text"
            id="name"
            {...register('name')}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2"
          />
          {errors.name && (
            <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="contact_info" className="block text-sm font-medium">
            Contact Information
          </label>
          <textarea
            id="contact_info"
            {...register('contact_info')}
            rows={3}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2"
          />
          {errors.contact_info && (
            <p className="mt-1 text-sm text-destructive">
              {errors.contact_info.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : supplier ? 'Update Supplier' : 'Add Supplier'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="border border-input bg-background px-4 py-2 rounded-lg hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
} 