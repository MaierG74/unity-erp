'use client';

import React from 'react';
import { useDropzone } from 'react-dropzone';
import { QuoteAttachment, uploadQuoteAttachment, deleteQuoteAttachment } from '@/lib/db/quotes';
import { Button } from '@/components/ui/button';

interface Props {
  quoteId: string;
  attachments: QuoteAttachment[];
  onAttachmentsChange: (attachments: QuoteAttachment[]) => void;
}

export default function QuoteAttachmentsList({ quoteId, attachments, onAttachmentsChange }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const onDrop = async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        const att = await uploadQuoteAttachment(file, quoteId);
        onAttachmentsChange([...attachments, att]);
      } catch (error) {
        console.error('Upload error:', error);
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true });

  const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) {
          const ext = f.type?.split('/')[1] || 'png';
          const name = f.name && f.name.trim().length > 0 ? f.name : `pasted-${Date.now()}.${ext}`;
          files.push(new File([f], name, { type: f.type }));
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await onDrop(files);
      containerRef.current?.focus();
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQuoteAttachment(id);
      onAttachmentsChange(attachments.filter(a => a.id !== id));
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div
        {...getRootProps({ tabIndex: 0 })}
        ref={containerRef}
        onPaste={handlePaste}
        title="Drag files here or paste from clipboard"
        className={`p-8 border-2 border-dashed rounded-lg text-center transition-colors ${
          isDragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        }`}
      >
        <input {...getInputProps()} />
        <div className="space-y-2">
          <div className="text-muted-foreground text-sm">
            {isDragActive ? (
              <p>Drop files here to attach</p>
            ) : (
              <>
                <p className="font-medium">Drag & drop attachments here, or click to select files</p>
                <p className="text-xs">You can also paste images from your clipboard</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Attachments Grid */}
      {attachments.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">
            Attachments ({attachments.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {attachments.map(att => (
              <div key={att.id} className="group relative bg-muted/30 rounded-lg border hover:border-muted-foreground/50 transition-all">
                {att.mime_type.startsWith('image/') ? (
                  <div className="aspect-square relative overflow-hidden rounded-lg">
                    <img
                      src={att.file_url}
                      alt={att.original_name || att.file_url.split('/').pop()}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </div>
                ) : (
                  <div className="aspect-square flex items-center justify-center p-3">
                    <div className="text-center">
                      <div className="w-8 h-8 mx-auto mb-2 bg-muted rounded flex items-center justify-center">
                        <span className="text-xs font-mono text-muted-foreground">
                          {att.mime_type.split('/')[1]?.toUpperCase().slice(0, 3) || 'FILE'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {att.original_name || att.file_url.split('/').pop()}
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Delete Button */}
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute -top-2 -right-2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  onClick={() => handleDelete(att.id)}
                >
                  ×
                </Button>
                
                {/* Filename Tooltip */}
                {att.mime_type.startsWith('image/') && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="truncate">
                      {att.original_name || att.file_url.split('/').pop()}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}