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
import { Loader2, Mail, CheckCircle, XCircle } from 'lucide-react';

type AffectedOrder = {
    order_id: number;
    order_number: string;
    quantity_required: number;
    status: string;
    order_date: string;
};

type LineItemResponse = {
    po_number: string;
    supplier_code: string;
    description: string;
    quantity_ordered: number;
    order_date: string;
    item_status?: string;
    item_expected_date?: string;
    item_notes?: string;
};

type FollowUpEmail = {
    id: number;
    supplier_name: string;
    sent_at: string;
    status: string;
    po_numbers: string[];
    error_message: string | null;
    response?: {
        status: string | null;
        expected_delivery_date: string | null;
        notes: string | null;
        responded_at: string | null;
        line_item_responses: LineItemResponse[] | null;
    };
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

    // Fetch follow-up email history with responses
    const { data: followUpEmails = [] } = useQuery({
        queryKey: ['inventory', 'component-follow-ups', componentId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('component_follow_up_emails')
                .select(`
                    id, supplier_name, sent_at, status, po_numbers, error_message,
                    response:supplier_follow_up_responses(
                        status,
                        expected_delivery_date,
                        notes,
                        responded_at,
                        line_item_responses
                    )
                `)
                .eq('component_id', componentId)
                .order('sent_at', { ascending: false })
                .limit(5);

            if (error) throw error;
            
            // Normalize response data (Supabase returns array for 1-to-many)
            return (data || []).map((email: any) => ({
                ...email,
                response: Array.isArray(email.response) ? email.response[0] : email.response
            })) as FollowUpEmail[];
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
        <div className="space-y-4">
            {/* Affected Orders */}
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

            {/* Follow-up Email History */}
            {followUpEmails.length > 0 && (
                <div className="rounded-md border bg-blue-50/50 p-4">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Mail className="h-4 w-4 text-blue-600" />
                        Follow-up Email History
                    </h4>
                    <div className="space-y-3">
                        {followUpEmails.map((email) => (
                            <div
                                key={email.id}
                                className="bg-card rounded-md px-3 py-2 border"
                            >
                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2">
                                        {email.status === 'sent' ? (
                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                        ) : (
                                            <XCircle className="h-4 w-4 text-red-600" />
                                        )}
                                        <span className="font-medium">{email.supplier_name}</span>
                                        {email.po_numbers && email.po_numbers.length > 0 && (
                                            <span className="text-muted-foreground">
                                                ({email.po_numbers.join(', ')})
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-muted-foreground text-xs">
                                        {format(new Date(email.sent_at), "MMM d, yyyy 'at' h:mm a")}
                                    </div>
                                </div>
                                
                                {/* Supplier Response */}
                                {email.response?.responded_at && (
                                    <div className="mt-2 pt-2 border-t bg-green-500/10 -mx-3 -mb-2 px-3 py-2 rounded-b-md">
                                        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 mb-2">
                                            <CheckCircle className="h-3 w-3" />
                                            <span className="font-medium">Supplier Response</span>
                                            <span className="text-green-600">
                                                {format(new Date(email.response.responded_at), "MMM d 'at' h:mm a")}
                                            </span>
                                        </div>
                                        
                                        {/* Per-item responses */}
                                        {email.response.line_item_responses && email.response.line_item_responses.length > 0 ? (
                                            <div className="space-y-2">
                                                {email.response.line_item_responses.map((item, idx) => (
                                                    <div key={idx} className="bg-card/60 rounded p-2 text-xs border border-green-500/30">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="font-medium text-foreground">
                                                                {item.po_number} • {item.supplier_code}
                                                            </span>
                                                            <span className="font-medium">
                                                                {item.item_status === 'on_track' ? '✅ On Track' :
                                                                 item.item_status === 'shipped' ? '📦 Shipped' :
                                                                 item.item_status === 'delayed' ? '⏳ Delayed' :
                                                                 item.item_status === 'issue' ? '⚠️ Issue' :
                                                                 item.item_status || '✅ On Track'}
                                                            </span>
                                                        </div>
                                                        <div className="text-muted-foreground space-y-0.5">
                                                            {item.item_expected_date && (
                                                                <p>
                                                                    <span className="text-muted-foreground">Expected:</span>{' '}
                                                                    <span className="font-medium">
                                                                        {format(new Date(item.item_expected_date), "MMM d, yyyy")}
                                                                    </span>
                                                                </p>
                                                            )}
                                                            {item.item_notes && (
                                                                <p className="italic text-muted-foreground">&ldquo;{item.item_notes}&rdquo;</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            // Fallback to overall status if no per-item responses
                                            <div className="text-xs space-y-0.5">
                                                <p>
                                                    <span className="text-muted-foreground">Status:</span>{' '}
                                                    <span className="font-medium">
                                                        {email.response.status === 'on_track' ? '✅ On Track' :
                                                         email.response.status === 'shipped' ? '📦 Shipped' :
                                                         email.response.status === 'delayed' ? '⏳ Delayed' :
                                                         email.response.status === 'issue' ? '⚠️ Issue' :
                                                         email.response.status}
                                                    </span>
                                                </p>
                                                {email.response.expected_delivery_date && (
                                                    <p>
                                                        <span className="text-muted-foreground">Expected:</span>{' '}
                                                        <span className="font-medium">
                                                            {format(new Date(email.response.expected_delivery_date), "MMM d, yyyy")}
                                                        </span>
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* Global notes */}
                                        {email.response.notes && (
                                            <p className="mt-2 pt-2 border-t border-green-500/30 text-xs text-muted-foreground italic">
                                                &ldquo;{email.response.notes}&rdquo;
                                            </p>
                                        )}
                                    </div>
                                )}
                                
                                {/* Awaiting Response indicator */}
                                {email.status === 'sent' && !email.response?.responded_at && (
                                    <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                                        <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
                                        Awaiting supplier response
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
