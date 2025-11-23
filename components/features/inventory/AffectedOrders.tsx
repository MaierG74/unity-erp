import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

type AffectedOrder = {
    order_id: number;
    order_number: string;
    quantity_required: number;
    status: string;
    order_date: string;
};

interface AffectedOrdersProps {
    componentId: number;
}

export function AffectedOrders({ componentId }: AffectedOrdersProps) {
    const { data: orders = [], isLoading, error } = useQuery({
        queryKey: ['inventory', 'component-affected-orders', componentId],
        queryFn: async () => {
            const { data, error } = await supabase
                .rpc('get_component_affected_orders', { p_component_id: componentId });

            if (error) throw error;
            return data as AffectedOrder[];
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading affected orders...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-sm text-destructive py-2">
                Error loading orders: {(error as Error).message}
            </div>
        );
    }

    if (orders.length === 0) {
        return (
            <div className="text-sm text-muted-foreground py-2">
                No active orders found for this component.
            </div>
        );
    }

    return (
        <div className="rounded-md border bg-muted/50 p-4">
            <h4 className="text-sm font-medium mb-3">Affected Orders</h4>
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="h-8">Order #</TableHead>
                        <TableHead className="h-8">Date</TableHead>
                        <TableHead className="h-8">Status</TableHead>
                        <TableHead className="h-8 text-right">Required Qty</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {orders.map((order) => (
                        <TableRow key={order.order_id} className="hover:bg-muted/50">
                            <TableCell className="py-2 font-medium">
                                <a
                                    href={`/orders/${order.order_id}`}
                                    className="text-blue-600 hover:underline"
                                >
                                    {order.order_number}
                                </a>
                            </TableCell>
                            <TableCell className="py-2">
                                {format(new Date(order.order_date), 'MMM d, yyyy')}
                            </TableCell>
                            <TableCell className="py-2">
                                <Badge variant="outline" className="text-xs">
                                    {order.status}
                                </Badge>
                            </TableCell>
                            <TableCell className="py-2 text-right font-medium">
                                {order.quantity_required}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
