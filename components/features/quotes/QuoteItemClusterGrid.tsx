import React, { FC, useState } from 'react';
import { QuoteItemCluster, QuoteClusterLine, fetchProductComponents, formatCurrency } from '@/lib/db/quotes';
import QuoteClusterLineRow from './QuoteClusterLineRow';
import ComponentSelectionDialog from './ComponentSelectionDialog';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';

interface QuoteItemClusterGridProps {
  cluster: QuoteItemCluster;
  onUpdateLine: (id: string, updates: Partial<QuoteClusterLine>) => void;
  onAddLine: (clusterId: string, component: {
    type: 'manual' | 'database' | 'product' | 'collection';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
    product_id?: number;
    explode?: boolean;
    include_labour?: boolean;
    collection_id?: number;
  }) => void;
  onDeleteLine: (id: string) => void;
  onUpdateCluster: (clusterId: string, updates: Partial<QuoteItemCluster>) => void;
  onUpdateItemPrice?: (itemId: string, price: number) => void;
  itemId?: string;
}

const QuoteItemClusterGrid: FC<QuoteItemClusterGridProps> = ({ 
  cluster, 
  onUpdateLine, 
  onAddLine, 
  onDeleteLine, 
  onUpdateCluster,
  onUpdateItemPrice,
  itemId
}) => {
  const [showComponentDialog, setShowComponentDialog] = useState(false);
  const [markupType, setMarkupType] = useState<'percentage' | 'fixed'>('percentage');
  const [localMarkupValue, setLocalMarkupValue] = useState<string>(String(cluster.markup_percent || 0));
  
  // Update local state when cluster markup changes from external source
  React.useEffect(() => {
    setLocalMarkupValue(String(cluster.markup_percent || 0));
  }, [cluster.markup_percent]);
  
  const sortedLines = React.useMemo(() => {
    if (!Array.isArray(cluster.quote_cluster_lines)) return [] as QuoteClusterLine[];
    return [...cluster.quote_cluster_lines].sort((a, b) => {
      const orderA = a.sort_order ?? 0;
      const orderB = b.sort_order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeA - timeB;
    });
  }, [cluster.quote_cluster_lines]);

  // Calculate subtotal from all cluster lines
  const subtotal = sortedLines.reduce((sum, line) => {
    const lineTotal = (line.qty || 0) * (line.unit_cost || 0);
    return sum + lineTotal;
  }, 0) || 0;
  
  // Calculate markup amount using local value for immediate UI feedback
  const markupAmount = markupType === 'percentage' 
    ? (subtotal * (Number(localMarkupValue) || 0) / 100)
    : (Number(localMarkupValue) || 0); // When fixed, we store the fixed amount in markup_percent field
  
  // Calculate total with markup
  const totalWithMarkup = subtotal + markupAmount;

  const handleAddComponent = (component: {
    type: 'manual' | 'database' | 'product';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
    product_id?: number;
    explode?: boolean;
  }) => {
    onAddLine(cluster.id, component);
  };
  
  const handleMarkupChange = (value: string) => {
    setLocalMarkupValue(value);
  };
  
  const handleMarkupBlur = () => {
    const numValue = parseFloat(localMarkupValue) || 0;
    // Only save to database if value actually changed
    if (numValue !== cluster.markup_percent) {
      onUpdateCluster(cluster.id, { markup_percent: numValue });
    }
    setLocalMarkupValue(String(numValue));
  };
  
  const handleMarkupTypeChange = (type: 'percentage' | 'fixed') => {
    setMarkupType(type);
    // Reset markup to 0 when changing type to avoid confusion
    setLocalMarkupValue('0');
    onUpdateCluster(cluster.id, { markup_percent: 0 });
  };

  return (
    <div className="p-2 bg-muted/30 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-sm text-foreground">{cluster.name} - Costing Details</h4>
        <Button 
          onClick={() => setShowComponentDialog(true)}
          size="sm"
          variant="outline"
        >
          Add Line
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[80px] text-xs text-muted-foreground">Type</TableHead>
              <TableHead className="text-xs text-muted-foreground">Description</TableHead>
              <TableHead className="w-[80px] text-xs text-muted-foreground">Qty</TableHead>
              <TableHead className="w-[100px] text-xs text-muted-foreground">Unit Cost</TableHead>
              <TableHead className="w-[100px] text-xs text-right text-muted-foreground">Total</TableHead>
              <TableHead className="w-[80px] text-xs text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLines.map(line => (
              <QuoteClusterLineRow 
                key={line.id} 
                line={line} 
                onUpdate={onUpdateLine} 
                onDelete={onDeleteLine} 
              />
            ))}
            
            {/* Inline Add Line Row */}
            <TableRow className="bg-gray-25 hover:bg-gray-50">
              <TableCell colSpan={6} className="text-center py-2">
                <Button 
                  onClick={() => setShowComponentDialog(true)}
                  size="sm"
                  variant="ghost"
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus size={14} />
                  Add Line
                </Button>
              </TableCell>
            </TableRow>
            
            {/* Subtotal Row */}
            <TableRow className="bg-muted/30 border-t border-border">
              <TableHead className="text-xs font-semibold text-foreground" colSpan={4}>Subtotal</TableHead>
              <TableHead className="text-xs font-semibold text-right text-foreground">{formatCurrency(subtotal)}</TableHead>
              <TableHead></TableHead>
            </TableRow>
            
            {/* Markup Row */}
            <TableRow className="bg-muted/30">
              <TableHead className="text-xs font-semibold text-foreground" colSpan={3}>Markup</TableHead>
              <TableHead className="text-xs font-semibold text-foreground">
                <div className="flex items-center gap-2">
                  <span>Markup</span>
                  <Select value={markupType} onValueChange={handleMarkupTypeChange}>
                    <SelectTrigger className="w-24 h-6 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">%</SelectItem>
                      <SelectItem value="fixed">R</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input 
                    type="number" 
                    value={localMarkupValue}
                    onChange={(e) => handleMarkupChange(e.target.value)}
                    onBlur={handleMarkupBlur}
                    onFocus={(e) => e.target.select()}
                    className="w-20 h-6 text-xs bg-background text-foreground border-border"
                    step="0.01"
                  />
                </div>
              </TableHead>
              <TableHead className="text-xs font-semibold text-right text-foreground">{formatCurrency(markupAmount)}</TableHead>
              <TableHead></TableHead>
            </TableRow>
            
            {/* Total Row */}
            <TableRow className="bg-primary/10 border-t-2 border-primary/20">
              <TableHead className="text-sm font-bold text-foreground" colSpan={4}>Total</TableHead>
              <TableHead className="text-sm font-bold text-right text-foreground">{formatCurrency(totalWithMarkup)}</TableHead>
              <TableHead>
                {onUpdateItemPrice && itemId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onUpdateItemPrice(itemId, Math.round(totalWithMarkup * 100) / 100)}
                    className="text-xs h-6 px-2"
                    title="Update line item price with this total"
                  >
                    Update Price
                  </Button>
                )}
              </TableHead>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      
      {/* Bottom Add Button */}
      <div className="mt-3 flex justify-center">
        <Button 
          onClick={() => setShowComponentDialog(true)}
          size="sm"
          variant="outline"
          className="flex items-center gap-2 text-xs"
        >
          <Plus size={14} />
          Add Line
        </Button>
      </div>
      
      <ComponentSelectionDialog
        open={showComponentDialog}
        onClose={() => setShowComponentDialog(false)}
        onAddComponent={handleAddComponent}
      />
    </div>
  );
};

export default QuoteItemClusterGrid;
