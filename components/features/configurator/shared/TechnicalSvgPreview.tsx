'use client';

import * as React from 'react';
import { Download, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConfiguratorPreviewScene, PreviewBounds, PreviewNode } from '@/lib/configurator/preview/scene';
import {
  downloadPreviewSceneAsSvg,
  fitPreviewBoundsToViewport,
  getPreviewSceneContentBounds,
  TECHNICAL_PREVIEW_COLORS,
} from '@/lib/configurator/preview/scene';

interface TechnicalSvgPreviewProps {
  scene: ConfiguratorPreviewScene;
  height?: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

function createSceneBounds(scene: ConfiguratorPreviewScene): PreviewBounds {
  return {
    x: 0,
    y: 0,
    width: scene.width,
    height: scene.height,
  };
}

function renderNode(node: PreviewNode, markerId: string, key: string) {
  const dataProps = {
    'data-part-key': node.meta?.partKey,
    'data-part-role': node.meta?.partRole,
    'data-view-key': node.meta?.viewKey,
  };

  if (node.type === 'rect') {
    return (
      <rect
        key={key}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={node.fill ?? 'none'}
        fillOpacity={node.fillOpacity}
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
        strokeDasharray={node.dashArray}
        rx={node.rx}
        opacity={node.opacity}
        {...dataProps}
      />
    );
  }

  if (node.type === 'line') {
    return (
      <line
        key={key}
        x1={node.x1}
        y1={node.y1}
        x2={node.x2}
        y2={node.y2}
        stroke={node.stroke ?? TECHNICAL_PREVIEW_COLORS.panelStroke}
        strokeWidth={node.strokeWidth}
        strokeDasharray={node.dashArray}
        markerStart={node.markerStart ? `url(#${markerId})` : undefined}
        markerEnd={node.markerEnd ? `url(#${markerId})` : undefined}
        strokeLinecap={node.strokeLinecap}
        opacity={node.opacity}
        {...dataProps}
      />
    );
  }

  return (
    <text
      key={key}
      x={node.x}
      y={node.y}
      fill={node.fill ?? TECHNICAL_PREVIEW_COLORS.labelColor}
      fontSize={node.fontSize}
      fontWeight={node.fontWeight}
      fontFamily={node.fontFamily ?? 'sans-serif'}
      textAnchor={node.textAnchor}
      dominantBaseline={node.dominantBaseline}
      letterSpacing={node.letterSpacing}
      opacity={node.opacity}
      transform={
        node.rotate ? `rotate(${node.rotate.angle}, ${node.rotate.cx}, ${node.rotate.cy})` : undefined
      }
      {...dataProps}
    >
      {node.text}
    </text>
  );
}

export const TechnicalSvgPreview = React.forwardRef<SVGSVGElement, TechnicalSvgPreviewProps>(
function TechnicalSvgPreview({ scene, height = 420 }, forwardedRef) {
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [frameMode, setFrameMode] = React.useState<'drawing' | 'scene'>('drawing');
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });
  const svgRef = React.useRef<SVGSVGElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const panStart = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const markerId = React.useId().replace(/:/g, '');

  const sceneBounds = React.useMemo(() => createSceneBounds(scene), [scene]);
  const contentBounds = React.useMemo(() => {
    const padding = Math.max(24, Math.max(scene.width, scene.height) * 0.025);
    return getPreviewSceneContentBounds(scene, padding);
  }, [scene]);
  const viewportWidth = viewportSize.width || scene.width;
  const viewportHeight = viewportSize.height || (isFullscreen ? scene.height : height);
  const fittedDrawingBounds = React.useMemo(
    () => fitPreviewBoundsToViewport(contentBounds, viewportWidth, viewportHeight, sceneBounds),
    [contentBounds, sceneBounds, viewportHeight, viewportWidth]
  );
  const activeBounds = frameMode === 'drawing' ? fittedDrawingBounds : sceneBounds;

  React.useEffect(() => {
    setFrameMode('drawing');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [scene.width, scene.height, scene.exportFileName]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const updateSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [isFullscreen]);

  React.useEffect(() => {
    if (!isFullscreen) return undefined;

    setFrameMode('drawing');
    setZoom(1);
    setPan({ x: 0, y: 0 });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const clampPan = React.useCallback(
    (nextX: number, nextY: number, nextZoom: number) => {
      const zoomedWidth = activeBounds.width / nextZoom;
      const zoomedHeight = activeBounds.height / nextZoom;

      return {
        x: Math.max(0, Math.min(activeBounds.width - zoomedWidth, nextX)),
        y: Math.max(0, Math.min(activeBounds.height - zoomedHeight, nextY)),
      };
    },
    [activeBounds.height, activeBounds.width]
  );

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const fracX = (event.clientX - rect.left) / rect.width;
      const fracY = (event.clientY - rect.top) / rect.height;

      setZoom((currentZoom) => {
        const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom + delta));

        setPan((currentPan) => {
          const previousWidth = activeBounds.width / currentZoom;
          const previousHeight = activeBounds.height / currentZoom;
          const nextWidth = activeBounds.width / nextZoom;
          const nextHeight = activeBounds.height / nextZoom;
          const svgX = currentPan.x + fracX * previousWidth;
          const svgY = currentPan.y + fracY * previousHeight;
          return clampPan(svgX - fracX * nextWidth, svgY - fracY * nextHeight, nextZoom);
        });

        return nextZoom;
      });
    },
    [activeBounds.height, activeBounds.width, clampPan]
  );

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (zoom <= 1) return;
      event.preventDefault();
      setIsPanning(true);
      panStart.current = {
        x: event.clientX,
        y: event.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [pan.x, pan.y, zoom]
  );

  const handleMouseMove = React.useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!isPanning) return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const deltaX = ((event.clientX - panStart.current.x) / rect.width) * (activeBounds.width / zoom);
      const deltaY = ((event.clientY - panStart.current.y) / rect.height) * (activeBounds.height / zoom);

      setPan(clampPan(panStart.current.panX - deltaX, panStart.current.panY - deltaY, zoom));
    },
    [activeBounds.height, activeBounds.width, clampPan, isPanning, zoom]
  );

  const stopPanning = React.useCallback(() => {
    setIsPanning(false);
  }, []);

  const zoomAroundCenter = React.useCallback(
    (delta: number) => {
      setZoom((currentZoom) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom + delta));
        setPan((currentPan) => {
          const previousWidth = activeBounds.width / currentZoom;
          const previousHeight = activeBounds.height / currentZoom;
          const nextWidth = activeBounds.width / nextZoom;
          const nextHeight = activeBounds.height / nextZoom;
          return clampPan(
            currentPan.x + (previousWidth - nextWidth) / 2,
            currentPan.y + (previousHeight - nextHeight) / 2,
            nextZoom
          );
        });
        return nextZoom;
      });
    },
    [activeBounds.height, activeBounds.width, clampPan]
  );

  const handleReset = React.useCallback(() => {
    setFrameMode('scene');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleFit = React.useCallback(() => {
    setFrameMode('drawing');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleDownload = React.useCallback(() => {
    downloadPreviewSceneAsSvg(scene);
  }, [scene]);

  const viewBox = `${activeBounds.x + pan.x} ${activeBounds.y + pan.y} ${activeBounds.width / zoom} ${activeBounds.height / zoom}`;
  const cursorStyle = zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default';
  const headerLabel = scene.subtitle ? `${scene.title ?? 'Technical Preview'} — ${scene.subtitle}` : scene.title ?? 'Technical Preview';
  const svgStyle = isFullscreen
    ? {
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        cursor: cursorStyle,
      }
    : {
        height,
        cursor: cursorStyle,
      };

  const toolbar = (
    <div className="flex items-center gap-1 justify-end">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => zoomAroundCenter(-ZOOM_STEP * 2)}
        disabled={zoom <= MIN_ZOOM}
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => zoomAroundCenter(ZOOM_STEP * 2)}
        disabled={zoom >= MAX_ZOOM}
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={handleReset}
        disabled={frameMode === 'scene' && zoom <= MIN_ZOOM}
        title="Reset to full canvas"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleFit}
        disabled={frameMode === 'drawing' && zoom <= MIN_ZOOM && pan.x === 0 && pan.y === 0}
        title="Fit to drawing"
      >
        Fit
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={handleDownload}
        title="Download SVG"
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => setIsFullscreen((current) => !current)}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );

  const svg = (
    <svg
      ref={(node) => {
        (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<SVGSVGElement | null>).current = node;
        }
      }}
      viewBox={viewBox}
      className="w-full border rounded bg-background"
      style={svgStyle}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopPanning}
      onMouseLeave={stopPanning}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 6 6"
          refX="3"
          refY="3"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" fill={TECHNICAL_PREVIEW_COLORS.dimColor} />
        </marker>
      </defs>
      {scene.backgroundFill ? (
        <rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.backgroundFill} />
      ) : null}
      {scene.nodes.map((node, index) =>
        renderNode(node, markerId, node.id ?? `${node.type}-${index}`)
      )}
    </svg>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-medium text-muted-foreground">{headerLabel}</span>
          {toolbar}
        </div>
        <div ref={viewportRef} className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <div className="w-full h-full flex items-center justify-center">{svg}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden">
      <div className="mb-2" data-capture-exclude="true">{toolbar}</div>
      <div ref={viewportRef}>{svg}</div>
    </div>
  );
});

TechnicalSvgPreview.displayName = 'TechnicalSvgPreview';
