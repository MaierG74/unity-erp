import { Info, ChevronRight } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { type ComponentRequirement } from '@/types/components';

function RequirementTooltip({ breakdown }: { breakdown: { order_id: number; quantity: number; order_date: string; status: string; }[] }) {
  return (
    <div className="p-2 max-w-sm">
      <p className="font-semibold mb-2">Order Breakdown:</p>
      <ul className="space-y-1">
        {breakdown.map((order) => (
          <li key={order.order_id} className="text-sm">
            Order #{order.order_id}: {order.quantity} units ({order.status})
            <br />
            <span className="text-xs text-muted-foreground">
              {new Date(order.order_date).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OnOrderTooltip({ breakdown }: { breakdown: { supplier_order_id: number; supplier_name: string; quantity: number; received: number; status: string; order_date: string; }[] }) {
  return (
    <div className="p-2 max-w-sm">
      <p className="font-semibold mb-2">Supplier Orders:</p>
      <ul className="space-y-2">
        {breakdown.map((order) => (
          <li key={order.supplier_order_id} className="text-sm">
            <div className="flex justify-between">
              <span>PO #{order.supplier_order_id}</span>
              <span>{order.status}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {order.supplier_name}
            </div>
            <div className="text-xs">
              Ordered: {order.quantity} | Received: {order.received}
              <br />
              {new Date(order.order_date).toLocaleDateString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComponentRequirementsTable({ requirements }: { requirements: ComponentRequirement[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          <TableHead className="text-right">Required</TableHead>
          <TableHead className="text-right">In Stock</TableHead>
          <TableHead className="text-right">On Order</TableHead>
          <TableHead className="text-right">Apparent Shortfall</TableHead>
          <TableHead className="text-right">Real Shortfall</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requirements.map((req) => (
          <TableRow key={req.component_id}>
            <TableCell>
              <div>
                <p className="font-medium">{req.internal_code}</p>
                <p className="text-sm text-muted-foreground">{req.description}</p>
              </div>
            </TableCell>
            <TableCell className="text-right">
              <Popover>
                <PopoverTrigger>
                  <div className="cursor-help inline-flex items-center">
                    {req.total_required}
                    <Info className="h-4 w-4 ml-1 text-muted-foreground" />
                  </div>
                </PopoverTrigger>
                <PopoverContent>
                  <RequirementTooltip breakdown={req.order_breakdown} />
                </PopoverContent>
              </Popover>
            </TableCell>
            <TableCell className="text-right">{req.in_stock}</TableCell>
            <TableCell className="text-right">
              {req.on_order > 0 ? (
                <Popover>
                  <PopoverTrigger>
                    <div className="cursor-help inline-flex items-center">
                      {req.on_order}
                      <Info className="h-4 w-4 ml-1 text-muted-foreground" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent>
                    <OnOrderTooltip breakdown={req.on_order_breakdown} />
                  </PopoverContent>
                </Popover>
              ) : (
                req.on_order
              )}
            </TableCell>
            <TableCell className="text-right">
              <span className={cn(
                req.apparent_shortfall > 0 ? "text-orange-600" : "text-green-600"
              )}>
                {req.apparent_shortfall}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <span className={cn(
                req.real_shortfall > 0 ? "text-red-600" : "text-green-600",
                "font-medium"
              )}>
                {req.real_shortfall}
                {req.real_shortfall === 0 && req.apparent_shortfall > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">(Covered by orders)</span>
                )}
              </span>
            </TableCell>
            <TableCell>
              <Button variant="ghost" size="sm">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
} 