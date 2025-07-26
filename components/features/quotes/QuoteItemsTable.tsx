'use client';

import { useState } from 'react';
import {
  QuoteItem,
  createQuoteItem,
  updateQuoteItem,
  deleteQuoteItem,
} from '@/lib/db/quotes';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Props {
  quoteId: string;
  items: QuoteItem[];
  onItemsChange: (items: QuoteItem[]) => void;
}

export default function QuoteItemsTable({ quoteId, items, onItemsChange }: Props) {
  const handleAdd = async () => {
    const newItem = await createQuoteItem({
      quote_id: quoteId,
      description: '',
      qty: 0,
      unit_price: 0,
    });
    onItemsChange([...items, newItem]);
  };

  const handleUpdate = async (
    id: string,
    field: keyof Pick<QuoteItem, 'description' | 'qty' | 'unit_price'>,
    value: string | number
  ) => {
    const updates: Partial<QuoteItem> = { [field]: value };
    const updated = await updateQuoteItem(id, updates);
    onItemsChange(items.map(i => (i.id === id ? updated : i)));
  };

  const handleDelete = async (id: string) => {
    await deleteQuoteItem(id);
    onItemsChange(items.filter(i => i.id !== id));
  };

  const calculateTotal = (qty: number, unit_price: number) => qty * unit_price;

  return (
    <div>
      <Button onClick={handleAdd} size="sm" className="mb-2">
        Add Item
      </Button>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Unit Price</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              <TableCell>
                <Input
                  value={item.description}
                  onChange={e => handleUpdate(item.id, 'description', e.target.value)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={item.qty}
                  onChange={e => handleUpdate(item.id, 'qty', parseFloat(e.target.value) || 0)}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={item.unit_price}
                  onChange={e => handleUpdate(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                />
              </TableCell>
              <TableCell>
                {calculateTotal(item.qty, item.unit_price).toFixed(2)}
              </TableCell>
              <TableCell>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(item.id)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
