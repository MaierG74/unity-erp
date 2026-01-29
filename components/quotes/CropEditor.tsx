'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { Slider } from '@/components/ui/slider';
import type { CropParams } from '@/types/image-editor';

interface CropEditorProps {
  imageUrl: string;
  initialCrop?: CropParams | null;
  onCropChange: (params: CropParams) => void;
}

export default function CropEditor({
  imageUrl,
  initialCrop,
  onCropChange,
}: CropEditorProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(initialCrop?.zoom ?? 1);
  const [imageAspect, setImageAspect] = useState<number | undefined>(undefined);

  // Load image to get its natural aspect ratio
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageAspect(img.naturalWidth / img.naturalHeight);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const onCropComplete = useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      onCropChange({
        x: croppedAreaPixels.x,
        y: croppedAreaPixels.y,
        width: croppedAreaPixels.width,
        height: croppedAreaPixels.height,
        zoom,
      });
    },
    [onCropChange, zoom],
  );

  // Don't render cropper until we know the image aspect ratio
  if (!imageAspect) {
    return (
      <div className="space-y-4">
        <div className="relative h-[400px] bg-muted rounded-lg overflow-hidden flex items-center justify-center">
          <span className="text-muted-foreground">Loading image...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative h-[400px] bg-muted rounded-lg overflow-hidden">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          aspect={imageAspect}
          objectFit="contain"
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>
      <div className="flex items-center gap-4 px-2">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Zoom</span>
        <Slider
          value={[zoom]}
          min={1}
          max={5}
          step={0.1}
          onValueChange={([v]) => setZoom(v)}
          className="flex-1"
        />
        <span className="text-sm text-muted-foreground w-12 text-right">
          {zoom.toFixed(1)}x
        </span>
      </div>
    </div>
  );
}
