'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { addSupplierComponent, deleteSupplierComponent, updateSupplierComponent } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierComponent } from '@/types/suppliers';
import { Trash2, Plus, Edit, Check, X } from 'lucide-react';
import ReactSelect from 'react-select';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

type OptionType = {
  value: string;
  label: string;
};

interface SupplierComponentsProps {
  supplier: SupplierWithDetails;
}

type ComponentFormData = {
  component_id: number;
  supplier_code: string;
  price: number;
  lead_time?: number;
  min_order_quantity?: number;
};

export function SupplierComponents({ supplier }: SupplierComponentsProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ComponentFormData | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: components = [] } = useQuery({
    queryKey: ['components'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description')
        .order('internal_code');
      if (error) throw error;
      return data;
    },
  });

  const addMutation = useMutation({
    mutationFn: addSupplierComponent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierComponent> }) =>
      updateSupplierComponent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
      setEditingId(null);
      setFormData(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplierComponent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
    },
  });

  const startEdit = (component: SupplierComponent) => {
    setEditingId(component.supplier_component_id);
    setFormData({
      component_id: component.component_id,
      supplier_code: component.supplier_code,
      price: component.price,
      lead_time: component.lead_time || undefined,
      min_order_quantity: component.min_order_quantity || undefined,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData(null);
  };

  const handleUpdate = (id: number) => {
    if (!formData) return;

    updateMutation.mutate({
      id,
      data: {
        component_id: formData.component_id,
        supplier_code: formData.supplier_code,
        price: formData.price,
        lead_time: formData.lead_time || null,
        min_order_quantity: formData.min_order_quantity || null,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-lg">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted">
              <th className="text-left p-4">Component</th>
              <th className="text-left p-4">Description</th>
              <th className="text-left p-4">Supplier Code</th>
              <th className="text-right p-4">Price</th>
              <th className="text-right p-4">Lead Time</th>
              <th className="text-right p-4">Min Order</th>
              <th className="text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {supplier.components.map((component) => (
              <tr key={component.supplier_component_id} className="border-b">
                {editingId === component.supplier_component_id ? (
                  <>
                    <td className="p-4" colSpan={2}>
                      <div className="space-y-4">
                        <div className="w-full">
                          <label className="text-sm font-medium mb-2 block">Component</label>
                          <ReactSelect<OptionType>
                            value={{
                              value: component.component_id.toString(),
                              label: `${component.component.internal_code} - ${component.component.description}`
                            }}
                            onChange={(newValue: OptionType | null) => {
                              if (newValue) {
                                setFormData(prev => prev ? {
                                  ...prev,
                                  component_id: parseInt(newValue.value)
                                } : null);
                              }
                            }}
                            options={components.map(c => ({
                              value: c.component_id.toString(),
                              label: `${c.internal_code} - ${c.description}`
                            }))}
                            isSearchable
                            placeholder="Select component"
                            className="w-full"
                            classNames={{
                              control: (state) => cn(
                                "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background text-foreground",
                                state.isFocused && "ring-2 ring-ring ring-offset-2",
                                state.isDisabled && "opacity-50 cursor-not-allowed"
                              ),
                              menu: () => "z-[9999] mt-2 bg-popover text-popover-foreground rounded-md border shadow-md",
                              menuList: () => "p-1",
                              option: ({ isSelected, isFocused }) => cn(
                                "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                                isSelected && "bg-primary text-primary-foreground",
                                !isSelected && isFocused && "bg-accent text-accent-foreground",
                                !isSelected && !isFocused && "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                              ),
                            }}
                          />
                        </div>
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <label className="text-sm font-medium mb-2 block">Supplier Code</label>
                            <input
                              type="text"
                              value={formData?.supplier_code || ''}
                              onChange={(e) =>
                                setFormData((prev) => prev ? { ...prev, supplier_code: e.target.value } : null)
                              }
                              className="w-full rounded-md border border-input bg-background px-3 py-1"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Price</label>
                            <div className="flex items-center gap-1">
                              <span>R</span>
                              <input
                                type="number"
                                value={formData?.price || 0}
                                onChange={(e) =>
                                  setFormData((prev) => prev ? { ...prev, price: Number(e.target.value) } : null)
                                }
                                className="w-full rounded-md border border-input bg-background px-3 py-1 text-right"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Lead Time</label>
                            <input
                              type="number"
                              value={formData?.lead_time || ''}
                              onChange={(e) =>
                                setFormData((prev) => prev ? { ...prev, lead_time: Number(e.target.value) } : null)
                              }
                              className="w-full rounded-md border border-input bg-background px-3 py-1"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Min Order</label>
                            <input
                              type="number"
                              value={formData?.min_order_quantity || ''}
                              onChange={(e) =>
                                setFormData((prev) => prev ? { ...prev, min_order_quantity: Number(e.target.value) } : null)
                              }
                              className="w-full rounded-md border border-input bg-background px-3 py-1"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleUpdate(component.supplier_component_id)}
                            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            <Check className="h-4 w-4 mr-2" />
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="inline-flex items-center justify-center rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                          >
                            <X className="h-4 w-4 mr-2" />
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-4">{component.component.internal_code}</td>
                    <td className="p-4">{component.component.description}</td>
                    <td className="p-4">{component.supplier_code}</td>
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <span>R</span>
                        <span>{component.price.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right">{component.lead_time || '-'}</td>
                    <td className="p-4 text-right">{component.min_order_quantity || '-'}</td>
                    <td className="p-4 text-right space-x-2">
                      <button
                        onClick={() => startEdit(component)}
                        className="text-primary hover:text-primary/90"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(component.supplier_component_id)}
                        disabled={deleteMutation.isPending}
                        className="text-destructive hover:text-destructive/90 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {supplier.components.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  No components added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
} 