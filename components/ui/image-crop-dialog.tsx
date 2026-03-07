'use client'

import { useState, useCallback, useEffect } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import type { CropParams } from '@/types/image-editor'

interface ImageCropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageSrc: string
  onCropComplete?: (croppedFile: File) => void
  onCropParamsComplete?: (cropParams: CropParams | null) => void
  initialCrop?: CropParams | null
  fileName?: string
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  fileName: string
): Promise<File> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = reject
    image.src = imageSrc
  })

  const canvas = document.createElement('canvas')
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas is empty'))
      resolve(new File([blob], fileName, { type: 'image/png' }))
    }, 'image/png')
  })
}

export function ImageCropDialog({
  open,
  onOpenChange,
  imageSrc,
  onCropComplete,
  onCropParamsComplete,
  initialCrop,
  fileName = 'cropped-image.png',
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(initialCrop?.zoom ?? 1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [aspect, setAspect] = useState(4 / 3)

  useEffect(() => {
    let cancelled = false

    async function loadAspect() {
      const image = new Image()
      image.crossOrigin = 'anonymous'

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = reject
        image.src = imageSrc
      })

      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setAspect(image.naturalWidth / image.naturalHeight)
      }
    }

    loadAspect().catch(() => {
      if (!cancelled) setAspect(4 / 3)
    })

    return () => {
      cancelled = true
    }
  }, [imageSrc])

  const onCropAreaComplete = useCallback(
    (_croppedArea: Area, croppedPixels: Area) => {
      setCroppedAreaPixels(croppedPixels)
    },
    []
  )

  const handleApply = useCallback(async () => {
    if (!croppedAreaPixels) return
    const cropParams: CropParams = {
      x: croppedAreaPixels.x,
      y: croppedAreaPixels.y,
      width: croppedAreaPixels.width,
      height: croppedAreaPixels.height,
      zoom,
    }

    if (onCropParamsComplete) {
      onCropParamsComplete(cropParams)
    } else if (onCropComplete) {
      const croppedFile = await getCroppedImg(imageSrc, croppedAreaPixels, fileName)
      onCropComplete(croppedFile)
    }
    onOpenChange(false)
  }, [croppedAreaPixels, imageSrc, fileName, onCropComplete, onCropParamsComplete, onOpenChange, zoom])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setCrop({ x: 0, y: 0 })
      setZoom(initialCrop?.zoom ?? 1)
      setCroppedAreaPixels(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Crop Image</DialogTitle>
        </DialogHeader>

        <div className="relative h-[350px] bg-muted rounded-lg overflow-hidden">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
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
            onCropComplete={onCropAreaComplete}
          />
        </div>

        <div className="flex items-center gap-4 px-1">
          <Label className="text-sm text-muted-foreground shrink-0">Zoom</Label>
          <Slider
            min={1}
            max={3}
            step={0.05}
            value={[zoom]}
            onValueChange={([v]) => setZoom(v)}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
            {zoom.toFixed(1)}x
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply Crop</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
