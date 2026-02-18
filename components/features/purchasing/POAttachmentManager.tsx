'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { POAttachment, uploadPOAttachment, deletePOAttachment } from '@/lib/db/purchase-order-attachments';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  Loader2,
  Truck,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ExternalLink,
  Download,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

function formatUploadedDate(uploadedAt: string) {
  const date = new Date(uploadedAt);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function POAttachmentManager({
  purchaseOrderId,
  attachments,
  onAttachmentsChange,
  disabled = false,
}: POAttachmentManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<POAttachment | null>(null);
  const [rotation, setRotation] = useState(0);
  const [viewerScale, setViewerScale] = useState(1);
  const [magnifierOn, setMagnifierOn] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState<{ x: number; y: number; bgX: number; bgY: number } | null>(null);
  const panzoomContainerRef = useRef<HTMLDivElement | null>(null);
  const panzoomTargetRef = useRef<HTMLDivElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const wheelHandlerRef = useRef<((event: WheelEvent) => void) | null>(null);

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

  const cleanupPanzoom = useCallback(() => {
    if (wheelHandlerRef.current && panzoomContainerRef.current) {
      panzoomContainerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
      wheelHandlerRef.current = null;
    }
    panzoomRef.current?.destroy();
    panzoomRef.current = null;
  }, []);

  const initPanzoom = useCallback(() => {
    if (!panzoomContainerRef.current || !panzoomTargetRef.current) return;
    cleanupPanzoom();

    panzoomRef.current = Panzoom(panzoomTargetRef.current, {
      maxScale: 12,
      minScale: 0.1,
      cursor: 'grab',
      startScale: 1,
    });

    setViewerScale(panzoomRef.current.getScale());
    wheelHandlerRef.current = (event: WheelEvent) => {
      panzoomRef.current?.zoomWithWheel(event);
      setViewerScale(panzoomRef.current?.getScale() ?? 1);
    };
    panzoomContainerRef.current.addEventListener('wheel', wheelHandlerRef.current, {
      passive: false,
    });
  }, [cleanupPanzoom]);

  useEffect(() => {
    if (!previewOpen || !previewAtt?.mime_type?.startsWith('image/')) {
      cleanupPanzoom();
      return;
    }

    const timer = window.setTimeout(() => {
      initPanzoom();
    }, 80);

    return () => window.clearTimeout(timer);
  }, [previewOpen, previewAtt?.id, previewAtt?.mime_type, initPanzoom, cleanupPanzoom]);

  useEffect(() => {
    return () => cleanupPanzoom();
  }, [cleanupPanzoom]);

  useEffect(() => {
    if (!previewOpen || !previewAtt?.mime_type?.startsWith('image/')) return;
    const timer = window.setTimeout(() => {
      initPanzoom();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [rotation, previewOpen, previewAtt?.mime_type, initPanzoom]);

  useEffect(() => {
    if (!previewOpen) {
      setMagnifierOn(false);
      setMagnifierPos(null);
    }
  }, [previewOpen]);

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

  const openImagePreview = (att: POAttachment) => {
    setPreviewAtt(att);
    setRotation(0);
    setViewerScale(1);
    setPreviewOpen(true);
  };

  const downloadAttachment = async (att: POAttachment) => {
    try {
      const response = await fetch(att.file_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = att.original_name || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(att.file_url, '_blank', 'noopener,noreferrer');
      toast.error('Could not force download, opened original file instead.');
    }
  };

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
              const isDeliveryNote = att.attachment_type === 'delivery_note';
              const Icon = isDeliveryNote ? Truck : getFileIcon(att.mime_type);
              const isImage = !!att.mime_type?.startsWith('image/');
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isDeliveryNote ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="flex-1 min-w-0">
                    {isImage ? (
                      <button
                        type="button"
                        className="truncate hover:underline block text-left w-full"
                        onClick={() => openImagePreview(att)}
                      >
                        {att.original_name || 'Attachment'}
                      </button>
                    ) : (
                      <a
                        href={att.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate hover:underline block"
                      >
                        {att.original_name || 'Attachment'}
                      </a>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      {isDeliveryNote && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Delivery Note
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                        Uploaded {formatUploadedDate(att.uploaded_at)}
                      </Badge>
                      {att.receipt_id && (
                        <span className="text-[10px] text-muted-foreground">
                          Receipt #{att.receipt_id}
                        </span>
                      )}
                      {att.notes && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {att.notes}
                        </span>
                      )}
                    </div>
                  </div>
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

      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setPreviewAtt(null);
        }}
      >
        <DialogContent className="max-w-6xl overflow-hidden p-0">
          {previewAtt && previewAtt.mime_type?.startsWith('image/') && (
            <div className="bg-background">
              <div className="border-b px-6 py-4 pr-14">
                <DialogHeader className="space-y-0">
                  <DialogTitle className="truncate text-xl font-semibold">
                    {previewAtt?.original_name || 'Attachment preview'}
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      panzoomRef.current?.zoomIn();
                      setViewerScale(panzoomRef.current?.getScale() ?? viewerScale);
                    }}
                  >
                    <ZoomIn className="mr-1 h-4 w-4" />
                    Zoom In
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      panzoomRef.current?.zoomOut();
                      setViewerScale(panzoomRef.current?.getScale() ?? viewerScale);
                    }}
                  >
                    <ZoomOut className="mr-1 h-4 w-4" />
                    Zoom Out
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRotation((prev) => prev - 90)}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    Rotate Left
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRotation((prev) => prev + 90)}
                  >
                    <RotateCw className="mr-1 h-4 w-4" />
                    Rotate Right
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      panzoomRef.current?.reset();
                      setViewerScale(panzoomRef.current?.getScale() ?? 1);
                      setRotation(0);
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(previewAtt.file_url, '_blank')}
                  >
                    <ExternalLink className="mr-1 h-4 w-4" />
                    Open Original
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => downloadAttachment(previewAtt)}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant={magnifierOn ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setMagnifierOn((prev) => !prev);
                      setMagnifierPos(null);
                    }}
                  >
                    <Search className="mr-1 h-4 w-4" />
                    Magnifier
                  </Button>
                </div>
              </div>

              <div
                ref={panzoomContainerRef}
                className="relative m-4 mt-5 h-[66vh] w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-border/80 bg-black/90 shadow-inner"
                onMouseMove={(event) => {
                  if (!magnifierOn || !previewImageRef.current || !panzoomContainerRef.current) return;
                  const imgRect = previewImageRef.current.getBoundingClientRect();
                  const containerRect = panzoomContainerRef.current.getBoundingClientRect();

                  if (
                    event.clientX < imgRect.left ||
                    event.clientX > imgRect.right ||
                    event.clientY < imgRect.top ||
                    event.clientY > imgRect.bottom
                  ) {
                    setMagnifierPos(null);
                    return;
                  }

                  const relX = ((event.clientX - imgRect.left) / imgRect.width) * 100;
                  const relY = ((event.clientY - imgRect.top) / imgRect.height) * 100;
                  // Map visual position back to original (unrotated) image coordinates
                  const normalizedRotation = ((rotation % 360) + 360) % 360;
                  let bgX: number, bgY: number;
                  if (normalizedRotation === 90) {
                    bgX = relY;
                    bgY = 100 - relX;
                  } else if (normalizedRotation === 180) {
                    bgX = 100 - relX;
                    bgY = 100 - relY;
                  } else if (normalizedRotation === 270) {
                    bgX = 100 - relY;
                    bgY = relX;
                  } else {
                    bgX = relX;
                    bgY = relY;
                  }
                  setMagnifierPos({
                    x: event.clientX - containerRect.left,
                    y: event.clientY - containerRect.top,
                    bgX,
                    bgY,
                  });
                }}
                onMouseLeave={() => setMagnifierPos(null)}
              >
                <div ref={panzoomTargetRef} className="flex h-full w-full touch-none items-center justify-center">
                  <img
                    ref={previewImageRef}
                    src={previewAtt.file_url}
                    alt={previewAtt.original_name || 'preview'}
                    className="max-h-[62vh] max-w-[82vw] select-none object-contain"
                    style={{ transform: `rotate(${rotation}deg)` }}
                    draggable={false}
                  />
                </div>
                {magnifierOn && magnifierPos && (
                  <div
                    className="pointer-events-none absolute h-44 w-44 rounded-full border-2 border-white/90 shadow-xl ring-2 ring-black/50"
                    style={{
                      left: magnifierPos.x - 88,
                      top: magnifierPos.y - 88,
                      backgroundImage: `url(${previewAtt.file_url})`,
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: `${375 * Math.max(1, viewerScale)}% ${375 * Math.max(1, viewerScale)}%`,
                      backgroundPosition: `${magnifierPos.bgX}% ${magnifierPos.bgY}%`,
                      transform: `rotate(${rotation}deg)`,
                    }}
                  />
                )}
              </div>

              <div className="border-t bg-muted/30 px-6 py-3">
                <p className="text-xs text-muted-foreground">
                  Tip: drag to pan, scroll to zoom, rotate as needed, and toggle Magnifier for fine detail.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
