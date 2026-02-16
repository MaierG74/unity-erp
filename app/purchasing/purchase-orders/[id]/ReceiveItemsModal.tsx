'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Loader2, Download, Eye, Mail, X, CheckCircle2 } from 'lucide-react';
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
import { supabase } from '@/lib/supabase';
import { ReturnGoodsPDFDownload } from '@/components/features/purchasing/ReturnGoodsPDFDownload';
import DeliveryNoteUpload from '@/components/features/purchasing/DeliveryNoteUpload';
import { uploadPOAttachment } from '@/lib/db/purchase-order-attachments';
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

// Form validation schema
const receiveItemsSchema = z.object({
  quantity_received: z.number({
    required_error: 'Quantity received is required',
    invalid_type_error: 'Must be a number',
  }).min(0, 'Cannot be negative'),
  quantity_rejected: z.number({
    invalid_type_error: 'Must be a number',
  }).min(0, 'Cannot be negative').optional(),
  rejection_reason: z.string().optional(),
  receipt_date: z.string().optional(),
  notes: z.string().optional(),
}).refine(
  (data) => {
    // If quantity_rejected > 0, rejection_reason is required
    if ((data.quantity_rejected || 0) > 0 && (!data.rejection_reason || data.rejection_reason.trim() === '')) {
      return false;
    }
    return true;
  },
  {
    message: 'Rejection reason is required when rejecting items',
    path: ['rejection_reason'],
  }
).refine(
  (data) => {
    // Total must not exceed max available
    const total = (data.quantity_received || 0) + (data.quantity_rejected || 0);
    return total > 0;
  },
  {
    message: 'Must receive or reject at least one item',
    path: ['quantity_received'],
  }
);

type ReceiveItemsFormValues = z.infer<typeof receiveItemsSchema>;

interface ReceiveItemsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierOrder: {
    order_id: number;
    order_quantity: number;
    total_received: number | null;
    supplier_component: {
      supplier_code: string;
      component: {
        component_id: number;
        internal_code: string;
        description: string;
      } | null;
      supplier: {
        supplier_id: number;
        name: string;
      };
    };
    purchase_order: {
      purchase_order_id: number;
      q_number: string;
    };
  };
  onSuccess: () => void;
}

export function ReceiveItemsModal({
  open,
  onOpenChange,
  supplierOrder,
  onSuccess,
}: ReceiveItemsModalProps) {
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{
    grn?: string;
    returnId?: number;
    receivedQty: number;
    rejectedQty: number;
  } | null>(null);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'skipped' | 'error'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [deliveryNoteFile, setDeliveryNoteFile] = useState<File | null>(null);
  const [isUploadingNote, setIsUploadingNote] = useState(false);
  const [noteUploaded, setNoteUploaded] = useState(false);

  const component = supplierOrder?.supplier_component?.component;
  const componentCode =
    component?.internal_code ??
    supplierOrder?.supplier_component?.supplier_code ??
    'Unknown';
  const componentDescription = component?.description ?? '';
  const supplierName = supplierOrder?.supplier_component?.supplier?.name ?? 'Supplier';

  const remainingToReceive = Math.max(0, supplierOrder.order_quantity - (supplierOrder.total_received || 0));

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
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<ReceiveItemsFormValues>({
    resolver: zodResolver(receiveItemsSchema),
    defaultValues: {
      quantity_received: 0,
      quantity_rejected: 0,
      rejection_reason: undefined,
      receipt_date: format(new Date(), 'yyyy-MM-dd'),
      notes: undefined,
    },
  });

  const quantityReceived = watch('quantity_received') || 0;
  const quantityRejected = watch('quantity_rejected') || 0;
  const totalQuantity = quantityReceived + quantityRejected;
  const receiveTooHigh = quantityReceived > remainingToReceive;
  const hasQuantity = totalQuantity > 0;

  const onSubmit = async (data: ReceiveItemsFormValues) => {
    setSubmissionError(null);
    setIsSubmitting(true);

    try {
      const now = new Date();
      const todayString = format(now, 'yyyy-MM-dd');
      let receiptTimestamp: string;

      if (data.receipt_date === todayString) {
        // If the date is today, use the current full timestamp to preserve time
        receiptTimestamp = now.toISOString();
      } else {
        // If it's a different date, use that date (defaults to midnight UTC)
        receiptTimestamp = data.receipt_date ? new Date(data.receipt_date).toISOString() : now.toISOString();
      }
      let nextSuccessState: {
        grn?: string;
        returnId?: number;
        receivedQty: number;
        rejectedQty: number;
      } = {
        receivedQty: data.quantity_received || 0,
        rejectedQty: data.quantity_rejected || 0,
      };

      // Call the RPC function to process receipt when quantity is provided
      if ((data.quantity_received || 0) > 0) {
        const { error: receiptError } = await supabase.rpc(
          'process_supplier_order_receipt',
          {
            p_order_id: supplierOrder.order_id,
            p_quantity: data.quantity_received || 0,
            p_receipt_date: receiptTimestamp,
          }
        );

        if (receiptError) {
          throw new Error(`Failed to process receipt: ${receiptError.message}`);
        }
      }

      // If there are rejections, process them
      if ((data.quantity_rejected || 0) > 0 && data.rejection_reason) {
        const { data: returnData, error: returnError } = await supabase.rpc(
          'process_supplier_order_return',
          {
            p_supplier_order_id: supplierOrder.order_id,
            p_quantity: data.quantity_rejected,
            p_reason: data.rejection_reason,
            p_return_type: 'rejection',
            p_return_date: receiptTimestamp,
            p_notes: data.notes || null,
          }
        );

        if (returnError) {
          throw new Error(`Failed to process rejection: ${returnError.message}`);
        }

        // Extract GRN from return data
        if (returnData && Array.isArray(returnData) && returnData.length > 0) {
          nextSuccessState = {
            ...nextSuccessState,
            grn: returnData[0].goods_return_number,
            returnId: returnData[0].return_id,
          };
        }
      }

      // Upload delivery note if one was selected
      if (deliveryNoteFile) {
        setIsUploadingNote(true);
        try {
          // Get the latest receipt for this order to link the attachment
          const { data: latestReceipt } = await supabase
            .from('supplier_order_receipts')
            .select('receipt_id')
            .eq('order_id', supplierOrder.order_id)
            .order('receipt_id', { ascending: false })
            .limit(1)
            .single();

          await uploadPOAttachment(
            deliveryNoteFile,
            supplierOrder.purchase_order.purchase_order_id,
            {
              receiptId: latestReceipt?.receipt_id,
              attachmentType: 'delivery_note',
              notes: data.notes || undefined,
            }
          );
          setNoteUploaded(true);
        } catch (uploadErr) {
          console.error('Failed to upload delivery note:', uploadErr);
          // Don't fail the whole receipt — note the error but continue
        } finally {
          setIsUploadingNote(false);
        }
      }

      // Success! Don't close the modal yet, show success state
      setSuccessData(nextSuccessState);
      reset();
      onSuccess();
    } catch (error) {
      console.error('Error processing receipt:', error);
      setSubmissionError(error instanceof Error ? error.message : 'Failed to process receipt');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendEmail = async () => {
    if (!successData?.returnId) {
      setEmailError('No return ID available');
      return;
    }

    try {
      setEmailStatus('sending');
      setEmailError(null);

      const response = await fetch('/api/send-supplier-return-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnId: successData.returnId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      setEmailStatus('sent');
    } catch (error: any) {
      console.error('Error sending email:', error);
      setEmailStatus('error');
      setEmailError(error.message || 'Failed to send email');
    }
  };

  const handleSkipEmail = () => {
    setEmailStatus('skipped');
    setEmailError(null);
  };

  const handleClose = () => {
    reset();
    setSubmissionError(null);
    setSuccessData(null);
    setEmailStatus('idle');
    setEmailError(null);
    setDeliveryNoteFile(null);
    setNoteUploaded(false);
    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive Items</DialogTitle>
          <DialogDescription>
            Record delivery for {componentCode} - {componentDescription}
          </DialogDescription>
        </DialogHeader>

        {!successData ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {submissionError && (
              <Alert variant="destructive">
                <AlertDescription>{submissionError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="quantity_received">Quantity Received</Label>
                  <Input
                    id="quantity_received"
                    type="number"
                    min="0"
                    max={remainingToReceive}
                    {...register('quantity_received', { valueAsNumber: true })}
                    placeholder="0"
                  />
                  {errors.quantity_received && (
                    <p className="text-sm text-destructive mt-1">{errors.quantity_received.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="quantity_rejected">Quantity Rejected</Label>
                  <Input
                    id="quantity_rejected"
                    type="number"
                    min="0"
                    {...register('quantity_rejected', { valueAsNumber: true })}
                    placeholder="0"
                  />
                  {errors.quantity_rejected && (
                    <p className="text-sm text-destructive mt-1">{errors.quantity_rejected.message}</p>
                  )}
                </div>
              </div>

              {receiveTooHigh && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Quantity received ({quantityReceived}) exceeds remaining to receive ({remainingToReceive})
                  </AlertDescription>
                </Alert>
              )}

              {quantityRejected > 0 && (
                <div>
                  <Label htmlFor="rejection_reason">
                    Rejection Reason <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id="rejection_reason"
                    {...register('rejection_reason')}
                    className="w-full border border-gray-300 rounded-md p-2"
                  >
                    <option value="">Select reason...</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Wrong item">Wrong item</option>
                    <option value="Defective">Defective</option>
                    <option value="Quality issue">Quality issue</option>
                    <option value="Incomplete delivery">Incomplete delivery</option>
                    <option value="Not as described">Not as described</option>
                    <option value="Other">Other</option>
                  </select>
                  {errors.rejection_reason && (
                    <p className="text-sm text-destructive mt-1">{errors.rejection_reason.message}</p>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="receipt_date">Receipt Date</Label>
                <Input
                  id="receipt_date"
                  type="date"
                  {...register('receipt_date')}
                />
                {errors.receipt_date && (
                  <p className="text-sm text-destructive mt-1">{errors.receipt_date.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="notes">Notes (Optional)</Label>
                <textarea
                  id="notes"
                  {...register('notes')}
                  className="w-full border border-gray-300 rounded-md p-2"
                  rows={3}
                  placeholder="Additional notes about this delivery..."
                />
                {errors.notes && (
                  <p className="text-sm text-destructive mt-1">{errors.notes.message}</p>
                )}
              </div>

              <DeliveryNoteUpload
                onFileSelect={setDeliveryNoteFile}
                selectedFile={deliveryNoteFile}
                disabled={isSubmitting}
              />
            </div>

            <div className="flex justify-between items-center pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                <div>
                  Received: <span className="font-medium text-green-600">{quantityReceived}</span>
                </div>
                <div>
                  Rejected: <span className="font-medium text-red-600">{quantityRejected}</span>
                </div>
                <div>
                  Total: <span className="font-medium">{totalQuantity}</span> / {remainingToReceive} remaining
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || isUploadingNote || receiveTooHigh || !hasQuantity}
                >
                  {isSubmitting || isUploadingNote ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isUploadingNote ? 'Uploading note...' : 'Processing...'}
                    </>
                  ) : (
                    'Record Receipt'
                  )}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="p-4 bg-green-50 border border-green-200 rounded-md space-y-1">
              <div className="font-medium text-green-800">Receipt recorded successfully!</div>
              <div className="text-sm text-green-700 flex flex-col gap-0.5">
                <span>Received: <strong>{successData.receivedQty}</strong></span>
                {successData.rejectedQty > 0 && (
                  <span>Rejected: <strong>{successData.rejectedQty}</strong></span>
                )}
              </div>
              {successData.grn && (
                <div className="text-sm text-green-700">
                  Goods Return Number: <span className="font-mono font-bold">{successData.grn}</span>
                </div>
              )}
              {noteUploaded && (
                <div className="text-sm text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Delivery note attached
                </div>
              )}
            </div>

            {successData.grn && successData.returnId && (
              <>
                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Download Return Document</h4>
                  <ReturnGoodsPDFDownload
                    goodsReturnNumber={successData.grn}
                    purchaseOrderNumber={supplierOrder.purchase_order.q_number}
                    purchaseOrderId={supplierOrder.purchase_order.purchase_order_id}
                    returnDate={new Date().toISOString()}
                    items={[
                      {
                        component_code: componentCode,
                        component_name: componentDescription,
                        quantity_returned: successData.rejectedQty,
                        reason: 'Gate rejection',
                        return_type: 'rejection',
                      },
                    ]}
                    supplierInfo={{
                      supplier_name: supplierName,
                    }}
                    companyInfo={getCompanyInfo(companySettings)}
                    returnType="rejection"
                  />
                </div>

                <div className="space-y-3 border-t pt-4">
                  <h4 className="font-medium text-sm">Notify Supplier</h4>

                  {emailStatus === 'idle' && (
                    <div className="flex gap-2">
                      <Button onClick={handleSendEmail} size="sm">
                        <Mail className="mr-2 h-4 w-4" />
                        Send Email to Supplier
                      </Button>
                      <Button onClick={handleSkipEmail} variant="outline" size="sm">
                        Skip Email
                      </Button>
                    </div>
                  )}

                  {emailStatus === 'sending' && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Sending email notification...</span>
                    </div>
                  )}

                  {emailStatus === 'sent' && (
                    <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm">
                      Email notification sent successfully to supplier
                    </div>
                  )}

                  {emailStatus === 'skipped' && (
                    <div className="p-3 bg-gray-50 border border-gray-200 text-gray-700 rounded-md text-sm">
                      Email notification skipped
                    </div>
                  )}

                  {emailStatus === 'error' && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                      <p className="font-medium text-sm mb-1">Failed to send email</p>
                      <p className="text-sm">{emailError}</p>
                      <Button onClick={handleSendEmail} variant="outline" size="sm" className="mt-2">
                        Retry
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
