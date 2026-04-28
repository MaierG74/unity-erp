'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Search, X, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type OverheadElement = {
  element_id: number;
  code: string;
  name: string;
  description: string | null;
  cost_type: 'fixed' | 'percentage';
  default_value: number;
  percentage_basis: 'materials' | 'labor' | 'total' | null;
  is_active: boolean;
};

type Props = {
  productId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingElementIds: number[];
  onSuccess: () => void;
};

export function AddOverheadDialog({
  productId,
  open,
  onOpenChange,
  existingElementIds,
  onSuccess,
}: Props) {
  const [searchText, setSearchText] = useState('');
  const [selectedElement, setSelectedElement] = useState<OverheadElement | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [overrideValue, setOverrideValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCostType, setNewCostType] = useState<'fixed' | 'percentage'>('fixed');
  const [newDefaultValue, setNewDefaultValue] = useState('');
  const [newPercentageBasis, setNewPercentageBasis] = useState<'materials' | 'labor' | 'total'>('total');
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch available overhead elements
  const { data: elements = [], isLoading } = useQuery({
    queryKey: ['overhead-cost-elements'],
    queryFn: async () => {
      const res = await fetch('/api/overhead-cost-elements');
      if (!res.ok) throw new Error('Failed to fetch overhead cost elements');
      const data = await res.json();
      return data.elements as OverheadElement[];
    },
    enabled: open,
  });

  // Filter to only active elements not already assigned
  const availableElements = useMemo(() => {
    return elements.filter(
      (el) => el.is_active && !existingElementIds.includes(el.element_id)
    );
  }, [elements, existingElementIds]);

  // Search filter
  const filteredElements = useMemo(() => {
    if (!searchText) return availableElements;
    const lower = searchText.toLowerCase();
    return availableElements.filter(
      (el) =>
        el.code.toLowerCase().includes(lower) ||
        el.name.toLowerCase().includes(lower)
    );
  }, [availableElements, searchText]);

  const formatValue = (element: OverheadElement) => {
    if (element.cost_type === 'fixed') {
      return `R${element.default_value.toFixed(2)}`;
    }
    return `${element.default_value}% of ${element.percentage_basis}`;
  };

  const handleSelect = (element: OverheadElement) => {
    setSelectedElement(element);
    setCreateMode(false);
    setQuantity('1');
    setOverrideValue('');
  };

  const resetNewElementForm = () => {
    setNewCode('');
    setNewName('');
    setNewCostType('fixed');
    setNewDefaultValue('');
    setNewPercentageBasis('total');
  };

  const handleCreateElement = async () => {
    const code = newCode.trim();
    const name = newName.trim();
    const defaultValue = Number(newDefaultValue);

    if (!code || !name) {
      toast({
        title: 'Missing overhead details',
        description: 'Code and name are required.',
        variant: 'destructive',
      });
      return;
    }

    if (!Number.isFinite(defaultValue) || defaultValue < 0) {
      toast({
        title: 'Invalid value',
        description: 'Enter a value of 0 or more.',
        variant: 'destructive',
      });
      return;
    }

    setIsCreating(true);
    try {
      const res = await authorizedFetch('/api/overhead-cost-elements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name,
          description: null,
          cost_type: newCostType,
          default_value: defaultValue,
          percentage_basis: newCostType === 'percentage' ? newPercentageBasis : null,
          is_active: true,
          category_id: null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create overhead element');
      }

      const json = (await res.json()) as { element: OverheadElement };
      const created = json.element;
      await queryClient.invalidateQueries({ queryKey: ['overhead-cost-elements'] });
      setSelectedElement(created);
      setCreateMode(false);
      setQuantity('1');
      setOverrideValue('');
      resetNewElementForm();
      toast({
        title: 'Overhead element created',
        description: `"${created.name}" is ready to add to this product.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to create overhead element',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedElement) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        element_id: selectedElement.element_id,
        quantity: parseFloat(quantity) || 1,
      };

      if (overrideValue.trim()) {
        payload.override_value = parseFloat(overrideValue);
      }

      const res = await authorizedFetch(`/api/products/${productId}/overhead`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add overhead cost');
      }

      toast({
        title: 'Overhead cost added',
        description: `"${selectedElement.name}" has been added to this product.`,
      });

      onSuccess();
      onOpenChange(false);
      setSelectedElement(null);
      setSearchText('');
    } catch (err) {
      toast({
        title: 'Failed to add overhead cost',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedElement(null);
    setSearchText('');
    setCreateMode(false);
    setQuantity('1');
    setOverrideValue('');
    resetNewElementForm();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Overhead Cost</DialogTitle>
          <DialogDescription>
            Select an overhead cost element to add to this product.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 overflow-hidden">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search overhead elements..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-9 pr-10"
            />
            {searchText && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setSearchText('')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">
            {/* Elements list */}
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Element</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : filteredElements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        <div className="space-y-3">
                          <div>
                            {searchText
                              ? 'No matching elements found.'
                              : availableElements.length === 0
                                ? 'All overhead elements are already assigned.'
                                : 'No overhead elements available.'}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCreateMode(true);
                              setSelectedElement(null);
                              if (searchText.trim() && !newName.trim()) {
                                setNewName(searchText.trim());
                              }
                            }}
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Create new overhead
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredElements.map((element) => (
                      <TableRow
                        key={element.element_id}
                        className={
                          selectedElement?.element_id === element.element_id
                            ? 'bg-accent'
                            : 'cursor-pointer hover:bg-muted/50'
                        }
                        onClick={() => handleSelect(element)}
                      >
                        <TableCell>
                          <div className="font-mono text-sm">{element.code}</div>
                          <div className="text-xs text-muted-foreground">{element.name}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={element.cost_type === 'fixed' ? 'default' : 'secondary'}>
                            {formatValue(element)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelect(element);
                            }}
                          >
                            Select
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Selection details */}
            <div className="border rounded-md p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{createMode ? 'New overhead' : 'Selection'}</div>
                {!createMode && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCreateMode(true);
                      setSelectedElement(null);
                      if (searchText.trim() && !newName.trim()) {
                        setNewName(searchText.trim());
                      }
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New
                  </Button>
                )}
              </div>
              {createMode ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="new-overhead-code">Code</Label>
                      <Input
                        id="new-overhead-code"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                        placeholder="WRAP"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-overhead-name">Name</Label>
                      <Input
                        id="new-overhead-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Wrapping"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Type</Label>
                      <Select
                        value={newCostType}
                        onValueChange={(value) => setNewCostType(value as 'fixed' | 'percentage')}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed Amount</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="new-overhead-value">
                        {newCostType === 'fixed' ? 'Amount (R)' : 'Percentage (%)'}
                      </Label>
                      <Input
                        id="new-overhead-value"
                        type="number"
                        min="0"
                        step={newCostType === 'fixed' ? '0.01' : '0.1'}
                        value={newDefaultValue}
                        onChange={(e) => setNewDefaultValue(e.target.value)}
                        placeholder={newCostType === 'fixed' ? '20.00' : '5'}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  {newCostType === 'percentage' && (
                    <div>
                      <Label>Calculate percentage of</Label>
                      <Select
                        value={newPercentageBasis}
                        onValueChange={(value) => setNewPercentageBasis(value as 'materials' | 'labor' | 'total')}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="materials">Materials Cost</SelectItem>
                          <SelectItem value="labor">Labor Cost</SelectItem>
                          <SelectItem value="total">Total (Materials + Labor)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCreateMode(false);
                        resetNewElementForm();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleCreateElement} disabled={isCreating}>
                      {isCreating ? 'Creating...' : 'Create overhead'}
                    </Button>
                  </div>
                </div>
              ) : !selectedElement ? (
                <div className="text-sm text-muted-foreground">
                  Select an overhead element from the list to configure its quantity and optional
                  value override, or create a new one without leaving costing.
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="font-mono font-medium">{selectedElement.code}</div>
                    <div className="text-sm">{selectedElement.name}</div>
                    {selectedElement.description && (
                      <div className="text-xs text-muted-foreground">
                        {selectedElement.description}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="quantity">Quantity</Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Multiplier for this cost (default: 1)
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="override">
                        Override Value (optional)
                      </Label>
                      <Input
                        id="override"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={
                          selectedElement.cost_type === 'fixed'
                            ? `Default: R${selectedElement.default_value.toFixed(2)}`
                            : `Default: ${selectedElement.default_value}%`
                        }
                        value={overrideValue}
                        onChange={(e) => setOverrideValue(e.target.value)}
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Leave empty to use the element's default value
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!selectedElement || isSubmitting || createMode}>
            <Plus className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Adding...' : 'Add Overhead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
