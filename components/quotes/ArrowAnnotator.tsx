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
const LABEL_HIT_RADIUS = 20; // pixels — how close a click needs to be to grab a label

function getLabelPos(ann: ArrowAnnotation, w: number, h: number) {
  const lx = ann.labelX != null ? ann.labelX * w : ((ann.x1 + ann.x2) / 2) * w;
  const ly = ann.labelY != null ? ann.labelY * h : ((ann.y1 + ann.y2) / 2) * h - 16;
  return { lx, ly };
}

function drawArrowOnCtx(
  ctx: CanvasRenderingContext2D,
  ann: ArrowAnnotation,
  w: number,
  h: number,
  highlight?: boolean,
) {
  const color = ann.color || ARROW_COLOR;
  const x1 = ann.x1 * w;
  const y1 = ann.y1 * h;
  const x2 = ann.x2 * w;
  const y2 = ann.y2 * h;

  const headLen = 14;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  // Line
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
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

  // Label
  if (ann.label) {
    const { lx, ly } = getLabelPos(ann, w, h);

    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Measure for background pill
    const metrics = ctx.measureText(ann.label);
    const padX = 6;
    const padY = 4;
    const boxW = metrics.width + padX * 2;
    const boxH = 18 + padY * 2;

    // Background pill
    const bgColor = highlight ? 'rgba(59, 130, 246, 0.9)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(lx - boxW / 2, ly - boxH / 2, boxW, boxH, 4);
    ctx.fill();

    // Text
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

  const [mode, setMode] = useState<Mode>('idle');
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelText, setLabelText] = useState('');

  // Load image
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

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw cropped region or full image
    if (cropParams) {
      ctx.drawImage(
        img,
        cropParams.x, cropParams.y, cropParams.width, cropParams.height,
        0, 0, CANVAS_WIDTH, CANVAS_HEIGHT,
      );
    } else {
      ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Draw existing annotations
    for (const ann of annotations) {
      drawArrowOnCtx(ctx, ann, CANVAS_WIDTH, CANVAS_HEIGHT, ann.id === draggingId);
    }

    // Draw in-progress arrow
    if (drawStart && drawEnd) {
      const tempAnn: ArrowAnnotation = {
        type: 'arrow',
        id: 'temp',
        x1: drawStart.x / CANVAS_WIDTH,
        y1: drawStart.y / CANVAS_HEIGHT,
        x2: drawEnd.x / CANVAS_WIDTH,
        y2: drawEnd.y / CANVAS_HEIGHT,
      };
      drawArrowOnCtx(ctx, tempAnn, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }, [cropParams, annotations, drawStart, drawEnd, draggingId]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  // Find a label near the given canvas coords
  const findLabelAt = (px: number, py: number): ArrowAnnotation | null => {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (!ann.label) continue;
      const { lx, ly } = getLabelPos(ann, CANVAS_WIDTH, CANVAS_HEIGHT);
      const dist = Math.sqrt((px - lx) ** 2 + (py - ly) ** 2);
      if (dist < LABEL_HIT_RADIUS + ann.label.length * 3) return ann;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    if (mode === 'drawing') {
      setDrawStart(coords);
      setDrawEnd(coords);
      return;
    }

    // Check if clicking on a label to drag it
    if (mode === 'idle') {
      const hit = findLabelAt(coords.x, coords.y);
      if (hit) {
        setMode('dragging-label');
        setDraggingId(hit.id);
        return;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    if (mode === 'drawing' && drawStart) {
      setDrawEnd(coords);
      return;
    }

    if (mode === 'dragging-label' && draggingId) {
      onAnnotationsChange(
        annotations.map(a =>
          a.id === draggingId
            ? { ...a, labelX: coords.x / CANVAS_WIDTH, labelY: coords.y / CANVAS_HEIGHT }
            : a,
        ),
      );
      return;
    }

    // Update cursor based on hover
    if (mode === 'idle' && canvasRef.current) {
      const hit = findLabelAt(coords.x, coords.y);
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

    // Only create if the arrow has meaningful length
    const dx = drawEnd.x - drawStart.x;
    const dy = drawEnd.y - drawStart.y;
    if (Math.sqrt(dx * dx + dy * dy) < 10) {
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }

    const newId = crypto.randomUUID();
    const newArrow: ArrowAnnotation = {
      type: 'arrow',
      id: newId,
      x1: drawStart.x / CANVAS_WIDTH,
      y1: drawStart.y / CANVAS_HEIGHT,
      x2: drawEnd.x / CANVAS_WIDTH,
      y2: drawEnd.y / CANVAS_HEIGHT,
    };

    onAnnotationsChange([...annotations, newArrow]);
    setDrawStart(null);
    setDrawEnd(null);
    setMode('idle');
    // Open label editor for the new arrow
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

      {/* Annotation list */}
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
