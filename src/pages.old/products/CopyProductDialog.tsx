'use client';

import { useEffect, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { ProductRow } from './ProductsPage';

type CopyProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProduct: ProductRow;
  onCopyComplete?: (product: { product_id: number; internal_code: string; name: string }) => void;
};

const DEFAULT_COPY_OPTIONS = {
  categories: true,
  bom: true,
  bol: true,
  overhead: true,
};

export function CopyProductDialog({
  open,
  onOpenChange,
  sourceProduct,
  onCopyComplete,
}: CopyProductDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [internalCode, setInternalCode] = useState('');
  const [name, setName] = useState('');
  const [copyCategories, setCopyCategories] = useState(DEFAULT_COPY_OPTIONS.categories);
  const [copyBom, setCopyBom] = useState(DEFAULT_COPY_OPTIONS.bom);
  const [copyBol, setCopyBol] = useState(DEFAULT_COPY_OPTIONS.bol);
  const [copyOverhead, setCopyOverhead] = useState(DEFAULT_COPY_OPTIONS.overhead);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (open) {
      setInternalCode(`${sourceProduct.internal_code}-COPY`);
      setName(`${sourceProduct.name} (Copy)`);
      setCopyCategories(DEFAULT_COPY_OPTIONS.categories);
      setCopyBom(DEFAULT_COPY_OPTIONS.bom);
      setCopyBol(DEFAULT_COPY_OPTIONS.bol);
      setCopyOverhead(DEFAULT_COPY_OPTIONS.overhead);
      return;
    }

    setInternalCode('');
    setName('');
    setCopyCategories(DEFAULT_COPY_OPTIONS.categories);
    setCopyBom(DEFAULT_COPY_OPTIONS.bom);
    setCopyBol(DEFAULT_COPY_OPTIONS.bol);
    setCopyOverhead(DEFAULT_COPY_OPTIONS.overhead);
    setCopying(false);
  }, [open, sourceProduct.internal_code, sourceProduct.name]);

  const handleCopy = async () => {
    if (!internalCode.trim()) {
      toast({
        title: 'Product code required',
        description: 'Please enter a product code for the duplicate.',
        variant: 'destructive',
      });
      return;
    }

    if (!name.trim()) {
      toast({
        title: 'Product name required',
        description: 'Please enter a name for the duplicate.',
        variant: 'destructive',
      });
      return;
    }

    setCopying(true);

    try {
      const response = await authorizedFetch(`/api/products/${sourceProduct.product_id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({
          internal_code: internalCode.trim(),
          name: name.trim(),
          copy_categories: copyCategories,
          copy_bom: copyBom,
          copy_bol: copyBol,
          copy_overhead: copyOverhead,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Failed to duplicate product');
      }

      await queryClient.invalidateQueries({ queryKey: ['products'] });

      toast({
        title: 'Product duplicated',
        description: `Created ${result.product?.internal_code ?? internalCode.trim()} successfully.`,
      });

      onOpenChange(false);
      onCopyComplete?.(result.product);
    } catch (error) {
      console.error('[copy-product-dialog] failed duplicating product', error);
      toast({
        title: 'Duplicate failed',
        description: error instanceof Error ? error.message : 'Could not duplicate the product.',
        variant: 'destructive',
      });
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate Product</DialogTitle>
          <DialogDescription>
            Create a copy of &quot;{sourceProduct.internal_code}&quot; with a new code and name.
            Categories, BOM, labor, and overhead can be copied into the new product. Images
            and product options are not copied by this quick duplicate flow yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="source-product">Source Product</Label>
            <Input
              id="source-product"
              value={`${sourceProduct.internal_code} - ${sourceProduct.name}`}
              disabled
              className="bg-muted"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duplicate-product-code">New Product Code</Label>
            <Input
              id="duplicate-product-code"
              value={internalCode}
              onChange={(event) => setInternalCode(event.target.value)}
              placeholder="Enter a new product code"
              disabled={copying}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duplicate-product-name">New Product Name</Label>
            <Input
              id="duplicate-product-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter a new product name"
              disabled={copying}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !copying) {
                  event.preventDefault();
                  handleCopy();
                }
              }}
            />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="text-sm font-medium text-foreground">Copy Into The New Product</div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="copy-categories"
                checked={copyCategories}
                onCheckedChange={(checked) => setCopyCategories(Boolean(checked))}
                disabled={copying}
              />
              <Label htmlFor="copy-categories" className="font-normal">
                Categories
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="copy-bom"
                checked={copyBom}
                onCheckedChange={(checked) => setCopyBom(Boolean(checked))}
                disabled={copying}
              />
              <Label htmlFor="copy-bom" className="font-normal">
                Bill of Materials
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="copy-bol"
                checked={copyBol}
                onCheckedChange={(checked) => setCopyBol(Boolean(checked))}
                disabled={copying}
              />
              <Label htmlFor="copy-bol" className="font-normal">
                Bill of Labor
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="copy-overhead"
                checked={copyOverhead}
                onCheckedChange={(checked) => setCopyOverhead(Boolean(checked))}
                disabled={copying}
              />
              <Label htmlFor="copy-overhead" className="font-normal">
                Overhead costs
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={copying}>
            Cancel
          </Button>
          <Button onClick={handleCopy} disabled={copying || !internalCode.trim() || !name.trim()}>
            {copying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {copying ? 'Duplicating...' : 'Duplicate Product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
