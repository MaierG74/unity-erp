import { Info, ArrowDown, ChevronDown } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { type ComponentRequirement } from '@/types/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function RequirementTooltip({ breakdown }: { breakdown: { order_id: number; quantity: number; order_date: string; status: string; }[] }) {
  return (
    <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
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
    <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
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

function CoveredByOrdersTooltip() {
  return (
    <div className="p-3 max-w-sm bg-card rounded-md shadow-sm">
      <p className="text-sm">This apparent shortfall is covered by existing supplier orders.</p>
    </div>
  );
}

export function ComponentRequirementsTable({ requirements }: { requirements: ComponentRequirement[] }) {
  // Count total components and those with shortfalls
  const totalComponents = requirements.length;
  const componentsWithShortfalls = requirements.filter(req => req.real_shortfall > 0).length;

  return (
    <Card className="shadow-sm border border-muted/40 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle>Component Requirements</CardTitle>
          <div className="text-sm text-muted-foreground">
            {totalComponents} component types {componentsWithShortfalls > 0 && 
              <span className="text-red-500">({componentsWithShortfalls} with shortfalls)</span>
            }
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Components needed to fulfill this order</p>
      </CardHeader>
      <CardContent>
        <Table className="border rounded-md">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead className="text-right">Required</TableHead>
              <TableHead className="text-right">In Stock</TableHead>
              <TableHead className="text-right">On Order</TableHead>
              <TableHead className="text-right">Apparent Shortfall</TableHead>
              <TableHead className="text-right">Real Shortfall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requirements.map((req, index) => (
              <TableRow 
                key={req.component_id}
                className={cn(
                  index % 2 === 0 ? "bg-white" : "bg-muted/20",
                  "hover:bg-muted/30 transition-all duration-200 ease-in-out"
                )}
              >
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
                        {req.quantity_required}
                        <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="p-0">
                      <RequirementTooltip breakdown={req.order_breakdown} />
                    </PopoverContent>
                  </Popover>
                </TableCell>
                <TableCell className="text-right font-medium">{req.quantity_in_stock}</TableCell>
                <TableCell className="text-right">
                  {req.quantity_on_order > 0 ? (
                    <Popover>
                      <PopoverTrigger>
                        <div className="cursor-help inline-flex items-center">
                          {req.quantity_on_order}
                          <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="p-0">
                        <OnOrderTooltip breakdown={req.on_order_breakdown} />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    req.quantity_on_order
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className={cn(
                    req.apparent_shortfall > 0 ? "text-orange-600" : "text-green-600",
                    "font-medium"
                  )}>
                    {req.apparent_shortfall}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {req.real_shortfall === 0 && req.apparent_shortfall > 0 ? (
                    <Popover>
                      <PopoverTrigger>
                        <div className="cursor-help inline-flex items-center">
                          <span className="text-green-600 font-medium">{req.real_shortfall}</span>
                          <Info className="h-4 w-4 ml-1 text-blue-500 hover:text-blue-600" />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="p-0">
                        <CoveredByOrdersTooltip />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <span className={cn(
                      req.real_shortfall > 0 ? "text-red-600" : "text-green-600",
                      "font-medium"
                    )}>
                      {req.real_shortfall}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
} 
