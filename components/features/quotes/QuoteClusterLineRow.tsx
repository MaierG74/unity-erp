'use client';

import React from 'react';
import { QuoteClusterLine, formatCurrency } from '@/lib/db/quotes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, Pencil } from 'lucide-react';
import { TableRow, TableCell } from '@/components/ui/table';

interface QuoteClusterLineRowProps {
  line: QuoteClusterLine;
  onUpdate: (id: string, updates: Partial<QuoteClusterLine>) => void;
  onDelete: (id: string) => void;
  onEdit?: (line: QuoteClusterLine) => void;
}

const QuoteClusterLineRow: React.FC<QuoteClusterLineRowProps> = ({ line, onUpdate, onDelete, onEdit }) => {
  const [description, setDescription] = React.useState(line.description || '');
  const [qty, setQty] = React.useState<string>(String(line.qty));
  const [unitCost, setUnitCost] = React.useState<string>(String(Math.round((line.unit_cost || 0) * 100) / 100));

  const handleBlur = <T extends keyof QuoteClusterLine>(field: T, value: QuoteClusterLine[T]) => {
    if (line[field] !== value) {
      onUpdate(line.id, { [field]: value });
    }
  };

  React.useEffect(() => { setDescription(line.description || ''); }, [line.description]);
  React.useEffect(() => { setQty(String(line.qty)); }, [line.qty]);
  React.useEffect(() => { setUnitCost(String(Math.round((line.unit_cost || 0) * 100) / 100)); }, [line.unit_cost]);

  const missingCost = (line.unit_cost ?? 0) === 0;

  const typeBadgeClass: Record<string, string> = {
    manual: 'bg-gray-100 text-gray-600',
    component: 'bg-teal-100 text-teal-700',
    product: 'bg-blue-100 text-blue-700',
    cluster: 'bg-purple-100 text-purple-700',
    overhead: 'bg-orange-100 text-orange-700',
  };
  const typeLabel = line.line_type
    ? line.line_type.charAt(0).toUpperCase() + line.line_type.slice(1)
    : '';
  const badgeClass = typeBadgeClass[line.line_type ?? ''] ?? 'bg-gray-100 text-gray-600';

  return (
    <TableRow>
      <TableCell>
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
          {typeLabel}
        </span>
      </TableCell>
      <TableCell>
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={() => handleBlur('description', description)}
          className="text-sm h-8"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          onBlur={() => { const numQty = Number(qty) || 0; handleBlur('qty', numQty as QuoteClusterLine['qty']); setQty(String(numQty)); }}
          onFocus={e => e.target.select()}
          className="text-sm h-8 w-24 text-right bg-background text-foreground border-border"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          value={unitCost}
          onChange={e => setUnitCost(e.target.value)}
          onBlur={() => { const numCost = Math.round((Number(unitCost) || 0) * 100) / 100; handleBlur('unit_cost', numCost as QuoteClusterLine['unit_cost']); setUnitCost(String(numCost)); }}
          onFocus={e => e.target.select()}
          className={`text-sm h-8 w-24 bg-background text-foreground border ${missingCost ? 'border-amber-400 bg-amber-50' : 'border-border'}`}
        />
      </TableCell>
      <TableCell className="text-sm text-right font-medium">{formatCurrency((Number(qty) || 0) * (Number(unitCost) || 0))}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit line"
              aria-label="Edit line"
              onClick={() => onEdit(line)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="destructiveSoft"
            size="icon"
            className="h-8 w-8"
            title="Delete line"
            aria-label="Delete line"
            onClick={() => onDelete(line.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

export default QuoteClusterLineRow;
