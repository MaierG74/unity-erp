"use client"

import { useEffect, useState } from "react"
import { ImageUpload } from "./image-upload"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Crop, Trash2 } from "lucide-react"
import type { CropParams } from '@/types/image-editor'
import { ProductImageDisplay } from './ProductImageDisplay'
import { ProductImageEditorDialog } from './ProductImageEditorDialog'
import { authorizedFetch } from "@/lib/client/auth-fetch"

interface ProductImage {
  image_id: string | number
  product_id: string | number
  image_url: string
  is_primary: boolean
  crop_params?: CropParams | null
}

interface ImageGalleryProps {
  productId: string
  productCode: string
  images: ProductImage[]
  onImagesChange?: () => void
  onPendingUploadsChange?: (hasPending: boolean) => void
}

export function ImageGallery({
  productId,
  productCode,
  images,
  onImagesChange,
  onPendingUploadsChange,
}: ImageGalleryProps) {
  const [localImages, setLocalImages] = useState<ProductImage[]>(images)
  const [selectedImage, setSelectedImage] = useState<ProductImage | null>(null)
  const [editingImage, setEditingImage] = useState<ProductImage | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    setLocalImages(images)
  }, [images])

  useEffect(() => {
    if (localImages.length === 0) {
      setSelectedImage(null)
      return
    }
    if (!selectedImage || !localImages.some((img) => img.image_id === selectedImage.image_id)) {
      const primary = localImages.find((img) => img.is_primary) || localImages[0]
      setSelectedImage(primary)
    }
  }, [localImages, selectedImage])

  const handleImageUpload = ({
    imageId,
    productId: uploadedProductId,
    url,
    isPrimary,
    cropParams,
  }: {
    imageId: string | number
    productId: string | number
    url: string
    isPrimary: boolean
    cropParams: CropParams | null
  }) => {
    const uploadedImage: ProductImage = {
      image_id: imageId,
      product_id: uploadedProductId,
      image_url: url,
      is_primary: isPrimary,
      crop_params: cropParams,
    }
    setLocalImages((prev) => {
      const withoutDuplicate = prev.filter((image) => image.image_id !== imageId)
      return [uploadedImage, ...withoutDuplicate]
    })
    setSelectedImage(uploadedImage)
    onImagesChange?.()
  }

  const handleCropSaved = (imageId: string | number, cropParams: CropParams | null) => {
    setLocalImages((prev) =>
      prev.map((image) => (image.image_id === imageId ? { ...image, crop_params: cropParams } : image))
    )
    setSelectedImage((prev) =>
      prev && prev.image_id === imageId ? { ...prev, crop_params: cropParams } : prev
    )
    onImagesChange?.()
  }

  const handleSetPrimary = async (image: ProductImage) => {
    try {
      const response = await authorizedFetch(`/api/products/${productId}/images/${image.image_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_primary: true }),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to update primary image')
      }

      setLocalImages((prev) =>
        prev.map((img) => ({
          ...img,
          is_primary: img.image_id === image.image_id,
        }))
      )
      setSelectedImage((prev) =>
        prev && prev.image_id === image.image_id ? { ...prev, is_primary: true } : image
      )

      toast({
        title: "Success",
        description: "Primary image updated successfully",
      })

      if (onImagesChange) {
        onImagesChange()
      }
    } catch (error) {
      console.error("Error setting primary image:", error)
      toast({
        title: "Error",
        description: "Failed to update primary image",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (image: ProductImage) => {
    try {
      const response = await authorizedFetch(`/api/products/${productId}/images/${image.image_id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to delete image')
      }

      setLocalImages((prev) => prev.filter((img) => img.image_id !== image.image_id))
      if (selectedImage?.image_id === image.image_id) {
        const remainingImages = localImages.filter((img) => img.image_id !== image.image_id)
        setSelectedImage(remainingImages[0] || null)
      }

      toast({
        title: "Success",
        description: "Image deleted successfully",
      })

      if (onImagesChange) {
        onImagesChange()
      }
    } catch (error) {
      console.error("Error deleting image:", error)
      toast({
        title: "Error",
        description: "Failed to delete image",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Main image display */}
      <div className="relative h-[400px] w-full max-w-[600px] mx-auto overflow-hidden rounded-lg bg-card ring-0 dark:bg-white/5 dark:ring-1 dark:ring-white/10">
        {selectedImage ? (
          <ProductImageDisplay
            imageUrl={selectedImage.image_url}
            cropParams={selectedImage.crop_params}
            alt="Product image"
            fit="contain"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No image selected
          </div>
        )}
      </div>

      {/* Thumbnail grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-4">
        {localImages.map((image) => (
          <div
            key={image.image_id}
            className={`group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-card dark:bg-white/5 ${selectedImage?.image_id === image.image_id ? "ring-2 ring-primary" : ""
              }`}
            onClick={() => setSelectedImage(image)}
          >
            <ProductImageDisplay
              imageUrl={image.image_url}
              cropParams={image.crop_params}
              alt="Product thumbnail"
              fit="cover"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingImage(image)
                }}
              >
                <Crop className="mr-1.5 h-3 w-3" />
                {image.crop_params ? 'Edit Crop' : 'Crop'}
              </Button>
              {!image.is_primary && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSetPrimary(image)
                  }}
                >
                  Set Primary
                </Button>
              )}
              <Button
                variant="destructive"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(image)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ImageUpload
        productId={productId}
        productCode={productCode}
        onUploadComplete={handleImageUpload}
        onPendingStateChange={onPendingUploadsChange}
      />

      <ProductImageEditorDialog
        open={editingImage !== null}
        onOpenChange={(open) => {
          if (!open) setEditingImage(null)
        }}
        productId={productId}
        image={editingImage}
        onSaved={handleCropSaved}
      />
    </div>
  )
} 
