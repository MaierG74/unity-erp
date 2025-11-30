'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { QuoteAttachment, uploadQuoteAttachment, deleteQuoteAttachment } from '@/lib/db/quotes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Upload, 
  X, 
  Image as ImageIcon, 
  FileText, 
  Eye, 
  EyeOff,
  GripVertical
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface QuoteAttachmentManagerProps {
  quoteId: string;
  quoteItemId?: string;
  attachments: QuoteAttachment[];
  onAttachmentsChange: (attachments: QuoteAttachment[]) => void;
  scope?: 'quote' | 'item';
  title?: string;
  description?: string;
}

export default function QuoteAttachmentManager({
  quoteId,
  quoteItemId,
  attachments,
  onAttachmentsChange,
  scope = 'item',
  title = 'Attachments',
  description = 'Upload images and documents for this item'
}: QuoteAttachmentManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<QuoteAttachment | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setUploading(true);
    try {
      const uploadPromises = acceptedFiles.map(file => 
        uploadQuoteAttachment(file, quoteId, quoteItemId)
      );
      
      const newAttachments = await Promise.all(uploadPromises);
      onAttachmentsChange([...attachments, ...newAttachments]);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  }, [quoteId, quoteItemId, attachments, onAttachmentsChange]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt']
    },
    multiple: true,
    // Prevent auto-opening the file dialog so users can click to focus and paste
    noClick: true
  });

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

  const handleDelete = async (attachmentId: string) => {
    try {
      await deleteQuoteAttachment(attachmentId);
      onAttachmentsChange(attachments.filter(att => att.id !== attachmentId));
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const toggleDisplayInQuote = (attachmentId: string, display: boolean) => {
    const updatedAttachments = attachments.map(att => 
      att.id === attachmentId ? { ...att, display_in_quote: display } : att
    );
    onAttachmentsChange(updatedAttachments);
    // TODO: Update in database
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');

  const filteredAttachments = attachments.filter(att => 
    scope === 'quote' ? att.scope === 'quote' : att.quote_item_id === quoteItemId
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload size={20} />
          {title}
        </CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Area */}
        <div
          {...getRootProps()}
          onPaste={handlePaste}
          tabIndex={0}
          title="Drag files here or paste from clipboard"
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
            "cursor-text", // clicking focuses without opening dialog
            isDragActive ? "border-primary bg-muted/40" : "border-border hover:bg-muted/40",
            uploading && "opacity-50 cursor-not-allowed"
          )}
        >
          <input {...getInputProps()} disabled={uploading} />
          <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          {uploading ? (
            <p className="text-sm text-muted-foreground">Uploading files...</p>
          ) : isDragActive ? (
            <p className="text-sm text-foreground">Drop files here...</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Drag & drop files here, or paste with <span className="font-medium">Ctrl/Cmd+V</span>
              </p>
              <div>
                <Button variant="outline" size="sm" type="button" onClick={open} disabled={uploading}>
                  Click to select
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Supports images, PDFs, and documents</p>
            </div>
          )}
        </div>

        {/* Attachments List */}
        {filteredAttachments.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm">Uploaded Files ({filteredAttachments.length})</h4>
            <div className="space-y-2">
              {filteredAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-3 p-3 border rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  {/* File Icon */}
                  <div className="flex-shrink-0">
                    {isImage(attachment.mime_type) ? (
                      <div className="relative">
                        <img
                          src={attachment.file_url}
                          alt={attachment.original_name || 'Attachment'}
                          className="w-12 h-12 object-cover rounded border cursor-pointer"
                          onClick={() => { setPreviewAtt(attachment); setPreviewOpen(true); }}
                        />
                        <ImageIcon className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full p-0.5" />
                      </div>
                    ) : (
                      <a
                        href={attachment.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="w-12 h-12 rounded border flex items-center justify-center bg-muted/40 hover:bg-muted/60 cursor-pointer"
                        title={attachment.original_name || ''}
                      >
                        <FileText className="w-6 h-6 text-muted-foreground" />
                      </a>
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {attachment.original_name || 'Unnamed file'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {attachment.mime_type}
                    </p>
                  </div>

                  {/* Display in Quote Toggle */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`display-${attachment.id}`}
                      checked={attachment.display_in_quote !== false} // Default to true if undefined
                      onCheckedChange={(checked) => 
                        toggleDisplayInQuote(attachment.id, checked as boolean)
                      }
                    />
                    <Label 
                      htmlFor={`display-${attachment.id}`}
                      className="text-xs cursor-pointer flex items-center gap-1"
                    >
                      {attachment.display_in_quote !== false ? (
                        <><Eye size={12} /> Show in PDF</>
                      ) : (
                        <><EyeOff size={12} /> Hidden</>
                      )}
                    </Label>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (isImage(attachment.mime_type)) {
                          setPreviewAtt(attachment);
                          setPreviewOpen(true);
                        } else {
                          window.open(attachment.file_url, '_blank');
                        }
                      }}
                    >
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(attachment.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Image Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{previewAtt?.original_name || previewAtt?.file_url.split('/').pop()}</DialogTitle>
            </DialogHeader>
            {previewAtt && isImage(previewAtt.mime_type) && (
              <div className="w-full">
                <img
                  src={previewAtt.file_url}
                  alt={previewAtt.original_name || 'preview'}
                  className="max-h-[70vh] w-auto mx-auto"
                />
                <div className="mt-3 flex gap-2 justify-end">
                  <Button variant="secondary" onClick={() => window.open(previewAtt.file_url, '_blank')}>Open</Button>
                  <Button onClick={() => { const a = document.createElement('a'); a.href = previewAtt.file_url; a.download = previewAtt.original_name || 'attachment'; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}>Download</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Quick Actions */}
        <div className="flex gap-2 pt-2 border-t">
          <Badge variant="outline" className="text-xs">
            {filteredAttachments.filter(att => isImage(att.mime_type)).length} Images
          </Badge>
          <Badge variant="outline" className="text-xs">
            {filteredAttachments.filter(att => !isImage(att.mime_type)).length} Documents
          </Badge>
          <Badge variant="outline" className="text-xs">
            {filteredAttachments.filter(att => att.display_in_quote !== false).length} Visible in PDF
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
