'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
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
  const { toast } = useToast();

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
    setQuantity('1');
    setOverrideValue('');
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

      const res = await fetch(`/api/products/${productId}/overhead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    setQuantity('1');
    setOverrideValue('');
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
                        {searchText
                          ? 'No matching elements found.'
                          : availableElements.length === 0
                            ? 'All overhead elements are already assigned.'
                            : 'No overhead elements available.'}
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
              <div className="font-medium">Selection</div>
              {!selectedElement ? (
                <div className="text-sm text-muted-foreground">
                  Select an overhead element from the list to configure its quantity and optional
                  value override.
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
          <Button onClick={handleAdd} disabled={!selectedElement || isSubmitting}>
            <Plus className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Adding...' : 'Add Overhead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
