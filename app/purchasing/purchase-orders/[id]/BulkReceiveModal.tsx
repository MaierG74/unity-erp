'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Loader2, Download, Mail, AlertTriangle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import { ReturnGoodsPDFDownload } from '@/components/features/purchasing/ReturnGoodsPDFDownload';
import { useQuery } from '@tanstack/react-query';

// Helper to format company info
const getCompanyInfo = (settings: any) => {
    if (!settings) return undefined;

    const addressParts = [
        settings.address_line1,
        settings.address_line2,
        [settings.city, settings.postal_code].filter(Boolean).join(' ').trim(),
        settings.country,
    ].filter((part: any) => part && part.length > 0);

    return {
        name: settings.company_name,
        address: addressParts.join('\n'),
        phone: settings.phone,
        email: settings.email,
    };
};

// Schema for a single line item
const lineItemSchema = z.object({
    order_id: z.number(),
    component_code: z.string(),
    component_description: z.string(),
    remaining_quantity: z.number(),
    quantity_received: z.number().min(0).optional(),
    quantity_rejected: z.number().min(0).optional(),
    rejection_reason: z.string().optional(),
    notes: z.string().optional(),
}).refine((data) => {
    // If rejected > 0, reason is required
    if ((data.quantity_rejected || 0) > 0 && (!data.rejection_reason || data.rejection_reason.trim() === '')) {
        return false;
    }
    return true;
}, {
    message: 'Reason required',
    path: ['rejection_reason'],
}).refine((data) => {
    // Total cannot exceed remaining
    const total = (data.quantity_received || 0) + (data.quantity_rejected || 0);
    return total <= data.remaining_quantity;
}, {
    message: 'Exceeds remaining',
    path: ['quantity_received'],
});

// Main form schema
const bulkReceiveSchema = z.object({
    receipt_date: z.string(),
    items: z.array(lineItemSchema),
}).refine((data) => {
    // Must receive or reject at least one item across all lines
    const totalProcessed = data.items.reduce((sum, item) =>
        sum + (item.quantity_received || 0) + (item.quantity_rejected || 0), 0);
    return totalProcessed > 0;
}, {
    message: 'You must receive or reject at least one item',
    path: ['items'], // This might need to be handled carefully in UI
});

type BulkReceiveFormValues = z.infer<typeof bulkReceiveSchema>;

interface BulkReceiveModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    supplierOrders: any[]; // Using any[] for now to match the complex type from page.tsx
    purchaseOrderNumber: string;
    purchaseOrderId: number;
    supplierName: string;
    onSuccess: () => void;
}

export function BulkReceiveModal({
    open,
    onOpenChange,
    supplierOrders,
    purchaseOrderNumber,
    purchaseOrderId,
    supplierName,
    onSuccess,
}: BulkReceiveModalProps) {
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successData, setSuccessData] = useState<{
        processedCount: number;
        rejectionCount: number;
        grn?: string;
        returnItems?: any[];
    } | null>(null);

    // Filter only open orders
    const openOrders = supplierOrders.filter(
        (order) => (order.order_quantity - (order.total_received || 0)) > 0
    );
    const openOrdersMissingComponent = openOrders.filter(
        (order) => !order?.supplier_component?.component
    );

    // Fetch company settings
    const { data: companySettings } = useQuery({
        queryKey: ['companySettings'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('quote_company_settings')
                .select('*')
                .limit(1)
                .single();

            if (error) {
                console.error('Error fetching company settings:', error);
                return null;
            }
            return data;
        },
    });

    const {
        register,
        control,
        handleSubmit,
        formState: { errors },
        reset,
        watch,
    } = useForm<BulkReceiveFormValues>({
        resolver: zodResolver(bulkReceiveSchema),
        defaultValues: {
            receipt_date: format(new Date(), 'yyyy-MM-dd'),
            items: openOrders.map((order) => {
                const component = order?.supplier_component?.component;
                const component_code =
                    component?.internal_code ??
                    order?.supplier_component?.supplier_code ??
                    'Unknown';
                const component_description = component?.description ?? '';

                return {
                    order_id: order.order_id,
                    component_code,
                    component_description,
                    remaining_quantity: order.order_quantity - (order.total_received || 0),
                    quantity_received: 0,
                    quantity_rejected: 0,
                    rejection_reason: '',
                    notes: '',
                };
            }),
        },
    });

    const { fields } = useFieldArray({
        control,
        name: 'items',
    });

    const onSubmit = async (data: BulkReceiveFormValues) => {
        setSubmissionError(null);
        setIsSubmitting(true);

        try {
            const receiptTimestamp = data.receipt_date || new Date().toISOString();
            const itemsToProcess = data.items.filter(
                (item) => (item.quantity_received || 0) > 0 || (item.quantity_rejected || 0) > 0
            );

            if (itemsToProcess.length === 0) {
                throw new Error('No items to process');
            }

            const returnItems: any[] = [];
            let generatedGrn: string | undefined;

            // Process each item sequentially to avoid race conditions or overwhelming the DB
            for (const item of itemsToProcess) {
                // 1. Process Receipt
                if ((item.quantity_received || 0) > 0) {
                    const { error: receiptError } = await supabase.rpc(
                        'process_supplier_order_receipt',
                        {
                            p_order_id: item.order_id,
                            p_quantity: item.quantity_received,
                            p_receipt_date: receiptTimestamp,
                        }
                    );

                    if (receiptError) {
                        throw new Error(`Failed to receive ${item.component_code}: ${receiptError.message}`);
                    }
                }

                // 2. Process Rejection
                if ((item.quantity_rejected || 0) > 0) {
                    const { data: returnData, error: returnError } = await supabase.rpc(
                        'process_supplier_order_return',
                        {
                            p_supplier_order_id: item.order_id,
                            p_quantity: item.quantity_rejected,
                            p_reason: item.rejection_reason,
                            p_return_type: 'rejection',
                            p_return_date: receiptTimestamp,
                            p_notes: item.notes || null,
                        }
                    );

                    if (returnError) {
                        throw new Error(`Failed to reject ${item.component_code}: ${returnError.message}`);
                    }

                    if (returnData && Array.isArray(returnData) && returnData.length > 0) {
                        generatedGrn = returnData[0].goods_return_number; // Will be same for same transaction batch usually, or last one
                        returnItems.push({
                            component_code: item.component_code,
                            component_name: item.component_description,
                            quantity_returned: item.quantity_rejected,
                            reason: item.rejection_reason,
                            return_type: 'rejection',
                        });
                    }
                }
            }

            setSuccessData({
                processedCount: itemsToProcess.length,
                rejectionCount: returnItems.length,
                grn: generatedGrn,
                returnItems: returnItems.length > 0 ? returnItems : undefined,
            });

            onSuccess(); // Refresh parent data
        } catch (error) {
            console.error('Error processing bulk receipt:', error);
            setSubmissionError(error instanceof Error ? error.message : 'Failed to process items');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        reset();
        setSubmissionError(null);
        setSuccessData(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !val && handleClose()}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Bulk Receive Items</DialogTitle>
                    <DialogDescription>
                        Receive or reject multiple items for PO #{purchaseOrderNumber}
                    </DialogDescription>
                </DialogHeader>

                {!successData ? (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                        {submissionError && (
                            <Alert variant="destructive">
                                <AlertDescription>{submissionError}</AlertDescription>
                            </Alert>
                        )}

                        {errors.items?.root && (
                            <Alert variant="destructive">
                                <AlertDescription>{errors.items.root.message}</AlertDescription>
                            </Alert>
                        )}

                        {openOrdersMissingComponent.length > 0 && (
                            <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>
                                    {openOrdersMissingComponent.length} line item{openOrdersMissingComponent.length === 1 ? '' : 's'} {openOrdersMissingComponent.length === 1 ? 'is' : 'are'} missing component details (deleted or restricted by permissions). You can still process receipts, but some codes/descriptions may show as &quot;Unknown&quot;.
                                </AlertDescription>
                            </Alert>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="receipt_date">Receipt Date</Label>
                                <Input
                                    id="receipt_date"
                                    type="date"
                                    {...register('receipt_date')}
                                    className="max-w-xs"
                                />
                            </div>
                        </div>

                        <div className="border rounded-md overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[30%]">Component</TableHead>
                                        <TableHead className="w-[10%] text-right">Remaining</TableHead>
                                        <TableHead className="w-[15%]">Receive Qty</TableHead>
                                        <TableHead className="w-[15%]">Reject Qty</TableHead>
                                        <TableHead className="w-[30%]">Rejection Reason</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {fields.map((field, index) => {
                                        const remaining = field.remaining_quantity;
                                        const error = errors.items?.[index];

                                        return (
                                            <TableRow key={field.id}>
                                                <TableCell>
                                                    <div className="font-medium">{field.component_code}</div>
                                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                        {field.component_description}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {remaining}
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        max={remaining}
                                                        {...register(`items.${index}.quantity_received`, { valueAsNumber: true })}
                                                        className={error?.quantity_received ? 'border-destructive' : ''}
                                                        placeholder="0"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        {...register(`items.${index}.quantity_rejected`, { valueAsNumber: true })}
                                                        className={error?.quantity_rejected ? 'border-destructive' : ''}
                                                        placeholder="0"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        {...register(`items.${index}.rejection_reason`)}
                                                        className={error?.rejection_reason ? 'border-destructive' : ''}
                                                        placeholder={watch(`items.${index}.quantity_rejected`) ? "Required..." : "Optional"}
                                                        disabled={!watch(`items.${index}.quantity_rejected`)}
                                                    />
                                                    {error?.rejection_reason && (
                                                        <span className="text-[10px] text-destructive">{error.rejection_reason.message}</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={handleClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    'Process All Items'
                                )}
                            </Button>
                        </div>
                    </form>
                ) : (
                    <div className="space-y-6">
                        <div className="p-6 bg-green-50 border border-green-200 rounded-md text-center space-y-2">
                            <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2">
                                <Download className="h-6 w-6 text-green-600" />
                            </div>
                            <h3 className="text-lg font-medium text-green-900">Bulk Processing Complete</h3>
                            <p className="text-green-700">
                                Successfully processed {successData.processedCount} items.
                            </p>
                            {successData.rejectionCount > 0 && (
                                <p className="text-sm text-green-700">
                                    {successData.rejectionCount} items were rejected.
                                </p>
                            )}
                        </div>

                        {successData.returnItems && successData.grn && (
                            <div className="border rounded-md p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="font-medium">Goods Returned Note</h4>
                                        <p className="text-sm text-muted-foreground">
                                            GRN: {successData.grn}
                                        </p>
                                    </div>
                                    <ReturnGoodsPDFDownload
                                        goodsReturnNumber={successData.grn}
                                        purchaseOrderNumber={purchaseOrderNumber}
                                        purchaseOrderId={purchaseOrderId}
                                        returnDate={new Date().toISOString()}
                                        items={successData.returnItems}
                                        supplierInfo={{
                                            supplier_name: supplierName,
                                        }}
                                        companyInfo={getCompanyInfo(companySettings)}
                                        returnType="rejection"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end">
                            <Button onClick={handleClose}>Close</Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
