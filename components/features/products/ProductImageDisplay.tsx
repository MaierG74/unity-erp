'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { compositeImage } from '@/lib/quotes/compositeImage'
import type { CropParams } from '@/types/image-editor'

interface ProductImageDisplayProps {
  imageUrl: string
  cropParams?: CropParams | null
  alt: string
  fit?: 'contain' | 'cover'
  priority?: boolean
}

function getOutputDimensions(cropParams: CropParams, maxDimension: number) {
  const largestDimension = Math.max(cropParams.width, cropParams.height)
  const scale = largestDimension > maxDimension ? maxDimension / largestDimension : 1

  return {
    width: Math.max(1, Math.round(cropParams.width * scale)),
    height: Math.max(1, Math.round(cropParams.height * scale)),
  }
}

export function ProductImageDisplay({
  imageUrl,
  cropParams,
  alt,
  fit = 'contain',
  priority = false,
}: ProductImageDisplayProps) {
  const [displayUrl, setDisplayUrl] = useState(imageUrl)
  const shouldBypassOptimizer =
    displayUrl.startsWith('data:') ||
    displayUrl.startsWith('blob:') ||
    displayUrl.startsWith('http://') ||
    displayUrl.startsWith('https://')

  useEffect(() => {
    let cancelled = false

    if (!cropParams) {
      setDisplayUrl(imageUrl)
      return
    }

    const { width, height } = getOutputDimensions(
      cropParams,
      fit === 'cover' ? 480 : 1600
    )

    compositeImage(imageUrl, cropParams, null, width, height)
      .then((compositedUrl) => {
        if (!cancelled) setDisplayUrl(compositedUrl)
      })
      .catch(() => {
        if (!cancelled) setDisplayUrl(imageUrl)
      })

    return () => {
      cancelled = true
    }
  }, [cropParams, fit, imageUrl])

  return (
    <Image
      src={displayUrl}
      alt={alt}
      fill
      priority={priority}
      unoptimized={shouldBypassOptimizer}
      className={fit === 'cover' ? 'object-cover' : 'object-contain'}
    />
  )
}

export default ProductImageDisplay
