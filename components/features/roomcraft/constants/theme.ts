export const COLORS = {
  roomInterior: '#F5F0EB',
  wallStroke: '#374151',
  gridLine: '#E5E1DC',
  canvasBackground: '#FAFAF8',
  sidebarBackground: '#FFFFFF',
  dimensionLabel: '#6B7280',
  wallLabel: '#9CA3AF',
  originMarker: '#EF4444',
  openingSymbol: '#6B7280',
  openingSelected: '#3B82F6',
  openingDimLabel: '#6B7280',
  wallSegmentLabel: '#9CA3AF',
  blockFillFallback: '#bbb',
  blockOutline: '#9ca3af',
  blockOutlineSelected: '#1f2937',
  blockOutlineWarning: '#eab308',
  blockBadge: '#374151',
} as const;

export const GRID = {
  defaultSpacing: 500, // mm
  fineSpacing: 100,    // mm
} as const;

export const CANVAS = {
  wallThickness: 3,    // px (scaled)
  padding: 0.1,        // 10% margin on all sides
  minZoom: 0.01,       // will be computed per room
  maxZoom: 1,          // 1px = 1mm
  labelFont: '12px system-ui, -apple-system, sans-serif',
  wallLabelFont: '14px system-ui, -apple-system, sans-serif',
  badgeFont: '10px system-ui, -apple-system, sans-serif',
} as const;

export const DEFAULTS = {
  roomLength: 3400, // mm
  roomWidth: 2800,  // mm
  roomHeight: 2500, // mm
} as const;

export const OPENING_DEFAULTS = {
  door: { width: 820, height: 2040, distanceFromFloor: 0, hingeSide: 'left' as const, swingDirection: 'inward' as const },
  'double-door': { width: 1640, height: 2040, distanceFromFloor: 0, swingDirection: 'inward' as const },
  window: { width: 1200, height: 1200, distanceFromFloor: 900 },
  archway: { width: 900, height: 2100, distanceFromFloor: 0 },
} as const;

export const OPENING_VALIDATION = {
  minCornerDistance: 0, // mm — openings may be placed flush with a corner
  minHitAreaPx: 20,      // px — minimum hit area for touch/click
} as const;

export const MEASUREMENT = {
  minLabelMm: 150, // segments shorter than this don't get a label (avoids overlap with opening label)
  labelOffsetPx: 20,
} as const;
