/** Crop region in source-image pixels, as output by react-easy-crop */
export interface CropParams {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Zoom level used in the editor (for restoring UI state) */
  zoom: number;
}

/** An arrow annotation with optional text label */
export interface ArrowAnnotation {
  type: 'arrow';
  id: string;
  /** Start X (0-1 normalized to crop area) */
  x1: number;
  /** Start Y (0-1 normalized) */
  y1: number;
  /** End X — arrowhead (0-1 normalized) */
  x2: number;
  /** End Y — arrowhead (0-1 normalized) */
  y2: number;
  /** Optional short text label */
  label?: string;
  /** Label X position (0-1 normalized). Defaults to arrow midpoint. */
  labelX?: number;
  /** Label Y position (0-1 normalized). Defaults to arrow midpoint. */
  labelY?: number;
  /** Hex color, defaults to #FF0000 */
  color?: string;
}

/** Display size preset for images in the PDF */
export type ImageDisplaySize = 'small' | 'medium' | 'large';

/** Pixel dimensions for each display size (used in PDF rendering) */
export const IMAGE_SIZE_MAP: Record<ImageDisplaySize, { width: number; height: number }> = {
  small: { width: 80, height: 60 },
  medium: { width: 140, height: 105 },
  large: { width: 200, height: 150 },
};
