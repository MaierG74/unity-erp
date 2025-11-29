'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addSupplierEmail, deleteSupplierEmail, updateSupplierEmail } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierEmail } from '@/types/suppliers';
import { Trash2, Plus, Star, StarOff, Edit, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SupplierEmailsProps {
  supplier: SupplierWithDetails;
}

type UpdateEmailParams = {
  id: number;
  email: Partial<SupplierEmail>;
};

export function SupplierEmails({ supplier }: SupplierEmailsProps) {
  const [newEmail, setNewEmail] = useState('');
  const [editingEmailId, setEditingEmailId] = useState<number | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
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
      setEditingEmailId(null);
      setEditingEmailValue('');
      setEditError(null);
    },
    onError: (err: any) => {
      setEditError(String(err?.message || 'Failed to update email address'));
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
    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail) return;

    addMutation.mutate({
      supplier_id: supplier.supplier_id,
      email: trimmedEmail,
      is_primary: supplier.emails.length === 0,
    });
  };

  const handleSetPrimary = (email: SupplierEmail) => {
    if (email.is_primary) return;
    setEditError(null);

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

  const handleStartEdit = (email: SupplierEmail) => {
    setEditingEmailId(email.email_id);
    setEditingEmailValue(email.email);
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingEmailId(null);
    setEditingEmailValue('');
    setEditError(null);
  };

  const handleSaveEdit = (emailId: number) => {
    if (!editingEmailValue.trim()) return;

    updateMutation.mutate({
      id: emailId,
      email: { email: editingEmailValue.trim() },
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleAddEmail} className="flex gap-2">
        <Input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="Add new email address"
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={!newEmail.trim() || addMutation.isPending}
          className="inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Email
        </Button>
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
                <td className="p-4">
                  {editingEmailId === email.email_id ? (
                    <Input
                      type="email"
                      value={editingEmailValue}
                      onChange={(e) => setEditingEmailValue(e.target.value)}
                      className="w-full"
                      aria-label="Email address"
                    />
                  ) : (
                    email.email
                  )}
                </td>
                <td className="p-4">
                  <button
                    onClick={() => handleSetPrimary(email)}
                    className="inline-flex items-center gap-1 text-sm"
                    disabled={email.is_primary || updateMutation.isPending}
                  >
                    {email.is_primary ? (
                      <Star className="h-4 w-4 fill-primary text-primary" />
                    ) : (
                      <StarOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </td>
                <td className="p-4 text-right">
                  {editingEmailId === email.email_id ? (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={updateMutation.isPending}
                        aria-label="Cancel edit"
                        className="h-9"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveEdit(email.email_id)}
                        disabled={!editingEmailValue.trim() || updateMutation.isPending}
                        aria-label="Save email"
                        className="h-9"
                      >
                        <Check className="h-4 w-4" />
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(email)}
                        className="text-muted-foreground hover:text-foreground"
                        disabled={updateMutation.isPending}
                        aria-label="Edit email"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(email.email_id)}
                        disabled={email.is_primary || deleteMutation.isPending || updateMutation.isPending}
                        className="text-destructive hover:text-destructive/90 disabled:opacity-50"
                        aria-label="Delete email"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
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
      {editError && (
        <p className="px-1 text-sm text-destructive">{editError}</p>
      )}
    </div>
  );
}
