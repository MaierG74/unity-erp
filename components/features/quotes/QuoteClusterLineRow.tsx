'use client';

import React from 'react';
import { QuoteClusterLine } from '@/lib/db/quotes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { TableRow, TableCell } from '@/components/ui/table';

interface QuoteClusterLineRowProps {
  line: QuoteClusterLine;
  onUpdate: (id: string, updates: Partial<QuoteClusterLine>) => void;
  onDelete: (id: string) => void;
}

const QuoteClusterLineRow: React.FC<QuoteClusterLineRowProps> = ({ line, onUpdate, onDelete }) => {
  const [description, setDescription] = React.useState(line.description || '');
  const [qty, setQty] = React.useState(line.qty);
  const [unitCost, setUnitCost] = React.useState(line.unit_cost || 0);

  const handleBlur = <T extends keyof QuoteClusterLine>(field: T, value: QuoteClusterLine[T]) => {
    if (line[field] !== value) {
      onUpdate(line.id, { [field]: value });
    }
  };

  React.useEffect(() => { setDescription(line.description || ''); }, [line.description]);
  React.useEffect(() => { setQty(line.qty); }, [line.qty]);
  React.useEffect(() => { setUnitCost(line.unit_cost || 0); }, [line.unit_cost]);

  const missingCost = (line.unit_cost ?? 0) === 0;

  return (
    <TableRow>
      <TableCell className="text-sm">{line.line_type}</TableCell>
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
          onChange={e => setQty(Number(e.target.value))}
          onBlur={() => handleBlur('qty', qty)}
          onFocus={e => e.target.select()}
          className="text-sm h-8 w-24 text-right bg-background text-foreground border-border"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={unitCost}
          onChange={e => setUnitCost(Number(e.target.value))}
          onBlur={() => handleBlur('unit_cost', unitCost)}
          onFocus={e => e.target.select()}
          className={`text-sm h-8 w-24 bg-background text-foreground border ${missingCost ? 'border-red-300 bg-red-50' : 'border-border'}`}
        />
      </TableCell>
      <TableCell className="text-sm text-right">{(qty * unitCost).toFixed(2)}</TableCell>
      <TableCell>
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
      </TableCell>
    </TableRow>
  );
};

export default QuoteClusterLineRow;
