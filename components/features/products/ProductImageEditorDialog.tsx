'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import CropEditor from '@/components/quotes/CropEditor'
import { supabase } from '@/lib/supabase'
import type { CropParams } from '@/types/image-editor'
import { toast } from 'sonner'

interface ProductImageEditorTarget {
  image_id: string | number
  image_url: string
  crop_params?: CropParams | null
}

interface ProductImageEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  image: ProductImageEditorTarget | null
  onSaved: (imageId: string | number, cropParams: CropParams | null) => void
}

export function ProductImageEditorDialog({
  open,
  onOpenChange,
  image,
  onSaved,
}: ProductImageEditorDialogProps) {
  const [draftCropParams, setDraftCropParams] = useState<CropParams | null>(image?.crop_params ?? null)
  const [editorInitialCrop, setEditorInitialCrop] = useState<CropParams | null>(image?.crop_params ?? null)
  const [editorVersion, setEditorVersion] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftCropParams(image?.crop_params ?? null)
    setEditorInitialCrop(image?.crop_params ?? null)
    setEditorVersion((current) => current + 1)
  }, [image?.crop_params, image?.image_id])

  const handleSave = async () => {
    if (!image) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('product_images')
        .update({
          crop_params: draftCropParams,
          updated_at: new Date().toISOString(),
        })
        .eq('image_id', image.image_id)

      if (error) throw error

      onSaved(image.image_id, draftCropParams)
      toast.success('Image crop saved', {
        description: draftCropParams
          ? 'The original image is preserved and the saved crop is now displayed.'
          : 'Crop removed. The full original image is shown again.',
      })
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save product image crop:', error)
      toast.error('Failed to save crop', {
        description: 'The original image is unchanged.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setDraftCropParams(null)
    setEditorInitialCrop(null)
    setEditorVersion((current) => current + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Product Image</DialogTitle>
        </DialogHeader>

        {image ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              The original uploaded image stays untouched. This editor only saves crop metadata so you can re-crop or reset later.
            </div>

            <CropEditor
              key={`${String(image.image_id)}-${editorVersion}`}
              imageUrl={image.image_url}
              initialCrop={editorInitialCrop}
              onCropChange={setDraftCropParams}
            />
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleReset} disabled={saving}>
            Reset To Original
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !image}>
            {saving ? 'Saving...' : 'Save Crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ProductImageEditorDialog
