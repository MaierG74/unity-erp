'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Loader2, AlertTriangle, Plus, Minus, ClipboardCheck } from 'lucide-react';
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
};

export function StockAdjustmentDialog({
  open,
  onOpenChange,
  componentId,
  componentName,
  currentStock,
}: StockAdjustmentDialogProps) {
  const queryClient = useQueryClient();
  
  // Form state
  const [adjustmentType, setAdjustmentType] = useState<'set' | 'add' | 'subtract'>('set');
  const [quantity, setQuantity] = useState<string>('');
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [notes, setNotes] = useState('');
  
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
  
  // Mutation for creating the adjustment
  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
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
      toast.success('Stock adjustment recorded', {
        description: `${componentName} stock ${adjustmentQuantity >= 0 ? 'increased' : 'decreased'} by ${Math.abs(adjustmentQuantity)} units`,
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['component', componentId] });
      queryClient.invalidateQueries({ queryKey: ['component', componentId, 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['component', componentId, 'inventory'] });
      
      // Reset form and close
      resetForm();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to record adjustment', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
  
  const resetForm = () => {
    setAdjustmentType('set');
    setQuantity('');
    setReason('');
    setNotes('');
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!reason) {
      toast.error('Please select a reason for the adjustment');
      return;
    }
    
    if (reason === 'other' && !notes.trim()) {
      toast.error('Please provide details for "Other" reason');
      return;
    }
    
    if (adjustmentQuantity === 0) {
      toast.error('No change to stock level');
      return;
    }
    
    adjustmentMutation.mutate();
  };
  
  const isValid = reason && adjustmentQuantity !== 0 && (reason !== 'other' || notes.trim());
  
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
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current Stock Display */}
          <div className="bg-muted/50 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Current Stock</p>
              <p className="text-2xl font-bold">{currentStock}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">New Stock</p>
              <p className={`text-2xl font-bold ${
                newStockLevel > currentStock ? 'text-green-600' : 
                newStockLevel < currentStock ? 'text-red-600' : ''
              }`}>
                {quantity ? newStockLevel : '-'}
              </p>
            </div>
          </div>
          
          {/* Adjustment Type */}
          <div className="space-y-2">
            <Label>Adjustment Type</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={adjustmentType === 'set' ? 'default' : 'outline'}
                className="w-full"
                onClick={() => setAdjustmentType('set')}
              >
                <ClipboardCheck className="h-4 w-4 mr-1" />
                Set To
              </Button>
              <Button
                type="button"
                variant={adjustmentType === 'add' ? 'default' : 'outline'}
                className="w-full"
                onClick={() => setAdjustmentType('add')}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
              <Button
                type="button"
                variant={adjustmentType === 'subtract' ? 'default' : 'outline'}
                className="w-full"
                onClick={() => setAdjustmentType('subtract')}
              >
                <Minus className="h-4 w-4 mr-1" />
                Subtract
              </Button>
            </div>
          </div>
          
          {/* Quantity Input */}
          <div className="space-y-2">
            <Label htmlFor="quantity">
              {adjustmentType === 'set' ? 'New Stock Level' : 'Quantity'}
            </Label>
            <Input
              id="quantity"
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={adjustmentType === 'set' ? 'Enter counted quantity' : 'Enter quantity'}
              className="text-lg"
            />
            {quantity && adjustmentQuantity !== 0 && (
              <p className={`text-sm ${adjustmentQuantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {adjustmentQuantity > 0 ? '+' : ''}{adjustmentQuantity} units
              </p>
            )}
          </div>
          
          {/* Reason Selection */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Adjustment *</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    <div className="flex flex-col">
                      <span>{r.label}</span>
                      <span className="text-xs text-muted-foreground">{r.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">
              Additional Notes {reason === 'other' && '*'}
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter any additional details about this adjustment..."
              rows={2}
            />
          </div>
          
          {/* Large Adjustment Warning */}
          {isLargeAdjustment && quantity && (
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
            <Button
              type="submit"
              disabled={!isValid || adjustmentMutation.isPending}
            >
              {adjustmentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                'Record Adjustment'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
