'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import CropEditor from './CropEditor';
import ArrowAnnotator from './ArrowAnnotator';
import { updateQuoteAttachmentEditorParams, type QuoteAttachment } from '@/lib/db/quotes';
import type { CropParams, ArrowAnnotation, ImageDisplaySize } from '@/types/image-editor';

const SIZE_OPTIONS: { value: ImageDisplaySize; label: string; desc: string }[] = [
  { value: 'small', label: 'S', desc: 'Small' },
  { value: 'medium', label: 'M', desc: 'Medium' },
  { value: 'large', label: 'L', desc: 'Large' },
];

interface ImageEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachment: QuoteAttachment;
  /** Called after save with the updated attachment */
  onSave: (updated: QuoteAttachment) => void;
}

export default function ImageEditorModal({
  open,
  onOpenChange,
  attachment,
  onSave,
}: ImageEditorModalProps) {
  const [cropParams, setCropParams] = useState<CropParams | null>(
    attachment.crop_params ?? null,
  );
  const [annotations, setAnnotations] = useState<ArrowAnnotation[]>(
    attachment.annotations ?? [],
  );
  const [displaySize, setDisplaySize] = useState<ImageDisplaySize>(
    attachment.display_size ?? 'small',
  );
  const [saving, setSaving] = useState(false);

  // Reset state when attachment changes
  useEffect(() => {
    setCropParams(attachment.crop_params ?? null);
    setAnnotations(attachment.annotations ?? []);
    setDisplaySize(attachment.display_size ?? 'small');
  }, [attachment.id, attachment.crop_params, attachment.annotations, attachment.display_size]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateQuoteAttachmentEditorParams(
        attachment.id,
        cropParams,
        annotations.length > 0 ? annotations : null,
        displaySize,
      );
      onSave({
        ...attachment,
        crop_params: cropParams,
        annotations: annotations.length > 0 ? annotations : null,
        display_size: displaySize,
      });
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save editor params:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCropParams(null);
    setAnnotations([]);
    setDisplaySize('small');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Edit Image — {attachment.original_name || 'Attachment'}
          </DialogTitle>
        </DialogHeader>

        {/* Display Size selector */}
        <div className="flex items-center gap-3 pb-2 border-b">
          <Label className="text-sm font-medium">PDF Size</Label>
          <div className="flex gap-1">
            {SIZE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={displaySize === opt.value ? 'default' : 'outline'}
                size="sm"
                className="w-16"
                onClick={() => setDisplaySize(opt.value)}
              >
                {opt.desc}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            Controls how large the image appears in the PDF
          </span>
        </div>

        <Tabs defaultValue="crop">
          <TabsList>
            <TabsTrigger value="crop">Crop & Zoom</TabsTrigger>
            <TabsTrigger value="annotate">
              Annotations
              {annotations.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs">
                  {annotations.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="crop" className="mt-4">
            <CropEditor
              imageUrl={attachment.file_url}
              initialCrop={cropParams}
              onCropChange={setCropParams}
            />
          </TabsContent>

          <TabsContent value="annotate" className="mt-4">
            <ArrowAnnotator
              imageUrl={attachment.file_url}
              cropParams={cropParams}
              annotations={annotations}
              onAnnotationsChange={setAnnotations}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReset} disabled={saving}>
            Reset
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
