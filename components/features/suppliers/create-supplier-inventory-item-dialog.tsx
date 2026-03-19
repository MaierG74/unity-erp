'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  createSupplierInventoryItem,
  type CreateSupplierInventoryItemInput,
} from '@/lib/api/suppliers';
import { supabase } from '@/lib/supabase';
import type { SupplierWithDetails } from '@/types/suppliers';

type CreateSupplierInventoryItemDialogProps = {
  supplier: SupplierWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: { internal_code: string; component_id: number }) => void;
};

type FormState = {
  internal_code: string;
  description: string;
  unit_id: string;
  category_id: string;
  quantity_on_hand: string;
  location: string;
  reorder_level: string;
  supplier_code: string;
  price: string;
  lead_time: string;
  min_order_quantity: string;
};

const INITIAL_FORM: FormState = {
  internal_code: '',
  description: '',
  unit_id: '',
  category_id: '',
  quantity_on_hand: '0',
  location: '',
  reorder_level: '',
  supplier_code: '',
  price: '0',
  lead_time: '',
  min_order_quantity: '',
};

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function CreateSupplierInventoryItemDialog({
  supplier,
  open,
  onOpenChange,
  onCreated,
}: CreateSupplierInventoryItemDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unitsofmeasure')
        .select('unit_id, unit_name, unit_code')
        .order('unit_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_categories')
        .select('cat_id, categoryname')
        .order('categoryname');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const uniqueUnits = useMemo(() => {
    const seen = new Set<string>();
    return units.filter((unit) => {
      const key = `${unit.unit_code ?? ''}|${unit.unit_name ?? ''}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [units]);

  useEffect(() => {
    if (!open) {
      setForm(INITIAL_FORM);
      setFormError(null);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateSupplierInventoryItemInput) =>
      createSupplierInventoryItem(supplier.supplier_id, payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] }),
        queryClient.invalidateQueries({ queryKey: ['supplier-components', supplier.supplier_id] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] }),
        queryClient.invalidateQueries({ queryKey: ['components-search'] }),
      ]);

      toast({
        title: 'Inventory item created',
        description: `${result.component.internal_code} was created and linked to ${supplier.name}.`,
      });

      onOpenChange(false);
      onCreated?.({
        internal_code: result.component.internal_code,
        component_id: result.component.component_id,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create inventory item';
      setFormError(message);
    },
  });

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSubmit() {
    const internalCode = form.internal_code.trim();
    const description = form.description.trim();
    const supplierCode = form.supplier_code.trim();
    const unitId = Number(form.unit_id);
    const categoryId = Number(form.category_id);
    const quantityOnHand = parseOptionalNumber(form.quantity_on_hand);
    const reorderLevel = parseOptionalNumber(form.reorder_level);
    const price = parseOptionalNumber(form.price);
    const leadTime = parseOptionalNumber(form.lead_time);
    const minOrderQuantity = parseOptionalNumber(form.min_order_quantity);

    if (!internalCode) {
      setFormError('Master code is required.');
      return;
    }
    if (!description) {
      setFormError('Description is required.');
      return;
    }
    if (!Number.isInteger(unitId) || unitId <= 0) {
      setFormError('Unit is required.');
      return;
    }
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      setFormError('Category is required.');
      return;
    }
    if (quantityOnHand === null) {
      setFormError('Quantity on hand must be zero or greater.');
      return;
    }
    if (!supplierCode) {
      setFormError('Supplier code is required.');
      return;
    }
    if (price === null) {
      setFormError('Price must be zero or greater.');
      return;
    }

    setFormError(null);

    createMutation.mutate({
      internal_code: internalCode,
      description,
      unit_id: unitId,
      category_id: categoryId,
      quantity_on_hand: quantityOnHand,
      location: form.location.trim() || null,
      reorder_level: reorderLevel,
      supplier_code: supplierCode,
      price,
      lead_time: leadTime,
      min_order_quantity: minOrderQuantity,
    });
  }

  const lookupsLoading = unitsLoading || categoriesLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Inventory Item</DialogTitle>
          <DialogDescription>
            Create a new master inventory item for {supplier.name} and attach the supplier-specific code in the same save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Master Item</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="supplier-item-master-code">Master Code</Label>
                <Input
                  id="supplier-item-master-code"
                  value={form.internal_code}
                  onChange={(event) => updateForm('internal_code', event.target.value)}
                  placeholder="e.g. WIDGET-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-item-unit">Unit</Label>
                <Select
                  value={form.unit_id || undefined}
                  onValueChange={(value) => updateForm('unit_id', value)}
                  disabled={lookupsLoading}
                >
                  <SelectTrigger id="supplier-item-unit">
                    <SelectValue placeholder={lookupsLoading ? 'Loading units...' : 'Select unit'} />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueUnits.map((unit) => (
                      <SelectItem key={unit.unit_id} value={String(unit.unit_id)}>
                        {unit.unit_name}
                        {unit.unit_code ? ` (${String(unit.unit_code).toUpperCase()})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-item-description">Description</Label>
              <Textarea
                id="supplier-item-description"
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
                rows={3}
                placeholder="Describe the master inventory item"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="supplier-item-category">Category</Label>
                <Select
                  value={form.category_id || undefined}
                  onValueChange={(value) => updateForm('category_id', value)}
                  disabled={lookupsLoading}
                >
                  <SelectTrigger id="supplier-item-category">
                    <SelectValue placeholder={lookupsLoading ? 'Loading categories...' : 'Select category'} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((category) => category.categoryname && category.categoryname.trim() !== '')
                      .map((category) => (
                        <SelectItem key={category.cat_id} value={String(category.cat_id)}>
                          {category.categoryname}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-item-qty-on-hand">Qty on Hand</Label>
                <Input
                  id="supplier-item-qty-on-hand"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.quantity_on_hand}
                  onChange={(event) => updateForm('quantity_on_hand', event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-item-reorder-level">Reorder Level</Label>
                <Input
                  id="supplier-item-reorder-level"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.reorder_level}
                  onChange={(event) => updateForm('reorder_level', event.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier-item-location">Location</Label>
              <Input
                id="supplier-item-location"
                value={form.location}
                onChange={(event) => updateForm('location', event.target.value)}
                placeholder="e.g. Shelf A3"
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Supplier Mapping</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="supplier-item-supplier-code">Supplier Code</Label>
                <Input
                  id="supplier-item-supplier-code"
                  value={form.supplier_code}
                  onChange={(event) => updateForm('supplier_code', event.target.value)}
                  placeholder="Supplier-facing code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-item-price">Price</Label>
                <Input
                  id="supplier-item-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => updateForm('price', event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="supplier-item-lead-time">Lead Time (days)</Label>
                <Input
                  id="supplier-item-lead-time"
                  type="number"
                  min="0"
                  step="1"
                  value={form.lead_time}
                  onChange={(event) => updateForm('lead_time', event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-item-moq">Min Order Quantity</Label>
                <Input
                  id="supplier-item-moq"
                  type="number"
                  min="0"
                  step="1"
                  value={form.min_order_quantity}
                  onChange={(event) => updateForm('min_order_quantity', event.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          </section>

          {formError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending || lookupsLoading}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create and Link
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
