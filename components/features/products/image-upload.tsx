'use client'

import { useState, useCallback, useEffect, type ClipboardEvent } from 'react'
import { useDropzone } from 'react-dropzone'
import Image from 'next/image'
import { Crop, Loader2, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { generateUniqueImageName, getProductImagePath } from '@/lib/utils/image'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { toast } from 'sonner'
import type { CropParams } from '@/types/image-editor'
import { ProductImageDisplay } from './ProductImageDisplay'

interface ImageUploadProps {
  productCode: string;
  productId: string;
  onUploadComplete?: (upload: {
    imageId: string | number;
    productId: string | number;
    url: string;
    isPrimary: boolean;
    cropParams: CropParams | null;
  }) => void;
  onPendingStateChange?: (hasPending: boolean) => void;
  className?: string;
}

interface UploadingFile {
  file: File
  progress: number
}

export function ImageUpload({ productCode, productId, onUploadComplete, onPendingStateChange, className }: ImageUploadProps) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [selectedPendingIndex, setSelectedPendingIndex] = useState(0)
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [pendingCropParams, setPendingCropParams] = useState<Record<number, CropParams | null>>({})
  const [cropDialogOpen, setCropDialogOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    const urls = pendingFiles.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [pendingFiles])

  useEffect(() => {
    setPendingCropParams((current) => {
      const next: Record<number, CropParams | null> = {}
      pendingFiles.forEach((_, index) => {
        next[index] = current[index] ?? null
      })
      return next
    })
  }, [pendingFiles])

  useEffect(() => {
    onPendingStateChange?.(pendingFiles.length > 0)
  }, [onPendingStateChange, pendingFiles])

  useEffect(() => {
    if (pendingFiles.length === 0) return

    const warningMessage = 'You have an image ready but not uploaded yet. Leave this page and lose it?'

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = warningMessage
      return warningMessage
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [pendingFiles.length])

  const uploadFiles = useCallback(async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return [] as File[]

    const newFiles = filesToUpload.map((file) => ({
      file,
      progress: 0,
    }))
    setUploadingFiles((prev) => [...prev, ...newFiles])

    const failedFiles: File[] = []

    for (const file of filesToUpload) {
      const uniqueName = generateUniqueImageName(productCode, file.name)
      const filePath = getProductImagePath(productCode, uniqueName)

      try {
        const { error: uploadError } = await supabase.storage
          .from('QButton')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true,
          })

        if (uploadError) {
          throw uploadError
        }

        setUploadingFiles((current) =>
          current.map((item) => (item.file === file ? { ...item, progress: 100 } : item))
        )

        const {
          data: { publicUrl },
        } = supabase.storage.from('QButton').getPublicUrl(filePath)

        let dbError: unknown = null
        let insertedImage:
          | {
              image_id: string | number
              product_id: string | number
              image_url: string
              is_primary: boolean
              crop_params?: CropParams | null
            }
          | null = null
        const cropParams = pendingCropParams[filesToUpload.indexOf(file)] ?? null
        const insertPayload = {
          product_id: productId,
          image_url: publicUrl,
          is_primary: false,
          crop_params: cropParams,
        }

        const insertResult = await supabase
          .from('product_images')
          .insert(insertPayload)
          .select('image_id, product_id, image_url, is_primary, crop_params')
          .single()
        if (insertResult.error && /crop_params/i.test(insertResult.error.message || '')) {
          const fallbackInsert = await supabase
            .from('product_images')
            .insert({
              product_id: productId,
              image_url: publicUrl,
              is_primary: false,
            })
            .select('image_id, product_id, image_url, is_primary')
            .single()
          dbError = fallbackInsert.error
          insertedImage = fallbackInsert.data
        } else {
          dbError = insertResult.error
          insertedImage = insertResult.data
        }

        if (dbError) throw dbError
        if (!insertedImage) {
          throw new Error('Product image insert succeeded but no image row was returned.')
        }

        toast.success('Image uploaded', {
          description: `${file.name} is now attached to this product.`,
        })

        onUploadComplete?.({
          imageId: insertedImage.image_id,
          productId: insertedImage.product_id,
          url: insertedImage.image_url,
          isPrimary: insertedImage.is_primary,
          cropParams: insertedImage.crop_params ?? cropParams,
        })
      } catch (error) {
        console.error('Upload error:', error)
        failedFiles.push(file)
        toast.error('Upload failed', {
          description: `Failed to upload ${file.name}`,
        })
      } finally {
        setUploadingFiles((current) => current.filter((item) => item.file !== file))
      }
    }

    return failedFiles
  }, [onUploadComplete, pendingCropParams, productCode, productId, toast])

  const queueFiles = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    setPendingFiles((current) => {
      const next = [...current, ...acceptedFiles]
      if (current.length === 0) setSelectedPendingIndex(0)
      return next
    })
  }, [])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (uploadingFiles.length > 0) return

    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file) => new File([file], file.name || `pasted-image-${Date.now()}.png`, { type: file.type }))

    if (files.length === 0) return

    event.preventDefault()
    queueFiles(files)
    toast('Image ready', {
      description: 'Paste received. You can crop it or upload it now.',
    })
  }, [queueFiles, uploadingFiles.length])

  const handleRemovePending = useCallback((index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
    setPendingCropParams((current) => {
      const nextEntries = Object.entries(current)
        .filter(([key]) => Number(key) !== index)
        .map(([key, value]) => [Number(key) > index ? Number(key) - 1 : Number(key), value] as const)
      return Object.fromEntries(nextEntries)
    })
    setSelectedPendingIndex((current) => {
      if (index < current) return current - 1
      if (index === current) return 0
      return current
    })
  }, [])

  const handleUploadPending = useCallback(async () => {
    const filesToUpload = [...pendingFiles]
    const failedFiles = await uploadFiles(filesToUpload)
    setPendingFiles(failedFiles)
    setSelectedPendingIndex(0)
  }, [pendingFiles, uploadFiles])

  const selectedPendingFile = pendingFiles[selectedPendingIndex] ?? null
  const selectedPreviewUrl = previewUrls[selectedPendingIndex] ?? null

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: queueFiles,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    multiple: true,
    noClick: true,
  })

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        onPaste={handlePaste}
        onClick={(event) => {
          event.currentTarget.focus()
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        }}
        tabIndex={0}
        title="Drag files here or paste from clipboard"
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors duration-200 outline-none',
          isDragActive
            ? 'border-primary bg-primary/10'
            : isFocused
            ? 'border-primary bg-primary/5'
            : 'border-border',
          'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30'
        )}
      >
        <input {...getInputProps()} className="hidden" />
        <Upload className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
        {isDragActive ? (
          <p>Drop the files here...</p>
        ) : (
          <div className="space-y-2">
            <p>{isFocused ? 'Paste image now, or browse for files' : 'Drag and drop images here, paste from clipboard, or browse for files'}</p>
            <p className="text-sm text-muted-foreground">
              {isFocused ? 'Upload box active' : 'Supports: PNG, JPG, GIF, WEBP'}
            </p>
            <div className="pt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation()
                  open()
                }}
              >
                Browse Files
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectedPendingFile && selectedPreviewUrl && (
        <div className="mt-4 space-y-3 rounded-lg border p-4">
          <div className="relative h-64 overflow-hidden rounded-md bg-muted/40">
            <ProductImageDisplay
              imageUrl={selectedPreviewUrl}
              cropParams={pendingCropParams[selectedPendingIndex] ?? null}
              alt={selectedPendingFile.name}
              fit="contain"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{selectedPendingFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedPendingFile.size / 1024).toFixed(0)} KB
                {pendingFiles.length > 1 ? ` · ${selectedPendingIndex + 1} of ${pendingFiles.length}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setCropDialogOpen(true)}>
                <Crop className="mr-1.5 h-4 w-4" />
                Crop
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={open}>
                Browse More
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => handleRemovePending(selectedPendingIndex)}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Remove
              </Button>
              <Button type="button" size="sm" onClick={handleUploadPending} disabled={uploadingFiles.length > 0}>
                {uploadingFiles.length > 0 ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-4 w-4" />
                    Upload {pendingFiles.length > 1 ? 'All' : 'Image'}
                  </>
                )}
              </Button>
            </div>
          </div>

          {pendingFiles.length > 1 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {previewUrls.map((url, index) => (
                <button
                  key={`${pendingFiles[index].name}-${index}`}
                  type="button"
                  onClick={() => setSelectedPendingIndex(index)}
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-md border bg-muted/30',
                    selectedPendingIndex === index ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                  )}
                >
                  <Image
                    src={url}
                    alt={pendingFiles[index].name}
                    fill
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upload Progress */}
      {uploadingFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploadingFiles.map((file) => (
            <div key={file.file.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>{file.file.name}</span>
                <span>{Math.round(file.progress)}%</span>
              </div>
              <Progress value={file.progress} className="h-1" />
            </div>
          ))}
        </div>
      )}

      {selectedPreviewUrl && selectedPendingFile && (
        <ImageCropDialog
          open={cropDialogOpen}
          onOpenChange={setCropDialogOpen}
          imageSrc={selectedPreviewUrl}
          initialCrop={pendingCropParams[selectedPendingIndex] ?? null}
          fileName={selectedPendingFile.name}
          onCropParamsComplete={(cropParams) => {
            setPendingCropParams((current) => ({
              ...current,
              [selectedPendingIndex]: cropParams,
            }))
          }}
        />
      )}
    </div>
  )
}
