'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Plus, X, Star } from 'lucide-react';
import type { Supplier } from '@/types/suppliers';

const supplierSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contact_info: z.string().nullable(),
});

type SupplierFormData = z.infer<typeof supplierSchema>;

// Extended data that includes emails for the create flow
export type SupplierFormSubmitData = SupplierFormData & {
  emails?: string[];
};

interface SupplierFormProps {
  supplier?: Supplier;
  onSubmit: (data: SupplierFormSubmitData) => Promise<void>;
  showEmailFields?: boolean;
}

export function SupplierForm({ supplier, onSubmit, showEmailFields }: SupplierFormProps) {
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

  // Dynamic email fields (only used in create mode)
  const [emailFields, setEmailFields] = useState<string[]>(['']);
  const [emailErrors, setEmailErrors] = useState<string[]>([]);

  const addEmailField = () => setEmailFields(prev => [...prev, '']);
  const removeEmailField = (index: number) => {
    setEmailFields(prev => prev.filter((_, i) => i !== index));
    setEmailErrors(prev => prev.filter((_, i) => i !== index));
  };
  const updateEmailField = (index: number, value: string) => {
    setEmailFields(prev => prev.map((e, i) => i === index ? value : e));
    // Clear error for this field when user types
    if (emailErrors[index]) {
      setEmailErrors(prev => prev.map((e, i) => i === index ? '' : e));
    }
  };

  const wrappedSubmit = handleSubmit(async (data) => {
    if (showEmailFields) {
      // Validate non-empty email fields
      const filteredEmails = emailFields.filter(e => e.trim() !== '');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const newErrors = emailFields.map(e =>
        e.trim() !== '' && !emailRegex.test(e.trim()) ? 'Invalid email address' : ''
      );

      if (newErrors.some(e => e)) {
        setEmailErrors(newErrors);
        return;
      }

      await onSubmit({
        ...data,
        emails: filteredEmails.length > 0 ? filteredEmails.map(e => e.trim()) : undefined,
      });
    } else {
      await onSubmit(data);
    }
  });

  return (
    <form onSubmit={wrappedSubmit} className="space-y-6">
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

        {showEmailFields && (
          <div>
            <label className="block text-sm font-medium mb-2">
              Email Addresses
            </label>
            <div className="space-y-2">
              {emailFields.map((email, index) => (
                <div key={index}>
                  <div className="flex items-center gap-2">
                    <Star
                      className={`h-4 w-4 shrink-0 ${
                        index === 0
                          ? 'text-primary fill-primary'
                          : 'text-muted-foreground/30'
                      }`}
                      title={index === 0 ? 'Primary email' : ''}
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => updateEmailField(index, e.target.value)}
                      placeholder={index === 0 ? 'Primary email address' : 'Additional email address'}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2"
                    />
                    {emailFields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeEmailField(index)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {emailErrors[index] && (
                    <p className="mt-1 ml-6 text-sm text-destructive">{emailErrors[index]}</p>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addEmailField}
                className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 ml-6"
              >
                <Plus className="h-4 w-4" />
                Add another email
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground ml-6">
              The first email will be set as the primary contact email.
            </p>
          </div>
        )}
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
