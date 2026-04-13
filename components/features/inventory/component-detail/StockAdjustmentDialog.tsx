'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/use-debounce';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Plus, Minus, ClipboardCheck, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';

// Standard adjustment reason codes based on best practices
const ADJUSTMENT_REASONS = [
  { value: 'stock_count', label: 'Stock Count Variance', description: 'Discrepancy found during stock take' },
  { value: 'damage', label: 'Damage/Spoilage', description: 'Items damaged or spoiled' },
  { value: 'theft', label: 'Theft/Loss', description: 'Items lost or stolen' },
  { value: 'data_entry_error', label: 'Data Entry Correction', description: 'Correcting previous entry error' },
  { value: 'found_stock', label: 'Found Stock', description: 'Previously unrecorded stock found' },
  { value: 'quality_rejection', label: 'Quality Rejection', description: 'Items failed quality check' },
  { value: 'sample_usage', label: 'Sample/Testing', description: 'Used for samples or testing' },
  { value: 'write_off', label: 'Write-off', description: 'Obsolete or expired stock' },
  { value: 'cycle_count', label: 'Cycle Count', description: 'Regular cycle count adjustment' },
  { value: 'other', label: 'Other', description: 'Other reason (specify in notes)' },
] as const;

type AdjustmentReason = typeof ADJUSTMENT_REASONS[number]['value'];

type StockAdjustmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: number;
  componentName: string;
  currentStock: number;
  onSuccess?: () => void;
  onSaveAndNext?: () => void;
};

export function StockAdjustmentDialog({
  open,
  onOpenChange,
  componentId,
  componentName,
  currentStock,
  onSuccess,
  onSaveAndNext,
}: StockAdjustmentDialogProps) {
  const queryClient = useQueryClient();

  // Form state
  const [adjustmentType, setAdjustmentType] = useState<'set' | 'add' | 'subtract' | 'transfer'>('set');
  const [quantity, setQuantity] = useState<string>('');
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [notes, setNotes] = useState('');

  // Transfer-specific state
  const [transferToId, setTransferToId] = useState<number | null>(null);
  const [transferToName, setTransferToName] = useState('');
  const [transferSearch, setTransferSearch] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [transferPickerOpen, setTransferPickerOpen] = useState(false);
  const advancingRef = useRef(false);

  const debouncedTransferSearch = useDebounce(transferSearch, 300);

  // Component search for transfer picker
  const { data: transferComponents = [] } = useQuery({
    queryKey: ['components-transfer-picker', debouncedTransferSearch, componentId],
    queryFn: async () => {
      let q = supabase
        .from('components')
        .select('component_id, internal_code, description')
        .eq('is_active', true)
        .neq('component_id', componentId)
        .order('internal_code')
        .limit(20);
      if (debouncedTransferSearch) {
        q = q.or(`internal_code.ilike.%${debouncedTransferSearch}%,description.ilike.%${debouncedTransferSearch}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: adjustmentType === 'transfer',
  });

  // Calculate the new stock level and adjustment quantity
  const numericQuantity = parseInt(quantity) || 0;
  let newStockLevel = currentStock;
  let adjustmentQuantity = 0;

  if (adjustmentType === 'set') {
    newStockLevel = numericQuantity;
    adjustmentQuantity = numericQuantity - currentStock;
  } else if (adjustmentType === 'add') {
    newStockLevel = currentStock + numericQuantity;
    adjustmentQuantity = numericQuantity;
  } else if (adjustmentType === 'subtract') {
    newStockLevel = currentStock - numericQuantity;
    adjustmentQuantity = -numericQuantity;
  }

  const isLargeAdjustment = Math.abs(adjustmentQuantity) > 50 ||
    (currentStock > 0 && Math.abs(adjustmentQuantity / currentStock) > 0.5);

  const isValid = adjustmentType === 'transfer'
    ? !!transferToId && numericQuantity > 0 && !!reason && (numericQuantity <= currentStock || allowNegative)
    : !!reason && adjustmentQuantity !== 0 && (reason !== 'other' || notes.trim());

  // Mutation for creating the adjustment
  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (adjustmentType === 'transfer') {
        if (!transferToId) throw new Error('No destination component selected');
        const selectedReason = ADJUSTMENT_REASONS.find(r => r.value === reason);
        const { data, error } = await supabase.rpc('transfer_component_stock', {
          p_from_component_id: componentId,
          p_to_component_id: transferToId,
          p_quantity: numericQuantity,
          p_reason: selectedReason?.label || 'Transfer',
          p_notes: notes || null,
        });
        if (error) throw error;
        return data;
      }

      const selectedReason = ADJUSTMENT_REASONS.find(r => r.value === reason);
      const fullReason = `${selectedReason?.label}${notes ? `: ${notes}` : ''}`;

      // Start a transaction: create inventory_transaction and update inventory
      // First, create the transaction record
      const { data: transaction, error: txError } = await supabase
        .from('inventory_transactions')
        .insert({
          component_id: componentId,
          quantity: adjustmentQuantity,
          transaction_type_id: 3, // ADJUSTMENT type
          transaction_date: new Date().toISOString(),
          user_id: user.id,
          reason: fullReason,
        })
        .select()
        .single();

      if (txError) throw txError;

      // Then update or create the inventory record
      const { error: invError } = await supabase
        .from('inventory')
        .upsert(
          {
            component_id: componentId,
            quantity_on_hand: newStockLevel,
            reorder_level: 0,
            location: null
          },
          { onConflict: 'component_id' }
        );

      if (invError) {
        // If inventory update fails, we should ideally rollback the transaction
        // For now, throw the error
        throw invError;
      }

      return transaction;
    },
    onSuccess: () => {
      // Skip default close/reset when Save & Next is handling the flow
      if (advancingRef.current) {
        advancingRef.current = false;
        return;
      }

      if (adjustmentType === 'transfer') {
        toast.success('Stock transfer recorded', {
          description: `${numericQuantity} units transferred from ${componentName} to ${transferToName}`,
        });
      } else {
        toast.success('Stock adjustment recorded', {
          description: `${componentName} stock ${adjustmentQuantity >= 0 ? 'increased' : 'decreased'} by ${Math.abs(adjustmentQuantity)} units`,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['component', componentId] });
      queryClient.invalidateQueries({ queryKey: ['component', componentId, 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['component', componentId, 'inventory'] });
      if (transferToId) {
        queryClient.invalidateQueries({ queryKey: ['component', transferToId] });
        queryClient.invalidateQueries({ queryKey: ['component', transferToId, 'inventory'] });
      }
      onSuccess?.();

      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      const message = error?.message || error?.details || error?.hint || (typeof error === 'string' ? error : 'Unknown error');
      toast.error('Failed to record adjustment', {
        description: message,
      });
    },
  });

  const resetForm = useCallback(() => {
    setAdjustmentType('set');
    setQuantity('');
    setReason('');
    setNotes('');
    setTransferToId(null);
    setTransferToName('');
    setTransferSearch('');
    setAllowNegative(false);
    setTransferPickerOpen(false);
  }, []);

  useEffect(() => {
    resetForm();
  }, [componentId, resetForm]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!reason) {
      toast.error('Please select a reason for the adjustment');
      return;
    }

    if (adjustmentType === 'transfer') {
      if (!transferToId) {
        toast.error('Please select a destination component');
        return;
      }
      if (numericQuantity <= 0) {
        toast.error('Please enter a quantity to transfer');
        return;
      }
    } else {
      if (reason === 'other' && !notes.trim()) {
        toast.error('Please provide details for "Other" reason');
        return;
      }

      if (adjustmentQuantity === 0) {
        toast.error('No change to stock level');
        return;
      }
    }

    adjustmentMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Stock Adjustment
          </DialogTitle>
          <DialogDescription>
            Adjust stock levels for <span className="font-medium">{componentName}</span> after stock take or to correct discrepancies.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Current Stock Display */}
          <div className="bg-muted/50 rounded-md p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Current Stock</p>
              <p className="text-2xl font-bold">{currentStock}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase">New Stock</p>
              <p className={`text-2xl font-bold ${
                adjustmentType === 'transfer'
                  ? (numericQuantity > 0 ? 'text-red-600' : '')
                  : (newStockLevel > currentStock ? 'text-green-600' : newStockLevel < currentStock ? 'text-red-600' : '')
              }`}>
                {adjustmentType === 'transfer'
                  ? (quantity ? currentStock - numericQuantity : '-')
                  : (quantity ? newStockLevel : '-')
                }
              </p>
            </div>
          </div>

          {/* Adjustment Type */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase">Adjustment Type</Label>
            <div className="grid grid-cols-4 gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={adjustmentType === 'set' ? 'default' : 'outline'}
                className="w-full text-xs h-8"
                onClick={() => setAdjustmentType('set')}
              >
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                Set To
              </Button>
              <Button
                type="button"
                size="sm"
                variant={adjustmentType === 'add' ? 'default' : 'outline'}
                className="w-full text-xs h-8"
                onClick={() => setAdjustmentType('add')}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant={adjustmentType === 'subtract' ? 'default' : 'outline'}
                className="w-full text-xs h-8"
                onClick={() => setAdjustmentType('subtract')}
              >
                <Minus className="h-3.5 w-3.5 mr-1" />
                Subtract
              </Button>
              <Button
                type="button"
                size="sm"
                variant={adjustmentType === 'transfer' ? 'default' : 'outline'}
                className="w-full text-xs h-8"
                onClick={() => setAdjustmentType('transfer')}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                Transfer
              </Button>
            </div>
          </div>

          {/* Transfer-specific fields */}
          {adjustmentType === 'transfer' && (
            <div className="space-y-3">
              {/* Destination component search */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase">Transfer To</Label>
                <Popover open={transferPickerOpen} onOpenChange={setTransferPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal h-9">
                      {transferToName ? (
                        <span className="font-medium">{transferToName}</span>
                      ) : (
                        <span className="text-muted-foreground">Search for component...</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <div className="p-2 border-b">
                      <Input
                        placeholder="Search by code or description..."
                        value={transferSearch}
                        onChange={(e) => setTransferSearch(e.target.value)}
                        autoFocus
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto py-1">
                      {transferComponents.map((c) => (
                        <button
                          key={c.component_id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between gap-2"
                          onClick={() => {
                            setTransferToId(c.component_id);
                            setTransferToName(c.internal_code);
                            setTransferSearch('');
                            setTransferPickerOpen(false);
                          }}
                        >
                          <span className="font-medium text-xs">{c.internal_code}</span>
                          <span className="text-muted-foreground text-xs truncate">{c.description}</span>
                        </button>
                      ))}
                      {transferComponents.length === 0 && (
                        <p className="text-xs text-muted-foreground px-3 py-2">No components found</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Quantity */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase">Quantity to Transfer</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter quantity"
                  className="h-9"
                />
              </div>

              {/* Negative stock guard */}
              {numericQuantity > currentStock && !allowNegative && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span>Insufficient stock (current: {currentStock})</span>
                    <label className="flex items-center gap-2 text-xs cursor-pointer ml-2">
                      <input type="checkbox" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />
                      Override
                    </label>
                  </AlertDescription>
                </Alert>
              )}

              {/* Summary */}
              {transferToId && numericQuantity > 0 && (
                <p className="text-sm text-muted-foreground">
                  Transfer {numericQuantity} units: {componentName} → {transferToName}
                </p>
              )}
            </div>
          )}

          {/* Quantity Input — only shown for non-transfer modes */}
          {adjustmentType !== 'transfer' && (
            <div className="space-y-1.5">
              <Label htmlFor="quantity" className="text-xs text-muted-foreground uppercase">
                {adjustmentType === 'set' ? 'New Stock Level' : 'Quantity'}
              </Label>
              <Input
                id="quantity"
                type="number"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={adjustmentType === 'set' ? 'Enter counted quantity' : 'Enter quantity'}
                className="h-9"
              />
              {quantity && adjustmentQuantity !== 0 && (
                <p className={`text-sm ${adjustmentQuantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {adjustmentQuantity > 0 ? '+' : ''}{adjustmentQuantity} units
                </p>
              )}
            </div>
          )}

          {/* Reason Selection */}
          <div className="space-y-1.5">
            <Label htmlFor="reason" className="text-xs text-muted-foreground uppercase">
              Reason {adjustmentType === 'transfer' ? 'for Transfer' : 'for Adjustment'} *
            </Label>
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs text-muted-foreground uppercase">
              Additional Notes {reason === 'other' && '*'}
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter any additional details..."
              rows={2}
            />
          </div>

          {/* Large Adjustment Warning — only for non-transfer modes */}
          {adjustmentType !== 'transfer' && isLargeAdjustment && quantity && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This is a significant adjustment ({Math.abs(adjustmentQuantity)} units, {currentStock > 0 ? `${Math.round(Math.abs(adjustmentQuantity / currentStock) * 100)}% of current stock` : 'from zero stock'}).
                Please verify the count is correct.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={adjustmentMutation.isPending}
            >
              Cancel
            </Button>
            {onSaveAndNext && (
              <Button
                type="button"
                variant="secondary"
                disabled={!isValid || adjustmentMutation.isPending}
                onClick={() => {
                  if (!isValid) return;
                  advancingRef.current = true;
                  adjustmentMutation.mutate(undefined, {
                    onSuccess: () => {
                      toast.success(`${componentName} adjusted`);
                      queryClient.invalidateQueries({ queryKey: ['component', componentId] });
                      onSuccess?.();
                      resetForm();
                      onSaveAndNext();
                    },
                    onError: () => {
                      advancingRef.current = false;
                    },
                  });
                }}
              >
                Save & Next
              </Button>
            )}
            <Button
              type="submit"
              disabled={!isValid || adjustmentMutation.isPending}
            >
              {adjustmentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {adjustmentType === 'transfer' ? 'Transferring...' : 'Recording...'}
                </>
              ) : (
                adjustmentType === 'transfer' ? 'Transfer Stock' : 'Record Adjustment'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
