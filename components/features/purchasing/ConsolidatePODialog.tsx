'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export interface ExistingDraftPO {
  purchase_order_id: number;
  q_number: string | null;
  created_at: string;
  notes: string | null;
  line_count: number;
  total_amount: number;
}

export interface SupplierWithDrafts {
  supplierId: number;
  supplierName: string;
  existingDrafts: ExistingDraftPO[];
}

interface ConsolidatePODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliersWithDrafts: SupplierWithDrafts[];
  onConfirm: (decisions: Record<number, number | 'new'>) => void;
  isLoading?: boolean;
}

export function ConsolidatePODialog({
  open,
  onOpenChange,
  suppliersWithDrafts,
  onConfirm,
  isLoading = false,
}: ConsolidatePODialogProps) {
  // Track decision for each supplier: either a PO ID to add to, or 'new' to create new
  const [decisions, setDecisions] = useState<Record<number, number | 'new'>>(() => {
    const initial: Record<number, number | 'new'> = {};
    suppliersWithDrafts.forEach(supplier => {
      // Default to the most recent draft
      if (supplier.existingDrafts.length > 0) {
        initial[supplier.supplierId] = supplier.existingDrafts[0].purchase_order_id;
      } else {
        initial[supplier.supplierId] = 'new';
      }
    });
    return initial;
  });

  const handleConfirm = () => {
    onConfirm(decisions);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Existing Draft Orders Found</DialogTitle>
          <DialogDescription>
            Draft purchase orders already exist for the following suppliers. 
            You can add items to an existing draft or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {suppliersWithDrafts.map((supplier) => (
            <div key={supplier.supplierId} className="space-y-3">
              <h4 className="font-medium text-sm">{supplier.supplierName}</h4>
              
              <RadioGroup
                value={String(decisions[supplier.supplierId])}
                onValueChange={(value) => {
                  setDecisions(prev => ({
                    ...prev,
                    [supplier.supplierId]: value === 'new' ? 'new' : parseInt(value, 10)
                  }));
                }}
                className="space-y-2"
              >
                {supplier.existingDrafts.map((draft) => (
                  <div
                    key={draft.purchase_order_id}
                    className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                    onClick={() => setDecisions(prev => ({
                      ...prev,
                      [supplier.supplierId]: draft.purchase_order_id
                    }))}
                  >
                    <RadioGroupItem
                      value={String(draft.purchase_order_id)}
                      id={`po-${draft.purchase_order_id}`}
                    />
                    <Label
                      htmlFor={`po-${draft.purchase_order_id}`}
                      className="flex-1 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            PO #{draft.purchase_order_id}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {draft.line_count} item{draft.line_count !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          R{draft.total_amount.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Created {format(new Date(draft.created_at), 'MMM d, yyyy')}
                        {draft.notes && ` • ${draft.notes.slice(0, 50)}${draft.notes.length > 50 ? '...' : ''}`}
                      </p>
                    </Label>
                  </div>
                ))}

                <div
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                  onClick={() => setDecisions(prev => ({
                    ...prev,
                    [supplier.supplierId]: 'new'
                  }))}
                >
                  <RadioGroupItem value="new" id={`new-${supplier.supplierId}`} />
                  <Label
                    htmlFor={`new-${supplier.supplierId}`}
                    className="cursor-pointer"
                  >
                    <span className="font-medium">Create new Purchase Order</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
