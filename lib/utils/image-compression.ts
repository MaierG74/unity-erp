import Compressor from 'compressorjs';

const DEFAULT_MAX_WIDTH = 1500;
const DEFAULT_MAX_HEIGHT = 1500;
const DEFAULT_QUALITY = 0.8;
const COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Compress an image file using Compressor.js.
 * - Only compresses images that exceed the threshold (default 2MB).
 * - Resizes to max 1500px on longest edge at 0.8 JPEG quality.
 * - Passes through PDFs and small images unchanged.
 * - Converts HEIC to JPEG automatically (handled by Compressor.js).
 */
export function compressImage(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    threshold?: number;
  }
): Promise<File> {
  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    quality = DEFAULT_QUALITY,
    threshold = COMPRESS_THRESHOLD_BYTES,
  } = options ?? {};

  // Don't compress non-images or small files
  if (!file.type.startsWith('image/') || file.size <= threshold) {
    return Promise.resolve(file);
  }

  return new Promise((resolve, reject) => {
    new Compressor(file, {
      maxWidth,
      maxHeight,
      quality,
      mimeType: 'image/jpeg',
      convertSize: 0, // Convert all formats (including HEIC) to JPEG
      success(result) {
        const compressed = new File([result], file.name.replace(/\.\w+$/, '.jpg'), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        resolve(compressed);
      },
      error(err) {
        console.error('Image compression failed, using original:', err);
        resolve(file); // Fallback to original on error
      },
    });
  });
}
