'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { format } from 'date-fns';
import { 
  fetchOrderAttachments, 
  uploadOrderAttachment, 
  deleteOrderAttachment 
} from '@/lib/db/orders';
import type { OrderAttachment } from '@/types/orders';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { 
  Upload, 
  X, 
  Image as ImageIcon, 
  FileText, 
  Download,
  Trash2,
  Loader2,
  File,
  FileSpreadsheet,
  FileArchive
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderDocumentsTabProps {
  orderId: number;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet;
  if (mimeType.includes('zip') || mimeType.includes('archive')) return FileArchive;
  return File;
}

function isImage(mimeType: string) {
  return mimeType.startsWith('image/');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrderDocumentsTab({ orderId }: OrderDocumentsTabProps) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<OrderAttachment | null>(null);

  // Fetch attachments
  const { data: attachments = [], isLoading, error } = useQuery({
    queryKey: ['orderAttachments', orderId],
    queryFn: () => fetchOrderAttachments(orderId),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteOrderAttachment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orderAttachments', orderId] });
      toast.success('Document deleted');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete document');
    },
  });

  // Handle file upload
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    setUploading(true);
    try {
      for (const file of acceptedFiles) {
        await uploadOrderAttachment(file, orderId);
      }
      queryClient.invalidateQueries({ queryKey: ['orderAttachments', orderId] });
      toast.success(`${acceptedFiles.length} file(s) uploaded successfully`);
    } catch (error: any) {
      console.error('Upload failed:', error);
      toast.error(error.message || 'Failed to upload files');
    } finally {
      setUploading(false);
    }
  }, [orderId, queryClient]);

  // Handle paste from clipboard
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (uploading) return;
    
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    
    if (files.length > 0) {
      e.preventDefault();
      await onDrop(files);
    }
  }, [onDrop, uploading]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
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
    noClick: true, // We'll handle click separately
  });

  const handleDelete = (attachment: OrderAttachment) => {
    if (confirm(`Delete "${attachment.file_name}"?`)) {
      deleteMutation.mutate(attachment.id);
    }
  };

  const handleDownload = (attachment: OrderAttachment) => {
    const a = document.createElement('a');
    a.href = attachment.file_url;
    a.download = attachment.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const openPreview = (attachment: OrderAttachment) => {
    if (isImage(attachment.mime_type)) {
      setPreviewAttachment(attachment);
      setPreviewOpen(true);
    } else {
      window.open(attachment.file_url, '_blank');
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load documents: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const imageCount = attachments.filter(a => isImage(a.mime_type)).length;
  const docCount = attachments.filter(a => !isImage(a.mime_type)).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Order Documents
          </CardTitle>
          <CardDescription>
            Upload and manage documents related to this order (contracts, drawings, specifications, etc.)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Upload Area */}
          <div
            {...getRootProps()}
            onPaste={handlePaste}
            tabIndex={0}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
              isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30",
              uploading && "opacity-50 pointer-events-none"
            )}
          >
            <input {...getInputProps()} disabled={uploading} />
            <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            {uploading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p className="text-sm text-muted-foreground">Uploading files...</p>
              </div>
            ) : isDragActive ? (
              <p className="text-sm font-medium text-primary">Drop files here...</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Drag & drop files here, or paste with <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border">Ctrl/Cmd+V</kbd>
                </p>
                <Button variant="outline" size="sm" type="button" onClick={open} disabled={uploading}>
                  Browse Files
                </Button>
                <p className="text-xs text-muted-foreground">
                  Supports images, PDFs, Word, Excel, and text files
                </p>
              </div>
            )}
          </div>

          {/* Documents List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : attachments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No documents uploaded yet</p>
              <p className="text-sm">Upload files using the area above</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">
                  Uploaded Documents ({attachments.length})
                </h4>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs">
                    {imageCount} Images
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {docCount} Documents
                  </Badge>
                </div>
              </div>
              
              <div className="grid gap-3">
                {attachments.map((attachment) => {
                  const FileIcon = getFileIcon(attachment.mime_type);
                  const isImg = isImage(attachment.mime_type);
                  
                  return (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-3 p-3 border rounded-lg bg-card hover:bg-muted/30 transition-colors group"
                    >
                      {/* Thumbnail / Icon */}
                      <div 
                        className="flex-shrink-0 cursor-pointer"
                        onClick={() => openPreview(attachment)}
                      >
                        {isImg ? (
                          <div className="relative">
                            <img
                              src={attachment.file_url}
                              alt={attachment.file_name}
                              className="w-14 h-14 object-cover rounded border"
                            />
                            <ImageIcon className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full p-0.5 shadow-sm" />
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded border bg-muted/50 flex items-center justify-center">
                            <FileIcon className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* File Info */}
                      <div className="flex-1 min-w-0">
                        <p 
                          className="font-medium truncate cursor-pointer hover:text-primary"
                          onClick={() => openPreview(attachment)}
                        >
                          {attachment.file_name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{attachment.mime_type.split('/')[1]?.toUpperCase() || 'FILE'}</span>
                          <span>•</span>
                          <span>{format(new Date(attachment.uploaded_at), 'MMM d, yyyy h:mm a')}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openPreview(attachment)}
                          title="View"
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(attachment)}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(attachment)}
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          title="Delete"
                        >
                          {deleteMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Image Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">
              {previewAttachment?.file_name}
            </DialogTitle>
          </DialogHeader>
          {previewAttachment && isImage(previewAttachment.mime_type) && (
            <div className="space-y-4">
              <div className="flex items-center justify-center bg-muted/30 rounded-lg p-4">
                <img
                  src={previewAttachment.file_url}
                  alt={previewAttachment.file_name}
                  className="max-h-[60vh] w-auto object-contain"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => window.open(previewAttachment.file_url, '_blank')}
                >
                  Open in New Tab
                </Button>
                <Button onClick={() => handleDownload(previewAttachment)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
