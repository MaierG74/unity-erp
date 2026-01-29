'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Move } from 'lucide-react';
import type { CropParams, ArrowAnnotation } from '@/types/image-editor';

interface ArrowAnnotatorProps {
  imageUrl: string;
  cropParams: CropParams | null;
  annotations: ArrowAnnotation[];
  onAnnotationsChange: (annotations: ArrowAnnotation[]) => void;
}

const ARROW_COLOR = '#FF0000';
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 450;
const LABEL_FONT = 'bold 14px "Helvetica Neue", Helvetica, Arial, sans-serif';
const LABEL_HIT_RADIUS = 20;

interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getLabelPos(ann: ArrowAnnotation, rect: DrawRect) {
  const lx = rect.x + (ann.labelX != null ? ann.labelX : (ann.x1 + ann.x2) / 2) * rect.width;
  const ly = rect.y + (ann.labelY != null ? ann.labelY : (ann.y1 + ann.y2) / 2 - 0.05) * rect.height;
  return { lx, ly };
}

function drawArrowOnCtx(
  ctx: CanvasRenderingContext2D,
  ann: ArrowAnnotation,
  rect: DrawRect,
  highlight?: boolean,
) {
  const color = ann.color || ARROW_COLOR;
  const x1 = rect.x + ann.x1 * rect.width;
  const y1 = rect.y + ann.y1 * rect.height;
  const x2 = rect.x + ann.x2 * rect.width;
  const y2 = rect.y + ann.y2 * rect.height;

  const headLen = 14;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();

  if (ann.label) {
    const { lx, ly } = getLabelPos(ann, rect);

    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(ann.label);
    const padX = 6;
    const padY = 4;
    const boxW = metrics.width + padX * 2;
    const boxH = 18 + padY * 2;

    const bgColor = highlight ? 'rgba(59, 130, 246, 0.9)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(lx - boxW / 2, ly - boxH / 2, boxW, boxH, 4);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(ann.label, lx, ly);
  }
}

type Mode = 'idle' | 'drawing' | 'dragging-label';

export default function ArrowAnnotator({
  imageUrl,
  cropParams,
  annotations,
  onAnnotationsChange,
}: ArrowAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawRectRef = useRef<DrawRect>({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

  const [mode, setMode] = useState<Mode>('idle');
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelText, setLabelText] = useState('');

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      redraw();
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#374151';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Calculate source and destination rectangles
    let srcX = 0, srcY = 0, srcW = img.naturalWidth, srcH = img.naturalHeight;
    if (cropParams) {
      srcX = cropParams.x;
      srcY = cropParams.y;
      srcW = cropParams.width;
      srcH = cropParams.height;
    }

    // Calculate draw rectangle maintaining aspect ratio
    const srcAspect = srcW / srcH;
    const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;

    let drawW: number, drawH: number, drawX: number, drawY: number;

    if (srcAspect > canvasAspect) {
      // Image is wider — fit to width, letterbox top/bottom
      drawW = CANVAS_WIDTH;
      drawH = CANVAS_WIDTH / srcAspect;
      drawX = 0;
      drawY = (CANVAS_HEIGHT - drawH) / 2;
    } else {
      // Image is taller — fit to height, letterbox left/right
      drawH = CANVAS_HEIGHT;
      drawW = CANVAS_HEIGHT * srcAspect;
      drawX = (CANVAS_WIDTH - drawW) / 2;
      drawY = 0;
    }

    drawRectRef.current = { x: drawX, y: drawY, width: drawW, height: drawH };

    ctx.drawImage(img, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);

    const rect = drawRectRef.current;

    for (const ann of annotations) {
      drawArrowOnCtx(ctx, ann, rect, ann.id === draggingId);
    }

    if (drawStart && drawEnd) {
      const tempAnn: ArrowAnnotation = {
        type: 'arrow',
        id: 'temp',
        x1: drawStart.x,
        y1: drawStart.y,
        x2: drawEnd.x,
        y2: drawEnd.y,
      };
      drawArrowOnCtx(ctx, tempAnn, rect);
    }
  }, [cropParams, annotations, drawStart, drawEnd, draggingId]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Convert canvas pixel coords to normalized (0-1) coords relative to image area
  const canvasToNormalized = (px: number, py: number): { x: number; y: number } | null => {
    const rect = drawRectRef.current;
    const x = (px - rect.x) / rect.width;
    const y = (py - rect.y) / rect.height;
    // Allow slightly outside for easier edge targeting
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvasEl = canvasRef.current!;
    const domRect = canvasEl.getBoundingClientRect();
    return {
      px: ((e.clientX - domRect.left) / domRect.width) * CANVAS_WIDTH,
      py: ((e.clientY - domRect.top) / domRect.height) * CANVAS_HEIGHT,
    };
  };

  const findLabelAt = (px: number, py: number): ArrowAnnotation | null => {
    const rect = drawRectRef.current;
    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (!ann.label) continue;
      const { lx, ly } = getLabelPos(ann, rect);
      const dist = Math.sqrt((px - lx) ** 2 + (py - ly) ** 2);
      if (dist < LABEL_HIT_RADIUS + ann.label.length * 3) return ann;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = getCanvasCoords(e);

    if (mode === 'drawing') {
      const norm = canvasToNormalized(px, py);
      if (norm) {
        setDrawStart(norm);
        setDrawEnd(norm);
      }
      return;
    }

    if (mode === 'idle') {
      const hit = findLabelAt(px, py);
      if (hit) {
        setMode('dragging-label');
        setDraggingId(hit.id);
        return;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = getCanvasCoords(e);

    if (mode === 'drawing' && drawStart) {
      const norm = canvasToNormalized(px, py);
      if (norm) setDrawEnd(norm);
      return;
    }

    if (mode === 'dragging-label' && draggingId) {
      const norm = canvasToNormalized(px, py);
      if (norm) {
        onAnnotationsChange(
          annotations.map(a =>
            a.id === draggingId ? { ...a, labelX: norm.x, labelY: norm.y } : a,
          ),
        );
      }
      return;
    }

    if (mode === 'idle' && canvasRef.current) {
      const hit = findLabelAt(px, py);
      canvasRef.current.style.cursor = hit ? 'grab' : 'default';
    }
  };

  const handleMouseUp = () => {
    if (mode === 'dragging-label') {
      setMode('idle');
      setDraggingId(null);
      return;
    }

    if (mode !== 'drawing' || !drawStart || !drawEnd) return;

    const dx = (drawEnd.x - drawStart.x) * drawRectRef.current.width;
    const dy = (drawEnd.y - drawStart.y) * drawRectRef.current.height;
    if (Math.sqrt(dx * dx + dy * dy) < 10) {
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }

    const newId = crypto.randomUUID();
    const newArrow: ArrowAnnotation = {
      type: 'arrow',
      id: newId,
      x1: drawStart.x,
      y1: drawStart.y,
      x2: drawEnd.x,
      y2: drawEnd.y,
    };

    onAnnotationsChange([...annotations, newArrow]);
    setDrawStart(null);
    setDrawEnd(null);
    setMode('idle');
    setEditingLabelId(newId);
    setLabelText('');
  };

  const handleDeleteAnnotation = (id: string) => {
    onAnnotationsChange(annotations.filter(a => a.id !== id));
  };

  const handleSaveLabel = (id: string) => {
    onAnnotationsChange(
      annotations.map(a =>
        a.id === id ? { ...a, label: labelText || undefined } : a,
      ),
    );
    setEditingLabelId(null);
    setLabelText('');
  };

  const cursorClass =
    mode === 'drawing' ? 'cursor-crosshair' :
    mode === 'dragging-label' ? 'cursor-grabbing' :
    'cursor-default';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={mode === 'drawing' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode(mode === 'drawing' ? 'idle' : 'drawing')}
        >
          <Plus size={16} className="mr-1" />
          {mode === 'drawing' ? 'Drawing... (click & drag)' : 'Add Arrow'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
          {annotations.some(a => a.label) && ' — drag labels to reposition'}
        </span>
      </div>

      <div className="border rounded-lg overflow-hidden bg-muted">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className={`w-full ${cursorClass}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (drawStart) {
              setDrawStart(null);
              setDrawEnd(null);
            }
            if (mode === 'dragging-label') {
              setMode('idle');
              setDraggingId(null);
            }
          }}
        />
      </div>

      {annotations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Annotations</h4>
          {annotations.map((ann, i) => (
            <div key={ann.id} className="flex items-center gap-2 p-2 border rounded bg-muted/20">
              <span className="text-sm font-medium w-8">#{i + 1}</span>
              {editingLabelId === ann.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={labelText}
                    onChange={(e) => setLabelText(e.target.value)}
                    placeholder="Label (optional)"
                    className="h-8 text-sm"
                    maxLength={30}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveLabel(ann.id);
                      if (e.key === 'Escape') { setEditingLabelId(null); setLabelText(''); }
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => handleSaveLabel(ann.id)}>
                    Save
                  </Button>
                </div>
              ) : (
                <span
                  className="text-sm flex-1 cursor-pointer hover:underline"
                  onClick={() => { setEditingLabelId(ann.id); setLabelText(ann.label || ''); }}
                >
                  {ann.label || '(no label — click to add)'}
                </span>
              )}
              {ann.label && (
                <span title="Drag label on canvas to reposition">
                  <Move size={14} className="text-muted-foreground" />
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteAnnotation(ann.id)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
