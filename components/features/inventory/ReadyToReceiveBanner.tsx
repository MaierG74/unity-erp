'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, PackageCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchDraftStockReceipt } from '@/lib/db/internalOrders';
import { ConfirmReceiptModal } from './ConfirmReceiptModal';
import { ManualReceiveModal, type ManualReceiveOrderDetail } from './ManualReceiveModal';

export interface ReadyToReceiveBannerProps {
  orderId: number;
  orgId: string;
  orderDetails: ManualReceiveOrderDetail[];
  onChanged?: () => void;
}

export function ReadyToReceiveBanner({
  orderId,
  orgId,
  orderDetails,
  onChanged,
}: ReadyToReceiveBannerProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const {
    data: draft,
    isLoading,
    refetch,
  } = useQuery({
    // orgId scopes the cache so switching tenants does not surface a stale draft.
    queryKey: ['internal-order', orgId, orderId, 'draft-stock-receipt'],
    queryFn: () => fetchDraftStockReceipt(orderId),
    enabled: Number.isFinite(orderId) && !!orgId,
    staleTime: 30 * 1000,
  });

  const draftItems = draft?.items ?? [];
  const hasDraft = !!draft && draftItems.length > 0;

  // Build a product_id → name map from the order details by joining via order_detail_id.
  const productNamesById = useMemo(() => {
    const nameByOrderDetail = new Map<number, string>(
      orderDetails.map((d) => [d.order_detail_id, d.product_name]),
    );
    const map: Record<number, string> = {};
    for (const item of draftItems) {
      const name = nameByOrderDetail.get(item.order_detail_id);
      if (name) map[item.product_id] = name;
    }
    return map;
  }, [orderDetails, draftItems]);

  const totals = useMemo(() => {
    const units = draftItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const products = new Set(draftItems.map((item) => item.product_id)).size;
    return { units, products };
  }, [draftItems]);

  function handleChanged() {
    void refetch();
    onChanged?.();
  }

  return (
    <>
      {hasDraft ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <PackageCheck className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">
                Ready to receive: {totals.units} item{totals.units === 1 ? '' : 's'} across {totals.products} product
                {totals.products === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-muted-foreground">
                Draft receipt {draft?.receipt_number} is armed and waiting to be checked in.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen(true)}>
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Receive manually
            </Button>
            <Button type="button" size="sm" onClick={() => setConfirmOpen(true)}>
              <PackageCheck className="mr-2 h-4 w-4" />
              Confirm receipt
            </Button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking for a ready receipt…
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">No receipt is currently armed for this order.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen(true)}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Receive manually
          </Button>
        </div>
      )}

      {draft && (
        <ConfirmReceiptModal
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          receipt={draft}
          productNamesById={productNamesById}
          onConfirmed={handleChanged}
        />
      )}

      <ManualReceiveModal
        open={manualOpen}
        onOpenChange={setManualOpen}
        orderId={orderId}
        orderDetails={orderDetails}
        onReceived={handleChanged}
      />
    </>
  );
}
