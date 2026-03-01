'use client';

import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { JobCardsTab } from './JobCardsTab';

interface JobCardsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderNumber: string | null;
}

export function JobCardsModal({
  open,
  onOpenChange,
  orderId,
  orderNumber,
}: JobCardsModalProps) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl flex flex-col [&>div:first-child]:flex [&>div:first-child]:flex-col [&>div:first-child]:max-h-[80vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Job Cards &mdash; {orderNumber ?? 'Order'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          <JobCardsTab orderId={orderId} />
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              router.push(`/orders/${orderId}?tab=job-cards`);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-2" />
            Open Full Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
