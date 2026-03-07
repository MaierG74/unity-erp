# Component Dialog Facelift Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernise the Add/Edit Component dialog with rich image preview, crop/zoom modal, clean layout sections, and code cleanup.

**Architecture:** Rewrite the JSX layout of `ComponentDialog.tsx` into grouped sections (image hero, details, inventory, suppliers). Extract a new `ImageCropDialog` component wrapping `react-easy-crop`. Strip ~89 console statements and dead debugging code. Mutation/save logic stays the same.

**Tech Stack:** React, react-hook-form, react-dropzone, react-easy-crop, shadcn/ui, Tailwind CSS

---

### Task 1: Create the ImageCropDialog component

**Files:**
- Create: `components/ui/image-crop-dialog.tsx`

This is a standalone modal wrapping `react-easy-crop` that accepts an image source, lets the user crop/zoom, and returns a cropped `File`.

**Step 1: Create the ImageCropDialog component**

```tsx
// components/ui/image-crop-dialog.tsx
'use client'

import { useState, useCallback } from 'react'
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

interface ImageCropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageSrc: string
  /** Called with the cropped File when user clicks Apply */
  onCropComplete: (croppedFile: File) => void
  /** Original filename to preserve extension */
  fileName?: string
}

/** Creates a cropped image File from canvas pixel area */
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
  fileName = 'cropped-image.png',
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)

  const onCropAreaComplete = useCallback(
    (_croppedArea: Area, croppedPixels: Area) => {
      setCroppedAreaPixels(croppedPixels)
    },
    []
  )

  const handleApply = useCallback(async () => {
    if (!croppedAreaPixels) return
    const croppedFile = await getCroppedImg(imageSrc, croppedAreaPixels, fileName)
    onCropComplete(croppedFile)
    onOpenChange(false)
  }, [croppedAreaPixels, imageSrc, fileName, onCropComplete, onOpenChange])

  // Reset state when dialog opens
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setCrop({ x: 0, y: 0 })
      setZoom(1)
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
            aspect={4 / 3}
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
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to `image-crop-dialog.tsx`

**Step 3: Commit**

```bash
git add components/ui/image-crop-dialog.tsx
git commit -m "feat: add ImageCropDialog component wrapping react-easy-crop"
```

---

### Task 2: Strip debug code from ComponentDialog

**Files:**
- Modify: `components/features/inventory/ComponentDialog.tsx`

Remove all 89 console.log/error/warn statements, the `checkSupabasePermissions()` function (lines ~660-727), the `verifyDataInSupabase()` function (lines ~807-859), and debug `useEffect` watchers (lines ~862-871, ~288-308, ~730-737). Keep `toast()` calls and actual error handling.

**Step 1: Remove all console statements**

Delete every line containing `console.log`, `console.error`, `console.warn` EXCEPT inside `catch` blocks where it precedes a `throw` or `toast`. Also remove the render-time console.log in `unit_id` field render and supplier field render callbacks.

**Step 2: Remove `checkSupabasePermissions` function and its useEffect**

Delete the entire `checkSupabasePermissions` async function (which creates and deletes temp DB records) and its `useEffect` caller that runs on dialog open.

**Step 3: Remove `verifyDataInSupabase` function and its call**

Delete the function definition and its call inside `onSuccess`.

**Step 4: Remove debug useEffects**

Delete the `useEffect` that logs `form.getValues()` on every change (line ~862) and the one that logs `selectedItem` (line ~867).

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add components/features/inventory/ComponentDialog.tsx
git commit -m "chore: strip 89 debug console statements and dead debugging code from ComponentDialog"
```

---

### Task 3: Rewrite the dialog layout — Image section with preview

**Files:**
- Modify: `components/features/inventory/ComponentDialog.tsx`

Replace the current image dropzone (lines ~903-1004) with a rich image section that:
- Shows a **live thumbnail preview** when a file is dropped/pasted or an existing image_url exists
- Has hover overlay with Edit (crop) and Remove buttons
- Integrates with the new `ImageCropDialog`

**Step 1: Add imports and state for crop dialog**

Add at top of file:
```tsx
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { Crop, Trash2 } from 'lucide-react'
```

Add state inside the component:
```tsx
const [cropDialogOpen, setCropDialogOpen] = useState(false)
const [previewUrl, setPreviewUrl] = useState<string | null>(null)
```

Add an effect to generate preview URLs from File objects:
```tsx
const imageFile = form.watch('image')
useEffect(() => {
  if (imageFile instanceof File) {
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }
  setPreviewUrl(null)
}, [imageFile])
```

The displayed image source should be: `previewUrl` (new file) or `selectedItem?.component.image_url` (existing), checking `form.watch('image_url') !== null` for deletion state.

**Step 2: Replace the image FormField JSX**

Replace the entire image `FormField` block with a new full-width image section (not inside the 2-col grid with Code). Move Code to its own row or into the details section.

New image section layout:
```tsx
{/* Image Section */}
<div className="space-y-2">
  <FormLabel>Image</FormLabel>
  {currentImageSrc ? (
    <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/30 w-full"
         style={{ maxHeight: '200px' }}>
      <img
        src={currentImageSrc}
        alt="Component"
        className="w-full h-full object-contain max-h-[200px]"
      />
      {/* Hover overlay with actions */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <Button type="button" size="sm" variant="secondary"
                onClick={() => setCropDialogOpen(true)}>
          <Crop className="h-4 w-4 mr-1" /> Crop
        </Button>
        <Button type="button" size="sm" variant="destructive"
                onClick={handleRemoveImage}>
          <Trash2 className="h-4 w-4 mr-1" /> Remove
        </Button>
      </div>
      {/* Caption */}
      {imageFile instanceof File && (
        <p className="text-xs text-muted-foreground mt-1 px-1">
          {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
        </p>
      )}
    </div>
  ) : (
    /* Drop zone — same drag/drop/paste as before but cleaner */
    <div {...getRootProps()} onPaste={handlePaste} tabIndex={0}
         className={cn(
           "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
           isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"
         )}
         onClick={(e) => { e.stopPropagation(); openFileDialog() }}>
      <input {...getInputProps()} />
      <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
      <p className="text-sm text-muted-foreground">
        Drag & drop, paste, or <span className="text-primary font-medium underline-offset-4 underline">browse</span>
      </p>
      <p className="text-xs text-muted-foreground mt-1">PNG, JPG, SVG, GIF or WebP</p>
    </div>
  )}
</div>

{/* Crop dialog */}
{currentImageSrc && (
  <ImageCropDialog
    open={cropDialogOpen}
    onOpenChange={setCropDialogOpen}
    imageSrc={currentImageSrc}
    fileName={imageFile instanceof File ? imageFile.name : 'cropped-component.png'}
    onCropComplete={(croppedFile) => {
      form.setValue('image', croppedFile)
    }}
  />
)}
```

Helper logic for `currentImageSrc` and `handleRemoveImage`:
```tsx
const isImageDeleted = form.watch('image_url') === null
const currentImageSrc = previewUrl
  || (!isImageDeleted && selectedItem?.component.image_url)
  || null

const handleRemoveImage = () => {
  form.setValue('image', undefined)
  form.setValue('image_url', null)
}
```

**Step 3: Change dropzone `noClick: true` to `noClick: false`**

Remove `noClick: true` from the useDropzone config since the whole drop zone is now clickable.

Actually — keep `noClick: true` and handle click manually via `openFileDialog()` in the onClick. This is because we need the paste handler to work without triggering the file dialog.

**Step 4: Verify TypeScript compiles and lint passes**

Run: `npx tsc --noEmit && npm run lint`

**Step 5: Commit**

```bash
git add components/features/inventory/ComponentDialog.tsx
git commit -m "feat: image section with live preview, crop button, and remove overlay"
```

---

### Task 4: Rewrite the dialog layout — Details, Inventory, Suppliers sections

**Files:**
- Modify: `components/features/inventory/ComponentDialog.tsx`

Restructure the form body into clearly labeled sections with proper spacing. Widen dialog to `max-w-3xl`.

**Step 1: Update dialog shell**

Change:
- `max-w-2xl` → `max-w-3xl`
- Remove `modal={false}` (should be modal)
- Add `DialogDescription` back if needed for accessibility

**Step 2: Restructure form into sections**

The form body should follow this order:

```tsx
<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
  {/* Image Section — from Task 3 */}

  {/* Details Section */}
  <div className="space-y-4">
    <h4 className="text-sm font-medium text-muted-foreground">Details</h4>
    <div className="grid grid-cols-2 gap-4">
      {/* Code field */}
      {/* Category field */}
    </div>
    {/* Description textarea — full width */}
    {/* Unit select — full width or half */}
  </div>

  {/* Inventory Section */}
  <div className="space-y-4">
    <h4 className="text-sm font-medium text-muted-foreground">Inventory</h4>
    <div className="grid grid-cols-3 gap-4">
      {/* Qty on Hand, Reorder Level, Location */}
    </div>
  </div>

  {/* Suppliers Section */}
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-medium text-muted-foreground">Suppliers</h4>
      <Button type="button" variant="outline" size="sm" ...>Add Supplier</Button>
    </div>
    {/* Supplier rows — compact, single-line each */}
    {supplierComponents.length === 0 && (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No suppliers added
      </p>
    )}
    <div className="space-y-3">
      {supplierComponents.map((_, index) => (
        <div key={index} className="grid grid-cols-12 gap-3 items-end">
          {/* col-span-4: Supplier select */}
          {/* col-span-4: Component creatable */}
          {/* col-span-3: Price input */}
          {/* col-span-1: Remove button */}
        </div>
      ))}
    </div>
  </div>

  {/* Footer */}
  <div className="flex justify-end gap-3 pt-4 border-t">
    <Button variant="outline" onClick={...}>Cancel</Button>
    <Button type="submit" disabled={...}>
      {isPending ? <Loader2 .../> : null}
      {selectedItem ? 'Save Changes' : 'Add Component'}
    </Button>
  </div>
</form>
```

**Step 3: Flatten supplier rows**

Remove the bordered `p-4 border rounded-lg` wrapper and the `Supplier {index + 1}` sub-header from each supplier entry. Replace with a flat grid row. Remove the label from each field (Supplier/Component/Price) since the section header and column alignment make them obvious. If this is the first row, show column headers above:

```tsx
{index === 0 && (
  <div className="grid grid-cols-12 gap-3 text-xs text-muted-foreground">
    <span className="col-span-4">Supplier</span>
    <span className="col-span-4">Supplier Code</span>
    <span className="col-span-3">Price</span>
    <span className="col-span-1" />
  </div>
)}
```

**Step 4: Apply numeric input UX pattern**

For Qty on Hand and Reorder Level fields: use `value={field.value || ''}` with `placeholder="0"`.

**Step 5: Verify TypeScript compiles and lint passes**

Run: `npx tsc --noEmit && npm run lint`

**Step 6: Commit**

```bash
git add components/features/inventory/ComponentDialog.tsx
git commit -m "feat: restructure ComponentDialog into section-based layout with compact suppliers"
```

---

### Task 5: Visual testing — dark mode and light mode

**Files:** None (visual verification only)

**Step 1: Open browser and navigate to inventory page**

Navigate to `http://localhost:3000/inventory`, log in with test account if needed (testai / ClaudeTest2026!).

**Step 2: Open Add Component dialog**

Click "+ Add Component" button.

**Step 3: Test dark mode**

- Verify sections are clearly separated
- Drop an image file → verify live preview appears
- Click Crop button → verify crop modal opens, zoom slider works
- Apply crop → verify preview updates with cropped image
- Click Remove → verify image clears and drop zone returns
- Fill in all fields and add a supplier row
- Verify supplier row is compact single-line

**Step 4: Toggle to light mode**

Use the theme toggle (moon icon in header). Verify all the same interactions look correct in light mode.

**Step 5: Test edit mode**

Click an existing component that has an image. Verify:
- Existing image shows as preview
- Crop/Remove overlay buttons appear on hover
- Existing supplier data populates compact rows

**Step 6: Take screenshots as proof**

Save screenshots for both dark and light mode views.

---

### Task 6: Final cleanup and lint

**Files:**
- Modify: `components/features/inventory/ComponentDialog.tsx`

**Step 1: Run linter**

Run: `npm run lint`
Fix any issues.

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Fix any issues.

**Step 3: Final commit**

```bash
git add -A
git commit -m "style: final cleanup and lint fixes for ComponentDialog facelift"
```
