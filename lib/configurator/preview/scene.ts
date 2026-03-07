export type PreviewMarker = 'arrow';

export interface PreviewNodeMeta {
  partKey?: string;
  partRole?: string;
  viewKey?: string;
}

interface PreviewNodeBase {
  id?: string;
  meta?: PreviewNodeMeta;
  opacity?: number;
}

export interface PreviewRectNode extends PreviewNodeBase {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  dashArray?: string;
  rx?: number;
}

export interface PreviewLineNode extends PreviewNodeBase {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  strokeWidth?: number;
  dashArray?: string;
  markerStart?: PreviewMarker;
  markerEnd?: PreviewMarker;
  strokeLinecap?: 'round' | 'square' | 'butt';
}

export interface PreviewTextNode extends PreviewNodeBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fill?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  textAnchor?: 'start' | 'middle' | 'end';
  dominantBaseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'alphabetic';
  rotate?: {
    angle: number;
    cx: number;
    cy: number;
  };
  letterSpacing?: number;
}

export type PreviewNode = PreviewRectNode | PreviewLineNode | PreviewTextNode;

export interface ConfiguratorPreviewScene {
  width: number;
  height: number;
  title?: string;
  subtitle?: string;
  nodes: PreviewNode[];
  exportFileName?: string;
  backgroundFill?: string;
}

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TECHNICAL_PREVIEW_COLORS = {
  panelFill: '#e2e8f0',
  panelStroke: '#64748b',
  doorFill: '#dbeafe',
  doorStroke: '#3b82f6',
  shelfStroke: '#64748b',
  backFill: '#f1f5f9',
  adjusterFill: '#94a3b8',
  topFill: '#bfdbfe',
  dimColor: '#94a3b8',
  dimText: '#475569',
  labelColor: '#334155',
  guideStroke: '#cbd5e1',
  explodedNoteFill: '#f8fafc',
} as const;

interface DimensionOptions {
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;
  x?: number;
  y?: number;
  label: string;
  side: 'above' | 'below' | 'left' | 'right';
  unit: number;
  color?: string;
  textColor?: string;
  meta?: PreviewNodeMeta;
}

export function createHorizontalDimension(options: Omit<DimensionOptions, 'y1' | 'y2' | 'x' | 'side'> & {
  x1: number;
  x2: number;
  y: number;
  side: 'above' | 'below';
}): PreviewNode[] {
  const { x1, x2, y, label, side, unit, meta } = options;
  const color = options.color ?? TECHNICAL_PREVIEW_COLORS.dimColor;
  const textColor = options.textColor ?? TECHNICAL_PREVIEW_COLORS.dimText;
  const ext = side === 'above' ? -unit * 3.5 : unit * 3.5;
  const textY = side === 'above' ? y + ext - unit : y + ext + unit * 1.2;

  return [
    {
      type: 'line',
      x1,
      y1: y,
      x2: x1,
      y2: y + ext,
      stroke: color,
      strokeWidth: unit * 0.1,
      meta,
    },
    {
      type: 'line',
      x1: x2,
      y1: y,
      x2,
      y2: y + ext,
      stroke: color,
      strokeWidth: unit * 0.1,
      meta,
    },
    {
      type: 'line',
      x1,
      y1: y + ext / 2,
      x2,
      y2: y + ext / 2,
      stroke: color,
      strokeWidth: unit * 0.1,
      markerStart: 'arrow',
      markerEnd: 'arrow',
      meta,
    },
    {
      type: 'text',
      x: (x1 + x2) / 2,
      y: textY,
      text: label,
      fill: textColor,
      fontSize: unit * 2.5,
      fontWeight: 500,
      fontFamily: 'sans-serif',
      textAnchor: 'middle',
      meta,
    },
  ];
}

export function createVerticalDimension(options: Omit<DimensionOptions, 'x1' | 'x2' | 'y' | 'side'> & {
  y1: number;
  y2: number;
  x: number;
  side: 'left' | 'right';
}): PreviewNode[] {
  const { y1, y2, x, label, side, unit, meta } = options;
  const color = options.color ?? TECHNICAL_PREVIEW_COLORS.dimColor;
  const textColor = options.textColor ?? TECHNICAL_PREVIEW_COLORS.dimText;
  const ext = side === 'left' ? -unit * 3.5 : unit * 3.5;
  const textX = side === 'left' ? x + ext - unit * 1.2 : x + ext + unit * 1.2;

  return [
    {
      type: 'line',
      x1: x,
      y1,
      x2: x + ext,
      y2: y1,
      stroke: color,
      strokeWidth: unit * 0.1,
      meta,
    },
    {
      type: 'line',
      x1: x,
      y1: y2,
      x2: x + ext,
      y2,
      stroke: color,
      strokeWidth: unit * 0.1,
      meta,
    },
    {
      type: 'line',
      x1: x + ext / 2,
      y1,
      x2: x + ext / 2,
      y2,
      stroke: color,
      strokeWidth: unit * 0.1,
      markerStart: 'arrow',
      markerEnd: 'arrow',
      meta,
    },
    {
      type: 'text',
      x: textX,
      y: (y1 + y2) / 2,
      text: label,
      fill: textColor,
      fontSize: unit * 2.5,
      fontWeight: 500,
      fontFamily: 'sans-serif',
      textAnchor: 'middle',
      dominantBaseline: 'central',
      rotate: {
        angle: -90,
        cx: textX,
        cy: (y1 + y2) / 2,
      },
      meta,
    },
  ];
}

export function createCenteredLabel(options: {
  x: number;
  y: number;
  text: string;
  unit: number;
  fill?: string;
  fontWeight?: number | string;
  opacity?: number;
  meta?: PreviewNodeMeta;
}): PreviewTextNode {
  return {
    type: 'text',
    x: options.x,
    y: options.y,
    text: options.text,
    fill: options.fill ?? TECHNICAL_PREVIEW_COLORS.labelColor,
    fontSize: options.unit * 2,
    fontWeight: options.fontWeight ?? 500,
    fontFamily: 'sans-serif',
    textAnchor: 'middle',
    dominantBaseline: 'central',
    opacity: options.opacity,
    meta: options.meta,
  };
}

function rotateBounds(width: number, height: number, angleDegrees: number) {
  const angle = (Math.abs(angleDegrees) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

function getNodeBounds(node: PreviewNode): PreviewBounds {
  if (node.type === 'rect') {
    const inset = (node.strokeWidth ?? 0) / 2;
    return {
      x: node.x - inset,
      y: node.y - inset,
      width: node.width + inset * 2,
      height: node.height + inset * 2,
    };
  }

  if (node.type === 'line') {
    const inset = ((node.strokeWidth ?? 0) / 2) + (node.markerStart || node.markerEnd ? 6 : 0);
    const minX = Math.min(node.x1, node.x2);
    const minY = Math.min(node.y1, node.y2);
    const maxX = Math.max(node.x1, node.x2);
    const maxY = Math.max(node.y1, node.y2);

    return {
      x: minX - inset,
      y: minY - inset,
      width: Math.max(1, maxX - minX + inset * 2),
      height: Math.max(1, maxY - minY + inset * 2),
    };
  }

  const fontSize = node.fontSize ?? 16;
  const estimatedWidth = Math.max(fontSize * 0.7, node.text.length * fontSize * 0.56);
  const estimatedHeight = fontSize * 1.2;
  const anchorOffset =
    node.textAnchor === 'middle' ? estimatedWidth / 2 : node.textAnchor === 'end' ? estimatedWidth : 0;
  const baselineOffset =
    node.dominantBaseline === 'middle' || node.dominantBaseline === 'central'
      ? estimatedHeight / 2
      : node.dominantBaseline === 'hanging'
        ? 0
        : estimatedHeight * 0.8;

  const rotated = rotateBounds(estimatedWidth, estimatedHeight, node.rotate?.angle ?? 0);

  return {
    x: node.x - anchorOffset - (rotated.width - estimatedWidth) / 2,
    y: node.y - baselineOffset - (rotated.height - estimatedHeight) / 2,
    width: Math.max(1, rotated.width),
    height: Math.max(1, rotated.height),
  };
}

export function getPreviewSceneContentBounds(scene: ConfiguratorPreviewScene, padding = 0): PreviewBounds {
  if (scene.nodes.length === 0) {
    return {
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of scene.nodes) {
    const bounds = getNodeBounds(node);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(scene.width, maxX + padding) - Math.max(0, minX - padding),
    height: Math.min(scene.height, maxY + padding) - Math.max(0, minY - padding),
  };
}

export function fitPreviewBoundsToViewport(
  bounds: PreviewBounds,
  viewportWidth: number,
  viewportHeight: number,
  sceneBounds?: PreviewBounds
): PreviewBounds {
  if (viewportWidth <= 0 || viewportHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return bounds;
  }

  const targetAspect = viewportWidth / viewportHeight;
  const currentAspect = bounds.width / bounds.height;

  let next = { ...bounds };

  if (targetAspect > currentAspect) {
    const targetWidth = bounds.height * targetAspect;
    const inset = (targetWidth - bounds.width) / 2;
    next = {
      x: bounds.x - inset,
      y: bounds.y,
      width: targetWidth,
      height: bounds.height,
    };
  } else {
    const targetHeight = bounds.width / targetAspect;
    const inset = (targetHeight - bounds.height) / 2;
    next = {
      x: bounds.x,
      y: bounds.y - inset,
      width: bounds.width,
      height: targetHeight,
    };
  }

  if (!sceneBounds) return next;

  const width = Math.min(next.width, sceneBounds.width);
  const height = Math.min(next.height, sceneBounds.height);
  const maxX = sceneBounds.x + sceneBounds.width - width;
  const maxY = sceneBounds.y + sceneBounds.height - height;

  return {
    x: Math.min(Math.max(sceneBounds.x, next.x), maxX),
    y: Math.min(Math.max(sceneBounds.y, next.y), maxY),
    width,
    height,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function pushAttribute(attributes: string[], key: string, value: string | number | undefined) {
  if (value === undefined || value === '') return;
  attributes.push(`${key}="${typeof value === 'number' ? formatNumber(value) : escapeXml(value)}"`);
}

function nodeDataAttributes(meta?: PreviewNodeMeta): string[] {
  const attributes: string[] = [];
  if (!meta) return attributes;
  pushAttribute(attributes, 'data-part-key', meta.partKey);
  pushAttribute(attributes, 'data-part-role', meta.partRole);
  pushAttribute(attributes, 'data-view-key', meta.viewKey);
  return attributes;
}

function serializeNode(node: PreviewNode, markerId: string): string {
  const attributes = nodeDataAttributes(node.meta);

  if (node.type === 'rect') {
    pushAttribute(attributes, 'x', node.x);
    pushAttribute(attributes, 'y', node.y);
    pushAttribute(attributes, 'width', node.width);
    pushAttribute(attributes, 'height', node.height);
    pushAttribute(attributes, 'fill', node.fill ?? 'none');
    pushAttribute(attributes, 'fill-opacity', node.fillOpacity);
    pushAttribute(attributes, 'stroke', node.stroke);
    pushAttribute(attributes, 'stroke-width', node.strokeWidth);
    pushAttribute(attributes, 'stroke-dasharray', node.dashArray);
    pushAttribute(attributes, 'rx', node.rx);
    pushAttribute(attributes, 'opacity', node.opacity);
    return `<rect ${attributes.join(' ')} />`;
  }

  if (node.type === 'line') {
    pushAttribute(attributes, 'x1', node.x1);
    pushAttribute(attributes, 'y1', node.y1);
    pushAttribute(attributes, 'x2', node.x2);
    pushAttribute(attributes, 'y2', node.y2);
    pushAttribute(attributes, 'stroke', node.stroke ?? TECHNICAL_PREVIEW_COLORS.panelStroke);
    pushAttribute(attributes, 'stroke-width', node.strokeWidth);
    pushAttribute(attributes, 'stroke-dasharray', node.dashArray);
    pushAttribute(attributes, 'stroke-linecap', node.strokeLinecap);
    pushAttribute(attributes, 'marker-start', node.markerStart ? `url(#${markerId})` : undefined);
    pushAttribute(attributes, 'marker-end', node.markerEnd ? `url(#${markerId})` : undefined);
    pushAttribute(attributes, 'opacity', node.opacity);
    return `<line ${attributes.join(' ')} />`;
  }

  pushAttribute(attributes, 'x', node.x);
  pushAttribute(attributes, 'y', node.y);
  pushAttribute(attributes, 'fill', node.fill ?? TECHNICAL_PREVIEW_COLORS.labelColor);
  pushAttribute(attributes, 'font-size', node.fontSize);
  pushAttribute(attributes, 'font-weight', node.fontWeight);
  pushAttribute(attributes, 'font-family', node.fontFamily ?? 'sans-serif');
  pushAttribute(attributes, 'text-anchor', node.textAnchor);
  pushAttribute(attributes, 'dominant-baseline', node.dominantBaseline);
  pushAttribute(
    attributes,
    'transform',
    node.rotate ? `rotate(${formatNumber(node.rotate.angle)}, ${formatNumber(node.rotate.cx)}, ${formatNumber(node.rotate.cy)})` : undefined
  );
  pushAttribute(attributes, 'letter-spacing', node.letterSpacing);
  pushAttribute(attributes, 'opacity', node.opacity);
  return `<text ${attributes.join(' ')}>${escapeXml(node.text)}</text>`;
}

function normalizeFileName(fileName: string): string {
  const trimmed = fileName.trim() || 'configurator-preview';
  return trimmed.endsWith('.svg') ? trimmed : `${trimmed}.svg`;
}

export function serializePreviewScene(
  scene: ConfiguratorPreviewScene,
  options: {
    markerId?: string;
    backgroundFill?: string | null;
  } = {}
): string {
  const markerId = options.markerId ?? 'cfg-preview-arrow';
  const backgroundFill = options.backgroundFill === undefined ? scene.backgroundFill ?? '#ffffff' : options.backgroundFill;
  const nodes = [
    backgroundFill
      ? `<rect x="0" y="0" width="${formatNumber(scene.width)}" height="${formatNumber(scene.height)}" fill="${escapeXml(backgroundFill)}" />`
      : '',
    ...scene.nodes.map((node) => serializeNode(node, markerId)),
  ]
    .filter(Boolean)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(scene.width)} ${formatNumber(scene.height)}" width="${formatNumber(scene.width)}" height="${formatNumber(scene.height)}">`,
    '  <defs>',
    `    <marker id="${escapeXml(markerId)}" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `      <path d="M 0 0 L 6 3 L 0 6 z" fill="${TECHNICAL_PREVIEW_COLORS.dimColor}" />`,
    '    </marker>',
    '  </defs>',
    nodes
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    '</svg>',
  ].join('\n');
}

export function downloadPreviewSceneAsSvg(scene: ConfiguratorPreviewScene, fileName?: string) {
  if (typeof window === 'undefined') return;

  const finalFileName = normalizeFileName(fileName ?? scene.exportFileName ?? 'configurator-preview');
  const svg = serializePreviewScene(scene);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');

  anchor.href = url;
  anchor.download = finalFileName;
  anchor.style.display = 'none';
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 2000);
}
