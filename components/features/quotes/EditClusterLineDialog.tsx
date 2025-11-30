'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  QuoteClusterLine, 
  fetchSupplierComponentsForComponent, 
  SupplierComponent,
  formatCurrency 
} from '@/lib/db/quotes';

interface EditClusterLineDialogProps {
  open: boolean;
  onClose: () => void;
  line: QuoteClusterLine;
  onSave: (lineId: string, updates: Partial<QuoteClusterLine>) => void;
}

const EditClusterLineDialog: React.FC<EditClusterLineDialogProps> = ({
  open,
  onClose,
  line,
  onSave,
}) => {
  const [description, setDescription] = useState(line.description || '');
  const [qty, setQty] = useState<string>(String(line.qty));
  const [unitCost, setUnitCost] = useState<string>(String(line.unit_cost || 0));
  const [supplierComponents, setSupplierComponents] = useState<SupplierComponent[]>([]);
  const [selectedSupplierComponent, setSelectedSupplierComponent] = useState<SupplierComponent | null>(null);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [overrideUnitCost, setOverrideUnitCost] = useState(false);
  const [showSupplierSelection, setShowSupplierSelection] = useState(false);

  // Reset state when dialog opens with new line
  useEffect(() => {
    if (open) {
      setDescription(line.description || '');
      setQty(String(line.qty));
      setUnitCost(String(line.unit_cost || 0));
      setSelectedSupplierComponent(null);
      setOverrideUnitCost(false);
      setShowSupplierSelection(false);
      setSupplierComponents([]);
    }
  }, [open, line]);

  // Load suppliers when user wants to change supplier
  const handleLoadSuppliers = async () => {
    if (!line.component_id) return;
    
    setLoadingSuppliers(true);
    try {
      const suppliers = await fetchSupplierComponentsForComponent(line.component_id);
      setSupplierComponents(suppliers);
      setShowSupplierSelection(true);
      
      // Pre-select current supplier if we have supplier_component_id
      if (line.supplier_component_id) {
        const current = suppliers.find(s => s.supplier_component_id === line.supplier_component_id);
        if (current) {
          setSelectedSupplierComponent(current);
        }
      }
    } catch (error) {
      console.error('Error loading suppliers:', error);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const handleSupplierSelect = (supplierComponent: SupplierComponent) => {
    setSelectedSupplierComponent(supplierComponent);
    // Update unit cost from supplier price
    setUnitCost(String(supplierComponent.price || 0));
    // Update description to include supplier name
    const baseDesc = line.description?.replace(/\s*\([^)]*\)\s*$/, '') || '';
    setDescription(`${baseDesc} (${supplierComponent.supplier?.name || 'Unknown'})`);
    setOverrideUnitCost(false);
  };

  const handleSave = () => {
    const updates: Partial<QuoteClusterLine> = {
      description: description.trim(),
      qty: Number(qty) || 1,
      unit_cost: Math.round((Number(unitCost) || 0) * 100) / 100,
    };

    // If a new supplier was selected, update supplier_component_id
    if (selectedSupplierComponent) {
      updates.supplier_component_id = selectedSupplierComponent.supplier_component_id;
    }

    onSave(line.id, updates);
    onClose();
  };

  const handleClose = () => {
    setShowSupplierSelection(false);
    setSupplierComponents([]);
    setSelectedSupplierComponent(null);
    onClose();
  };

  const isComponentLine = line.line_type === 'component' && line.component_id;
  const total = (Number(qty) || 0) * (Number(unitCost) || 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>Edit Costing Line</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
          {/* Line Type Badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-1 rounded bg-muted text-muted-foreground capitalize">
              {line.line_type}
            </span>
            {isComponentLine && (
              <span className="text-xs text-muted-foreground">
                Component ID: {line.component_id}
              </span>
            )}
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="edit-description">Description</Label>
            <Input
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description..."
              className="text-foreground"
            />
          </div>

          {/* Supplier Selection (only for component lines) */}
          {isComponentLine && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Supplier</Label>
                {!showSupplierSelection && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleLoadSuppliers}
                    disabled={loadingSuppliers}
                  >
                    {loadingSuppliers ? 'Loading...' : 'Change Supplier'}
                  </Button>
                )}
              </div>

              {showSupplierSelection && (
                <div className="border border-input rounded bg-card">
                  {loadingSuppliers ? (
                    <div className="text-center py-4 text-muted-foreground">Loading suppliers...</div>
                  ) : supplierComponents.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      No suppliers available for this component.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {supplierComponents.map((sc) => {
                        const isSelected = selectedSupplierComponent?.supplier_component_id === sc.supplier_component_id;
                        const isCurrent = line.supplier_component_id === sc.supplier_component_id;
                        const min = supplierComponents.reduce(
                          (m, s) => (Number(s.price || Infinity) < m ? Number(s.price || Infinity) : m),
                          Infinity
                        );
                        const isLowest = Number(sc.price || Infinity) === min && Number.isFinite(min);

                        return (
                          <div
                            key={sc.supplier_component_id}
                            className={`p-3 border-b border-input cursor-pointer hover:bg-muted/40 ${
                              isSelected ? 'bg-accent text-accent-foreground' : ''
                            }`}
                            onClick={() => handleSupplierSelect(sc)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {sc.supplier?.name}
                                  {isCurrent && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                      Current
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Code: {sc.supplier_code}
                                </div>
                                {sc.lead_time && (
                                  <div className="text-xs text-muted-foreground">
                                    Lead time: {sc.lead_time} days
                                  </div>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="font-medium">
                                  {formatCurrency(Number(sc.price || 0))}
                                  {isLowest && (
                                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                                      Lowest
                                    </span>
                                  )}
                                </div>
                                {sc.min_order_quantity && (
                                  <div className="text-xs text-muted-foreground">
                                    Min: {sc.min_order_quantity}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quantity and Unit Cost */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-qty">Quantity</Label>
              <Input
                id="edit-qty"
                type="number"
                min="0"
                step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="text-foreground"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-unit-cost">Unit Cost (R)</Label>
                {selectedSupplierComponent && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      id="override-cost"
                      checked={overrideUnitCost}
                      onCheckedChange={(v) => setOverrideUnitCost(Boolean(v))}
                    />
                    <label htmlFor="override-cost">Override</label>
                  </div>
                )}
              </div>
              <Input
                id="edit-unit-cost"
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                onFocus={(e) => e.target.select()}
                disabled={selectedSupplierComponent !== null && !overrideUnitCost}
                className={`text-foreground ${
                  selectedSupplierComponent && !overrideUnitCost ? 'bg-muted cursor-not-allowed' : ''
                }`}
              />
            </div>
          </div>

          {/* Total Display */}
          <div className="flex justify-between items-center pt-2 border-t border-border">
            <span className="text-sm text-muted-foreground">Line Total:</span>
            <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" className="h-9" onClick={handleClose}>
            Cancel
          </Button>
          <Button size="sm" className="h-9" onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditClusterLineDialog;
