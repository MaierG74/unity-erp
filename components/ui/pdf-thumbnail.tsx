import { PdfThumbnailClient } from './pdf-thumbnail-client';

interface PdfThumbnailProps {
  url: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Server component wrapper for the PDF thumbnail that delegates to client-side rendering
 */
export function PdfThumbnail(props: PdfThumbnailProps) {
  return <PdfThumbnailClient {...props} />;
}

export default PdfThumbnail; 