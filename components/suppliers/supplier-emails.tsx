'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addSupplierEmail, deleteSupplierEmail, updateSupplierEmail } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierEmail } from '@/types/suppliers';
import { Trash2, Plus, Star, StarOff } from 'lucide-react';

interface SupplierEmailsProps {
  supplier: SupplierWithDetails;
}

type UpdateEmailParams = {
  id: number;
  email: Partial<SupplierEmail>;
};

export function SupplierEmails({ supplier }: SupplierEmailsProps) {
  const [newEmail, setNewEmail] = useState('');
  const router = useRouter();
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: addSupplierEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
      setNewEmail('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, email }: UpdateEmailParams) => updateSupplierEmail(id, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplierEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
    },
  });

  const handleAddEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;

    addMutation.mutate({
      supplier_id: supplier.supplier_id,
      email: newEmail,
      is_primary: supplier.emails.length === 0,
    });
  };

  const handleSetPrimary = (email: SupplierEmail) => {
    if (email.is_primary) return;

    // Update the current primary email to not be primary
    const currentPrimary = supplier.emails.find(e => e.is_primary);
    if (currentPrimary) {
      updateMutation.mutate({
        id: currentPrimary.email_id,
        email: { is_primary: false },
      });
    }

    // Set the new primary email
    updateMutation.mutate({
      id: email.email_id,
      email: { is_primary: true },
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleAddEmail} className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="Add new email address"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2"
        />
        <button
          type="submit"
          disabled={!newEmail || addMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Email
        </button>
      </form>

      <div className="border rounded-lg">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted">
              <th className="text-left p-4">Email</th>
              <th className="text-left p-4">Primary</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {supplier.emails.map((email) => (
              <tr key={email.email_id} className="border-b">
                <td className="p-4">{email.email}</td>
                <td className="p-4">
                  <button
                    onClick={() => handleSetPrimary(email)}
                    className="inline-flex items-center gap-1 text-sm"
                    disabled={email.is_primary}
                  >
                    {email.is_primary ? (
                      <Star className="h-4 w-4 fill-primary text-primary" />
                    ) : (
                      <StarOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => deleteMutation.mutate(email.email_id)}
                    disabled={email.is_primary || deleteMutation.isPending}
                    className="text-destructive hover:text-destructive/90 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {supplier.emails.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">
                  No email addresses added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
} 