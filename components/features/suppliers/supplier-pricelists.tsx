'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadPricelist, deletePricelist } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierPricelist } from '@/types/suppliers';
import { FileUp, Trash2, X } from 'lucide-react';
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { FileIcon } from '@/components/ui/file-icon';
import { AttachmentPreviewModal } from '@/components/ui/attachment-preview-modal';

interface SupplierPricelistsProps {
  supplier: SupplierWithDetails;
}

export function SupplierPricelists({ supplier }: SupplierPricelistsProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedPricelistId, setSelectedPricelistId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async ({ file, displayName }: { file: File; displayName: string }) => {
      return uploadPricelist(supplier.supplier_id, file, displayName);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
      setIsUploading(false);
      setDisplayName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePricelist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const derivedName = displayName || file.name.replace(/\.[^/.]+$/, '');
    setDisplayName(derivedName);

    try {
      await uploadMutation.mutateAsync({ file, displayName: derivedName || file.name });
    } catch (error) {
      console.error('Failed to upload pricelist:', error);
    }
  };

  // Helper function to determine file type
  const getFileType = (pricelist: SupplierPricelist): 'pdf' | 'image' | 'other' => {
    const mime = (pricelist.file_type || '').toLowerCase();
    if (mime.startsWith('application/pdf')) return 'pdf';
    if (mime.startsWith('image/')) return 'image';

    const ext = (pricelist.file_name || '').split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image';
    return 'other';
  };

  // Convert pricelists to attachment format for the preview modal
  const attachmentsForModal = (supplier.pricelists || []).map(pricelist => ({
    attachment_id: pricelist.pricelist_id,
    file_name: pricelist.display_name || pricelist.file_name,
    file_url: pricelist.file_url,
    uploaded_at: pricelist.uploaded_at,
    file_type: pricelist.file_type,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Price Lists</h3>
        {!isUploading && (
          <button
            onClick={() => setIsUploading(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <FileUp className="h-4 w-4" />
            Upload Price List
          </button>
        )}
      </div>

      {isUploading && (
        <div className="p-4 border rounded-lg bg-card">
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
            />
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp"
              onChange={handleFileChange}
              className="hidden"
              id="pricelist-upload"
            />
            <label
              htmlFor="pricelist-upload"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <FileUp className="h-4 w-4" />
              Choose File
            </label>
            <button
              onClick={() => setIsUploading(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {supplier.pricelists?.map((pricelist) => {
          const fileType = getFileType(pricelist);
          const isPdf = fileType === 'pdf';
          const isImage = fileType === 'image';

          return (
            <div
              key={pricelist.pricelist_id}
              className="relative border rounded-lg bg-card hover:bg-muted/50 transition-colors group overflow-hidden"
            >
              {/* Thumbnail Container */}
              <div
                className="aspect-[3/4] relative overflow-hidden bg-muted/30"
              >
                {/* Content wrapper with pointer-events-none for PDF */}
                <div className={isPdf ? "pointer-events-none w-full h-full" : "w-full h-full"}>
                  {isPdf ? (
                    <PdfThumbnailClient
                      url={pricelist.file_url}
                      className="w-full h-full"
                    />
                  ) : isImage ? (
                    <div className="w-full h-full flex items-center justify-center p-2">
                      <img
                        src={pricelist.file_url}
                        alt={pricelist.display_name}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileIcon fileName={pricelist.file_name} size={64} className="text-primary" />
                    </div>
                  )}
                </div>

                {/* Clickable overlay that covers entire thumbnail */}
                <button
                  onClick={() => {
                    setSelectedPricelistId(pricelist.pricelist_id);
                    setIsPreviewOpen(true);
                  }}
                  className="absolute inset-0 cursor-pointer"
                  aria-label={`Preview ${pricelist.display_name}`}
                />

                {/* Overlay with file name */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pointer-events-none">
                  <p className="text-white text-sm font-medium truncate">
                    {pricelist.display_name}
                  </p>
                  <p className="text-white/80 text-xs">
                    {new Date(pricelist.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Delete Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate(pricelist);
                }}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground p-2 rounded-lg hover:bg-destructive/90 transition-all shadow-lg"
                title="Delete price list"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {(!supplier.pricelists || supplier.pricelists.length === 0) && !isUploading && (
        <div className="text-center p-8 border rounded-lg bg-muted/10">
          <p className="text-muted-foreground">No price lists uploaded yet.</p>
        </div>
      )}

      {/* Preview Modal */}
      <AttachmentPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setSelectedPricelistId(null);
        }}
        attachments={attachmentsForModal}
        orderNumber={`Supplier ${supplier.supplier_id}`}
        initialAttachmentId={selectedPricelistId}
      />
    </div>
  );
} 
