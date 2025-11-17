"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { ImageUpload } from "./image-upload"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/lib/supabase"
import { Trash2 } from "lucide-react"

interface ProductImage {
  id: string
  product_id: string
  image_url: string
  is_primary: boolean
}

interface ImageGalleryProps {
  productId: string
  productCode: string
  images: ProductImage[]
  onImagesChange?: () => void
}

export function ImageGallery({
  productId,
  productCode,
  images,
  onImagesChange,
}: ImageGalleryProps) {
  const [localImages, setLocalImages] = useState<ProductImage[]>(images)
  const [selectedImage, setSelectedImage] = useState<ProductImage | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    setLocalImages(images)
  }, [images])

  useEffect(() => {
    if (localImages.length === 0) {
      setSelectedImage(null)
      return
    }
    if (!selectedImage || !localImages.some((img) => img.id === selectedImage.id)) {
      const primary = localImages.find((img) => img.is_primary) || localImages[0]
      setSelectedImage(primary)
    }
  }, [localImages, selectedImage])

  const handleImageUpload = (url: string) => {
    const tempImage: ProductImage = {
      id: `temp-${Date.now()}`,
      product_id: productId,
      image_url: url,
      is_primary: false,
    }
    setLocalImages((prev) => [tempImage, ...prev])
    setSelectedImage(tempImage)
    onImagesChange?.()
  }

  const handleSetPrimary = async (image: ProductImage) => {
    try {
      // First, set all images to non-primary
      await supabase
        .from("product_images")
        .update({ is_primary: false })
        .eq("product_id", productId)

      // Then set the selected image as primary
      const { error } = await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", image.id)

      if (error) throw error

      setLocalImages((prev) =>
        prev.map((img) => ({
          ...img,
          is_primary: img.id === image.id,
        }))
      )
      setSelectedImage((prev) =>
        prev && prev.id === image.id ? { ...prev, is_primary: true } : image
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
      const { error } = await supabase
        .from("product_images")
        .delete()
        .eq("id", image.id)

      if (error) throw error

      setLocalImages((prev) => prev.filter((img) => img.id !== image.id))
      if (selectedImage?.id === image.id) {
        const remainingImages = localImages.filter((img) => img.id !== image.id)
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
          <Image
            src={selectedImage.image_url}
            alt="Product image"
            fill
            className="object-contain dark:brightness-110 dark:drop-shadow-[0_8px_30px_rgba(0,0,0,0.85)]"
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
            key={image.id}
            className={`group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-card dark:bg-white/5 ${
              selectedImage?.id === image.id ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setSelectedImage(image)}
          >
            <Image
              src={image.image_url}
              alt="Product thumbnail"
              fill
              className="object-cover dark:brightness-110"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
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
      />
    </div>
  )
} 
