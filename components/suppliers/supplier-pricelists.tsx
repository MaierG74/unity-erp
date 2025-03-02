'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadPricelist, deletePricelist } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierPricelist } from '@/types/suppliers';
import { FileUp, Trash2, FileText, X } from 'lucide-react';

interface SupplierPricelistsProps {
  supplier: SupplierWithDetails;
}

export function SupplierPricelists({ supplier }: SupplierPricelistsProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [displayName, setDisplayName] = useState('');
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

    if (!displayName) {
      // Use file name without extension as default display name
      setDisplayName(file.name.split('.').slice(0, -1).join('.'));
    }

    try {
      await uploadMutation.mutateAsync({ file, displayName: displayName || file.name });
    } catch (error) {
      console.error('Failed to upload pricelist:', error);
    }
  };

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
              accept=".pdf,.doc,.docx,.xls,.xlsx"
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
        {supplier.pricelists?.map((pricelist) => (
          <div
            key={pricelist.pricelist_id}
            className="p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
          >
            <div className="flex items-start justify-between">
              <a
                href={pricelist.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 flex-1 min-w-0"
              >
                <div className="bg-primary/10 p-2 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium truncate">{pricelist.display_name}</h4>
                  <p className="text-sm text-muted-foreground">
                    {new Date(pricelist.uploaded_at).toLocaleDateString()}
                  </p>
                </div>
              </a>
              <button
                onClick={() => deleteMutation.mutate(pricelist)}
                className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/90 transition-opacity"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {(!supplier.pricelists || supplier.pricelists.length === 0) && !isUploading && (
        <div className="text-center p-8 border rounded-lg bg-muted/10">
          <p className="text-muted-foreground">No price lists uploaded yet.</p>
        </div>
      )}
    </div>
  );
} 