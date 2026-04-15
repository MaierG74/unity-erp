'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Crop, X } from 'lucide-react';
import type { CropParams } from '@/types/image-editor';

interface CropEditorProps {
  imageUrl: string;
  initialCrop?: CropParams | null;
  onCropChange: (params: CropParams | null) => void;
}

export default function CropEditor({
  imageUrl,
  initialCrop,
  onCropChange,
}: CropEditorProps) {
  const [cropping, setCropping] = useState(!!initialCrop);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(initialCrop?.zoom ?? 1);
  const [imageAspect, setImageAspect] = useState<number | undefined>(undefined);
  const [cropperKey, setCropperKey] = useState(0);

  // Load image to get its natural aspect ratio
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageAspect(img.naturalWidth / img.naturalHeight);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Reset when a different image is loaded
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(initialCrop?.zoom ?? 1);
    setCropping(!!initialCrop);
    setCropperKey((current) => current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleStartCropping = () => {
    setCropping(true);
  };

  const handleClearCrop = () => {
    setCropping(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropperKey((current) => current + 1);
    onCropChange(null);
  };

  // Show full image preview when not actively cropping
  if (!cropping) {
    return (
      <div className="space-y-4">
        <div className="relative h-[400px] bg-muted rounded-lg overflow-hidden flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Preview"
            className="max-h-full max-w-full object-contain"
          />
        </div>
        <div className="flex items-center justify-center">
          <Button variant="outline" size="sm" onClick={handleStartCropping}>
            <Crop size={16} className="mr-2" />
            Start Cropping
          </Button>
        </div>
      </div>
    );
  }

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
          key={cropperKey}
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          aspect={imageAspect}
          initialCroppedAreaPixels={
            initialCrop
              ? {
                  x: initialCrop.x,
                  y: initialCrop.y,
                  width: initialCrop.width,
                  height: initialCrop.height,
                }
              : undefined
          }
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>
      <div className="flex items-center gap-4 px-2">
        <Button variant="ghost" size="sm" onClick={handleClearCrop} title="Remove crop">
          <X size={16} className="mr-1" />
          Clear
        </Button>
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
