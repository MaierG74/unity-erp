'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { POAttachment, uploadPOAttachment, deletePOAttachment } from '@/lib/db/purchase-order-attachments';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, X, FileText, Image as ImageIcon, FileSpreadsheet, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface POAttachmentManagerProps {
  purchaseOrderId: number;
  attachments: POAttachment[];
  onAttachmentsChange: (attachments: POAttachment[]) => void;
  disabled?: boolean;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return FileText;
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return FileSpreadsheet;
  return FileText;
}

export default function POAttachmentManager({
  purchaseOrderId,
  attachments,
  onAttachmentsChange,
  disabled = false,
}: POAttachmentManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (disabled) return;
      setUploading(true);
      try {
        const newAttachments: POAttachment[] = [];
        for (const file of acceptedFiles) {
          const att = await uploadPOAttachment(file, purchaseOrderId);
          newAttachments.push(att);
        }
        onAttachmentsChange([...attachments, ...newAttachments]);
        toast.success(
          newAttachments.length === 1
            ? 'File uploaded'
            : `${newAttachments.length} files uploaded`
        );
      } catch (error) {
        console.error('Upload failed:', error);
        toast.error('Failed to upload file');
      } finally {
        setUploading(false);
      }
    },
    [purchaseOrderId, attachments, onAttachmentsChange, disabled]
  );

  const handleDelete = async (att: POAttachment) => {
    setDeletingId(att.id);
    try {
      await deletePOAttachment(att.id, att.file_url);
      onAttachmentsChange(attachments.filter((a) => a.id !== att.id));
      toast.success('Attachment deleted');
    } catch (error) {
      console.error('Delete failed:', error);
      toast.error('Failed to delete attachment');
    } finally {
      setDeletingId(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: disabled || uploading,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
    },
    multiple: true,
    maxSize: 10 * 1024 * 1024, // 10MB per file
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Attachments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* File list */}
        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map((att) => {
              const Icon = getFileIcon(att.mime_type);
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <a
                    href={att.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate hover:underline"
                  >
                    {att.original_name || 'Attachment'}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(att.file_size)}
                  </span>
                  {!disabled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      disabled={deletingId === att.id}
                      onClick={() => handleDelete(att)}
                    >
                      {deletingId === att.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dropzone */}
        {!disabled && (
          <div
            {...getRootProps()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors',
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50',
              uploading && 'pointer-events-none opacity-50'
            )}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <>
                <Loader2 className="mb-2 h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Uploading...</p>
              </>
            ) : isDragActive ? (
              <>
                <Upload className="mb-2 h-6 w-6 text-primary" />
                <p className="text-sm text-primary">Drop files here</p>
              </>
            ) : (
              <>
                <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drag & drop files here, or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, images, Word, Excel (max 10MB each)
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
