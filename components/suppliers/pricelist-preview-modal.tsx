'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, X } from 'lucide-react';
import type { SupplierPricelist } from '@/types/suppliers';

interface PricelistPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  pricelists: SupplierPricelist[];
  supplierName: string;
}

export function PricelistPreviewModal({ 
  isOpen, 
  onClose, 
  pricelists,
  supplierName 
}: PricelistPreviewModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>{supplierName} - Price Lists</DialogTitle>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {pricelists.map((pricelist) => (
            <div
              key={pricelist.pricelist_id}
              className="p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
            >
              <a
                href={pricelist.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3"
              >
                <div className="bg-primary/10 p-2 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium truncate">{pricelist.display_name}</h4>
                  <p className="text-sm text-muted-foreground">
                    {new Date(pricelist.uploaded_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground uppercase">
                    {pricelist.file_type}
                  </p>
                </div>
              </a>
            </div>
          ))}
        </div>

        {pricelists.length === 0 && (
          <div className="text-center p-8 border rounded-lg bg-muted/10">
            <p className="text-muted-foreground">No price lists available.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
} 