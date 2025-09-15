'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { addSupplierComponent, deleteSupplierComponent, updateSupplierComponent } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierComponent } from '@/types/suppliers';
import { Trash2, Plus, Edit, Check, X, Search } from 'lucide-react';
import ReactSelect from 'react-select';
import type { StylesConfig } from 'react-select';
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
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState<ComponentFormData | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
      setIsAdding(false);
      setAddForm(null);
      setAddError(null);
    },
    onError: (err: any) => {
      const msg = String(err?.message || 'Failed to add component');
      if (msg.includes('duplicate key') || msg.includes('suppliercomponents_component_id_supplier_id_key')) {
        setAddError('This component is already linked to this supplier.');
      } else {
        setAddError(msg);
      }
    }
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

  // Derived: options and disabled set for already-linked components
  const linkedComponentIds = useMemo(() => new Set((supplier.components || []).map(c => c.component_id)), [supplier.components]);
  const componentOptions: OptionType[] = useMemo(() =>
    (components || []).map((c: any) => ({ value: String(c.component_id), label: `${c.internal_code} - ${c.description}` })),
    [components]
  );

  const startAdd = () => {
    setIsAdding(true);
    setAddError(null);
    setAddForm({ component_id: 0, supplier_code: '', price: 0, lead_time: undefined, min_order_quantity: undefined });
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setAddForm(null);
    setAddError(null);
  };

  const handleCreate = async () => {
    if (!addForm) return;
    if (!addForm.component_id || addForm.component_id <= 0) { setAddError('Please choose a component.'); return; }
    if (!addForm.supplier_code?.trim()) { setAddError('Supplier code is required.'); return; }
    if (addForm.price === null || addForm.price === undefined || Number(addForm.price) < 0) { setAddError('Price must be zero or greater.'); return; }
    setAddError(null);
    await addMutation.mutateAsync({
      component_id: addForm.component_id,
      supplier_id: supplier.supplier_id,
      supplier_code: addForm.supplier_code.trim(),
      price: Number(addForm.price),
      lead_time: addForm.lead_time ?? null,
      min_order_quantity: addForm.min_order_quantity ?? null,
    });
  };

  // Filtered components view
  const filteredComponents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplier.components;
    return (supplier.components || []).filter((c) => {
      const fields = [
        c.component?.internal_code ?? "",
        c.component?.description ?? "",
        c.supplier_code ?? "",
      ];
      return fields.some((f) => f.toLowerCase().includes(q));
    });
  }, [supplier.components, search]);

  // Shared classNames for react-select (Style Guide tokens + dark mode)
  const selectClassNames = {
    control: (state: any) => cn(
      "h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background text-foreground",
      state.isFocused && "ring-2 ring-ring ring-offset-2",
      state.isDisabled && "opacity-50 cursor-not-allowed"
    ),
    valueContainer: () => "p-0",
    singleValue: () => "text-foreground",
    input: () => "text-foreground",
    placeholder: () => "text-muted-foreground",
    indicatorsContainer: () => "text-muted-foreground",
    dropdownIndicator: ({ isFocused }: any) => cn("text-muted-foreground", isFocused && "text-foreground"),
    menu: () => "z-[9999] mt-2 bg-popover text-popover-foreground rounded-md border shadow-md",
    menuList: () => "p-1",
    option: ({ isSelected, isFocused }: any) => cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
      isSelected && "bg-primary text-primary-foreground",
      !isSelected && isFocused && "bg-accent text-accent-foreground",
      !isSelected && !isFocused && "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
    ),
  } as const;

  // Inline style overrides are necessary because react-select applies inline styles
  // that can override our classes. Use CSS variables so dark/light themes work.
  const selectStyles: StylesConfig<OptionType, false> = {
    container: (base) => ({ ...base, minWidth: '14rem' }),
    control: (base, state) => ({
      ...base,
      backgroundColor: 'hsl(var(--background))',
      borderColor: 'hsl(var(--input))',
      minHeight: '2.25rem', // h-9
      boxShadow: state.isFocused ? '0 0 0 2px hsl(var(--ring))' : base.boxShadow,
      '&:hover': { borderColor: 'hsl(var(--input))' },
    }),
    valueContainer: (base) => ({ ...base, padding: 0 }),
    singleValue: (base) => ({ ...base, color: 'hsl(var(--foreground))' }),
    input: (base) => ({ ...base, color: 'hsl(var(--foreground))' }),
    placeholder: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
    indicatorsContainer: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
    dropdownIndicator: (base, state) => ({
      ...base,
      color: state.isFocused ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: 'hsl(var(--popover))',
      color: 'hsl(var(--popover-foreground))',
      zIndex: 9999,
      minWidth: '28rem',
      width: 'max-content',
      maxWidth: '90vw',
    }),
    menuList: (base) => ({ ...base, padding: 4 }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? 'hsl(var(--primary))'
        : state.isFocused
        ? 'hsl(var(--accent))'
        : 'transparent',
      color: state.isSelected
        ? 'hsl(var(--primary-foreground))'
        : state.isFocused
        ? 'hsl(var(--accent-foreground))'
        : 'hsl(var(--popover-foreground))',
    }),
    clearIndicator: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex w-full items-center gap-3 md:max-w-xl">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by code, description, or supplier code"
              className="w-full h-9 pl-9 pr-10 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!isAdding && (
            <button
              onClick={startAdd}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Plus className="h-4 w-4" />
              Add Component
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm max-h-[65vh] overflow-auto">
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Component</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Description</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Supplier Code</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Price</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Lead Time</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Min Order</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isAdding && (
              <tr className="border-b">
                {/* Component select */}
                <td className="p-4 align-top">
                  <ReactSelect<OptionType>
                    value={addForm?.component_id ? {
                      value: String(addForm.component_id),
                      label: componentOptions.find(o => o.value === String(addForm.component_id))?.label || ''
                    } : null}
                    onChange={(opt) => setAddForm(prev => prev ? { ...prev, component_id: Number(opt?.value || 0) } : prev)}
                    options={componentOptions}
                    isOptionDisabled={(opt) => linkedComponentIds.has(Number(opt.value))}
                    isSearchable
                    placeholder="Select"
                    menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                    menuPosition="fixed"
                    className="w-full md:min-w-[14rem]"
                    classNames={selectClassNames}
                    styles={selectStyles}
                  />
                  {addError && (
                    <p className="mt-2 text-sm text-destructive">{addError}</p>
                  )}
                </td>

                {/* Description (read-only from selected) */}
                <td className="p-4 align-top text-muted-foreground">
                  <span className="block max-w-[36ch] truncate">
                    {(() => {
                      const c = (components || []).find((x: any) => x.component_id === addForm?.component_id);
                      return c?.description || '-';
                    })()}
                  </span>
                </td>

                {/* Supplier code */}
                <td className="p-4 align-top">
                  <input
                    type="text"
                    value={addForm?.supplier_code || ''}
                    onChange={(e) => setAddForm(prev => prev ? { ...prev, supplier_code: e.target.value } : prev)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Supplier code"
                  />
                </td>

                {/* Price */}
                <td className="p-4 align-top">
                  <div className="flex items-center gap-1">
                    <span>R</span>
                    <input
                      type="number"
                      value={addForm?.price ?? 0}
                      onChange={(e) => setAddForm(prev => prev ? { ...prev, price: Number(e.target.value) } : prev)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </td>

                {/* Lead Time */}
                <td className="p-4 align-top">
                  <input
                    type="number"
                    value={addForm?.lead_time ?? ''}
                    onChange={(e) => setAddForm(prev => prev ? { ...prev, lead_time: Number(e.target.value) } : prev)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    min="0"
                    placeholder="Days"
                  />
                </td>

                {/* MOQ */}
                <td className="p-4 align-top">
                  <input
                    type="number"
                    value={addForm?.min_order_quantity ?? ''}
                    onChange={(e) => setAddForm(prev => prev ? { ...prev, min_order_quantity: Number(e.target.value) } : prev)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    min="0"
                    placeholder="Qty"
                  />
                </td>

                {/* Actions */}
                <td className="p-4 text-right align-top">
                  <div className="inline-flex gap-2">
                    <button
                      onClick={handleCreate}
                      className="inline-flex items-center justify-center rounded-md bg-primary px-3 h-9 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Save
                    </button>
                    <button
                      onClick={cancelAdd}
                      className="inline-flex items-center justify-center rounded-md border border-input px-3 h-9 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {filteredComponents.map((component) => (
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
                            options={componentOptions}
                            isOptionDisabled={(opt) => linkedComponentIds.has(Number(opt.value)) && Number(opt.value) !== component.component_id}
                            isSearchable
                            placeholder="Select"
                            menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                            menuPosition="fixed"
                            className="w-full md:min-w-[14rem]"
                            classNames={selectClassNames}
                            styles={selectStyles}
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
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring"
                                step="0.01"
                                min="0"
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
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              min="0"
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
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              min="0"
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
                    <td className="p-4">
                      <a
                        href={`/inventory?focusComponent=${component.component_id}`}
                        className="text-primary hover:underline"
                        title="View in master components"
                      >
                        {component.component.internal_code}
                      </a>
                    </td>
                    <td className="p-4">{component.component.description}</td>
                    <td className="p-4">{component.supplier_code}</td>
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <span>R</span>
                        <span>{component.price !== null && component.price !== undefined ? component.price.toFixed(2) : '0.00'}</span>
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
            {filteredComponents.length === 0 && !isAdding && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  {search ? (
                    <span>No components match “{search}”.</span>
                  ) : (
                    <span>No components added yet.</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
} 
