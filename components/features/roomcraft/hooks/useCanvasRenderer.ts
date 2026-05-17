import { useEffect, useCallback } from 'react';
import type { Room, Opening, Wall, DisplayUnit, RoomItem } from '../types/room';
import type { FloorPlan, SharedOpening, Layer } from '../types/floorPlan';
import { roomToCanvas } from '../utils/scale';
import { footprintAABB, anchorPlanPosition } from '../utils/blocks';
import { computeSoftWarnings } from '../utils/blockValidation';
import { getWallSegments, getWallOpenings } from '../utils/openings';
import { getWallOverlaps, orientOverlapTo, type WallOverlap } from '../utils/adjacency';
import { getFloorPlanBounds } from '../utils/floorPlan';
import { arcSweepCounterclockwise } from '../utils/doorArc';
import { computeWallSegments, type WallSegmentItem } from '../utils/wallSegments';
import { formatDisplay } from '../utils/units';
import { COLORS, CANVAS, GRID, MEASUREMENT } from '../constants/theme';
import { useHeatmapData } from './useHeatmapData';
import { clearanceToColor } from '../utils/heatmap';
import { renderIsometricView, drawIsoRotateButton } from './useIsometricRenderer';
import type { ProjectPiece } from '@/lib/roomcraft/types';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

interface ViewState {
  scale: number;
  offset: { x: number; y: number };
}

const NON_ACTIVE_ALPHA = 0.3;

interface GhostInfo {
  x: number;
  y: number;
  length: number;
  depth: number;
  valid: boolean;
}

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  floorPlan: FloorPlan | null,
  activeRoomId: string | null,
  viewState: ViewState,
  selectedOpeningId?: string | null,
  selectedSharedOpeningId?: string | null,
  selectedBlockId: string | null = null,
  displayUnit: DisplayUnit = 'mm',
  ghost: GhostInfo | null = null,
  showHeatmap: boolean = false,
  showIsometric: boolean = false,
  cameraFlipped: boolean = false,
  pieceMap: Map<string, ProjectPiece> = new Map(),
) {
  const heatmapData = useHeatmapData(floorPlan, showHeatmap);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = COLORS.canvasBackground;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (showIsometric && floorPlan && activeRoomId) {
      const activePlaced = floorPlan.rooms.find((p) => p.room.id === activeRoomId);
      if (activePlaced) {
        renderIsometricView(ctx, activePlaced.room, floorPlan.layers, rect.width, rect.height, cameraFlipped, pieceMap);
        drawIsoRotateButton(ctx);
      }
      return;
    }

    if (!floorPlan || floorPlan.rooms.length === 0) {
      ctx.fillStyle = '#9CA3AF';
      ctx.font = '16px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Enter room dimensions and click "Build Room"', rect.width / 2, rect.height / 2);
    } else {
      const { scale, offset } = viewState;
      const bounds = getFloorPlanBounds(floorPlan);

      const rawOverlaps = floorPlan.sharedOpenings.length > 0 ? getWallOverlaps(floorPlan) : [];

      // Build overlap lookup map keyed by "${anchorRoomId}::${anchorWallId}" for O(1) access.
      const overlapByAnchor = new Map<string, WallOverlap>();
      for (const overlap of rawOverlaps) {
        // Store once for roomA as anchor, once for roomB as anchor (each with correct orientation).
        const keyA = `${overlap.roomA.room.id}::${overlap.wallA.id}`;
        overlapByAnchor.set(keyA, overlap);
        const keyB = `${overlap.roomB.room.id}::${overlap.wallB.id}`;
        overlapByAnchor.set(keyB, orientOverlapTo(overlap, overlap.roomB.room.id)!);
      }

      drawFloorPlanGrid(ctx, bounds, scale, offset, rect.width, rect.height);

      for (const placed of floorPlan.rooms) {
        const isActive = placed.room.id === activeRoomId;
        ctx.save();
        ctx.globalAlpha = isActive ? 1 : NON_ACTIVE_ALPHA;
        drawRoom(
          ctx,
          placed.room,
          placed.position,
          scale,
          offset,
          isActive ? selectedOpeningId ?? null : null,
          floorPlan.sharedOpenings,
          rawOverlaps,
        );
        if (showHeatmap) {
          const grid = heatmapData.get(placed.room.id);
          if (grid) {
            ctx.globalAlpha = (isActive ? 1 : NON_ACTIVE_ALPHA) * 0.45;
            const cellSizePx = 200 * scale;
            for (let row = 0; row < grid.rows; row++) {
              for (let col = 0; col < grid.cols; col++) {
                const val = grid.data[row * grid.cols + col];
                if (val === -1) continue;
                const px = roomToCanvas(
                  placed.position.x + col * 200,
                  placed.position.y + row * 200,
                  scale,
                  offset,
                );
                ctx.fillStyle = clearanceToColor(val);
                ctx.fillRect(px.x, px.y, cellSizePx, cellSizePx);
              }
            }
            ctx.globalAlpha = isActive ? 1 : NON_ACTIVE_ALPHA;
          }
        }
        drawBlocks(ctx, placed.room, placed.position, floorPlan.layers, selectedBlockId, scale, offset, floorPlan, pieceMap);
        if (placed.locked) {
          const topLeftCanvas = roomToCanvas(placed.position.x, placed.position.y, scale, offset);
          // Fixed ~6px padding from the room's interior top-left corner.
          drawLockedPadlock(ctx, topLeftCanvas.x + 6, topLeftCanvas.y + 6);
        }
        ctx.restore();
      }

      // Ghost block — drawn after all rooms at full alpha, before shared openings.
      if (ghost !== null) {
        const fill = ghost.valid ? 'rgba(34, 197, 94, 0.30)' : 'rgba(239, 68, 68, 0.40)';
        const stroke = ghost.valid ? '#16a34a' : '#dc2626';
        const px = roomToCanvas(ghost.x, ghost.y, scale, offset);
        const pw = ghost.length * scale;
        const ph = ghost.depth * scale;
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(px.x, px.y, pw, ph);
        ctx.strokeRect(px.x, px.y, pw, ph);
        ctx.setLineDash([]);
      }

      // Shared-opening pass — full alpha, one symbol per shared opening.
      for (const shared of floorPlan.sharedOpenings) {
        drawSharedOpening(ctx, shared, overlapByAnchor, scale, offset, selectedSharedOpeningId ?? null);
      }

      // Measurement pass — selected room only, drawn below shared-opening layer and below compass.
      if (activeRoomId) {
        const activePlaced = floorPlan.rooms.find((p) => p.room.id === activeRoomId);
        if (activePlaced) {
          drawWallMeasurements(ctx, activePlaced.room, activePlaced.position, scale, offset, floorPlan, rawOverlaps, displayUnit);
        }
      }
    }

    // Draw compass rose last so it sits on top of everything
    drawCompassRose(ctx, rect.width);
    if (showHeatmap && floorPlan && floorPlan.rooms.length > 0) {
      drawHeatmapLegend(ctx, rect.width);
    }
  }, [canvasRef, floorPlan, activeRoomId, viewState, selectedOpeningId, selectedSharedOpeningId, displayUnit, selectedBlockId, ghost, heatmapData, showHeatmap, showIsometric, cameraFlipped, pieceMap]);

  useEffect(() => {
    draw();
  }, [draw]);

  return { redraw: draw };
}

interface WallGeometry {
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
}

function getWallGeometry(
  wall: Wall,
  roomOrigin: { x: number; y: number },
  roomLength: number,
  roomWidth: number,
  scale: number,
  offset: { x: number; y: number },
): WallGeometry {
  const tl = roomToCanvas(roomOrigin.x, roomOrigin.y, scale, offset);
  switch (wall.side) {
    case 'north':
      return { startX: tl.x, startY: tl.y, dx: 1, dy: 0, nx: 0, ny: 1 };
    case 'south':
      return { startX: tl.x, startY: tl.y + roomWidth * scale, dx: 1, dy: 0, nx: 0, ny: -1 };
    case 'west':
      return { startX: tl.x, startY: tl.y, dx: 0, dy: 1, nx: 1, ny: 0 };
    case 'east':
      return { startX: tl.x + roomLength * scale, startY: tl.y, dx: 0, dy: 1, nx: -1, ny: 0 };
  }
}

function drawRoom(
  ctx: CanvasRenderingContext2D,
  room: Room,
  roomOrigin: { x: number; y: number },
  scale: number,
  offset: { x: number; y: number },
  selectedOpeningId: string | null,
  sharedOpenings: SharedOpening[],
  overlaps: WallOverlap[],
) {
  const topLeft = roomToCanvas(roomOrigin.x, roomOrigin.y, scale, offset);
  const roomW = room.dimensions.length * scale;
  const roomH = room.dimensions.width * scale;

  ctx.fillStyle = COLORS.roomInterior;
  ctx.fillRect(topLeft.x, topLeft.y, roomW, roomH);

  // Build wallId → localStart map for overlaps affecting this room.
  const wallIdToLocalStart: Record<string, number> = {};
  for (const o of overlaps) {
    if (o.roomA.room.id === room.id) wallIdToLocalStart[o.wallA.id] = o.startA;
    if (o.roomB.room.id === room.id) wallIdToLocalStart[o.wallB.id] = o.startB;
  }

  for (const wall of room.walls) {
    drawWallWithOpenings(
      ctx, wall, room, roomOrigin, scale, offset, selectedOpeningId,
      sharedOpenings, wallIdToLocalStart,
    );
  }

  drawOriginMarker(ctx, topLeft);
  drawRoomLabel(ctx, room, topLeft, roomW, roomH);
}

function drawWallWithOpenings(
  ctx: CanvasRenderingContext2D,
  wall: Wall,
  room: Room,
  roomOrigin: { x: number; y: number },
  scale: number,
  offset: { x: number; y: number },
  selectedOpeningId: string | null,
  sharedOpenings: SharedOpening[],
  wallIdToLocalStart: Record<string, number>,
) {
  const geo = getWallGeometry(wall, roomOrigin, room.dimensions.length, room.dimensions.width, scale, offset);
  const segments = getWallSegments(wall, room.openings, {
    sharedOpenings,
    wallIdToLocalStart,
    currentRoomId: room.id,
    currentWallId: wall.id,
  });

  ctx.strokeStyle = COLORS.wallStroke;
  ctx.lineWidth = CANVAS.wallThickness;

  for (const seg of segments) {
    const x1 = geo.startX + seg.start * scale * geo.dx;
    const y1 = geo.startY + seg.start * scale * geo.dy;
    const x2 = geo.startX + seg.end * scale * geo.dx;
    const y2 = geo.startY + seg.end * scale * geo.dy;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  const wallOpenings = getWallOpenings(room.openings, wall.id);
  for (const opening of wallOpenings) {
    const isSelected = opening.id === selectedOpeningId;
    drawOpeningSymbol(ctx, opening, geo, scale, isSelected);
  }
}

function drawOpeningSymbol(
  ctx: CanvasRenderingContext2D,
  opening: Opening,
  geo: WallGeometry,
  scale: number,
  isSelected: boolean,
) {
  const color = isSelected ? COLORS.openingSelected : COLORS.openingSymbol;
  const leftEdgeX = geo.startX + opening.position * scale * geo.dx;
  const leftEdgeY = geo.startY + opening.position * scale * geo.dy;
  const widthPx = opening.width * scale;
  const rightEdgeX = leftEdgeX + widthPx * geo.dx;
  const rightEdgeY = leftEdgeY + widthPx * geo.dy;
  const tickSize = 6;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftEdgeX - tickSize * geo.nx, leftEdgeY - tickSize * geo.ny);
  ctx.lineTo(leftEdgeX + tickSize * geo.nx, leftEdgeY + tickSize * geo.ny);
  ctx.moveTo(rightEdgeX - tickSize * geo.nx, rightEdgeY - tickSize * geo.ny);
  ctx.lineTo(rightEdgeX + tickSize * geo.nx, rightEdgeY + tickSize * geo.ny);
  ctx.stroke();

  if (opening.type === 'door') {
    drawDoorSymbol(ctx, opening, geo, scale, color);
  } else if (opening.type === 'double-door') {
    drawDoubleDoorSymbol(ctx, opening, geo, scale, color);
  } else if (opening.type === 'window') {
    drawWindowSymbol(ctx, opening, geo, scale, color);
  }

  const midX = (leftEdgeX + rightEdgeX) / 2;
  const midY = (leftEdgeY + rightEdgeY) / 2;
  const labelOffset = 20;
  ctx.fillStyle = COLORS.openingDimLabel;
  ctx.font = CANVAS.labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${opening.width}`,
    midX - geo.nx * labelOffset,
    midY - geo.ny * labelOffset,
  );
}

function drawDoorSymbol(
  ctx: CanvasRenderingContext2D,
  opening: Opening,
  geo: WallGeometry,
  scale: number,
  color: string,
) {
  const widthPx = opening.width * scale;
  const leftEdgeX = geo.startX + opening.position * scale * geo.dx;
  const leftEdgeY = geo.startY + opening.position * scale * geo.dy;
  const rightEdgeX = leftEdgeX + widthPx * geo.dx;
  const rightEdgeY = leftEdgeY + widthPx * geo.dy;

  const isLeft = opening.hingeSide !== 'right';
  const isInward = opening.swingDirection !== 'outward';
  const normalDir = isInward ? 1 : -1;

  const hingeX = isLeft ? leftEdgeX : rightEdgeX;
  const hingeY = isLeft ? leftEdgeY : rightEdgeY;
  const swingEndX = hingeX + geo.nx * widthPx * normalDir;
  const swingEndY = hingeY + geo.ny * widthPx * normalDir;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hingeX, hingeY);
  ctx.lineTo(swingEndX, swingEndY);
  ctx.stroke();

  const radius = widthPx;
  const wallAngle = Math.atan2(geo.dy, geo.dx);
  const normalAngle = Math.atan2(geo.ny * normalDir, geo.nx * normalDir);

  let startAngle: number;
  let endAngle: number;
  if (isLeft) {
    startAngle = wallAngle;
    endAngle = normalAngle;
  } else {
    startAngle = normalAngle;
    endAngle = wallAngle + Math.PI;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(hingeX, hingeY, radius, startAngle, endAngle, arcSweepCounterclockwise(geo, normalDir));
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDoubleDoorSymbol(
  ctx: CanvasRenderingContext2D,
  opening: Opening,
  geo: WallGeometry,
  scale: number,
  color: string,
) {
  const widthPx = opening.width * scale;
  const halfWidthPx = widthPx / 2;
  const leftEdgeX = geo.startX + opening.position * scale * geo.dx;
  const leftEdgeY = geo.startY + opening.position * scale * geo.dy;
  const rightEdgeX = leftEdgeX + widthPx * geo.dx;
  const rightEdgeY = leftEdgeY + widthPx * geo.dy;

  const isInward = opening.swingDirection !== 'outward';
  const normalDir = isInward ? 1 : -1;

  const leftSwingEndX = leftEdgeX + geo.nx * halfWidthPx * normalDir;
  const leftSwingEndY = leftEdgeY + geo.ny * halfWidthPx * normalDir;
  const rightSwingEndX = rightEdgeX + geo.nx * halfWidthPx * normalDir;
  const rightSwingEndY = rightEdgeY + geo.ny * halfWidthPx * normalDir;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftEdgeX, leftEdgeY);
  ctx.lineTo(leftSwingEndX, leftSwingEndY);
  ctx.moveTo(rightEdgeX, rightEdgeY);
  ctx.lineTo(rightSwingEndX, rightSwingEndY);
  ctx.stroke();

  const radius = halfWidthPx;
  const wallAngle = Math.atan2(geo.dy, geo.dx);
  const normalAngle = Math.atan2(geo.ny * normalDir, geo.nx * normalDir);
  const counterclockwise = arcSweepCounterclockwise(geo, normalDir);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(leftEdgeX, leftEdgeY, radius, wallAngle, normalAngle, counterclockwise);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rightEdgeX, rightEdgeY, radius, normalAngle, wallAngle + Math.PI, counterclockwise);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWindowSymbol(
  ctx: CanvasRenderingContext2D,
  opening: Opening,
  geo: WallGeometry,
  scale: number,
  color: string,
) {
  const widthPx = opening.width * scale;
  const leftEdgeX = geo.startX + opening.position * scale * geo.dx;
  const leftEdgeY = geo.startY + opening.position * scale * geo.dy;
  const lineSpacing = 3;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  for (let i = -1; i <= 1; i++) {
    const offsetX = geo.nx * lineSpacing * i;
    const offsetY = geo.ny * lineSpacing * i;
    ctx.beginPath();
    ctx.moveTo(leftEdgeX + offsetX, leftEdgeY + offsetY);
    ctx.lineTo(
      leftEdgeX + widthPx * geo.dx + offsetX,
      leftEdgeY + widthPx * geo.dy + offsetY,
    );
    ctx.stroke();
  }

  const capOffsetX = geo.nx * lineSpacing;
  const capOffsetY = geo.ny * lineSpacing;
  ctx.beginPath();
  ctx.moveTo(leftEdgeX - capOffsetX, leftEdgeY - capOffsetY);
  ctx.lineTo(leftEdgeX + capOffsetX, leftEdgeY + capOffsetY);
  ctx.moveTo(
    leftEdgeX + widthPx * geo.dx - capOffsetX,
    leftEdgeY + widthPx * geo.dy - capOffsetY,
  );
  ctx.lineTo(
    leftEdgeX + widthPx * geo.dx + capOffsetX,
    leftEdgeY + widthPx * geo.dy + capOffsetY,
  );
  ctx.stroke();
}

function drawFloorPlanGrid(
  ctx: CanvasRenderingContext2D,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  scale: number,
  offset: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number,
) {
  const spacing = GRID.defaultSpacing;
  const topLeft = roomToCanvas(bounds.minX, bounds.minY, scale, offset);
  const planW = (bounds.maxX - bounds.minX) * scale;
  const planH = (bounds.maxY - bounds.minY) * scale;

  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;

  for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
    const canvasX = topLeft.x + (x - bounds.minX) * scale;
    if (canvasX < 0 || canvasX > canvasWidth) continue;
    ctx.beginPath();
    ctx.moveTo(canvasX, topLeft.y);
    ctx.lineTo(canvasX, topLeft.y + planH);
    ctx.stroke();
  }

  for (let y = bounds.minY; y <= bounds.maxY; y += spacing) {
    const canvasY = topLeft.y + (y - bounds.minY) * scale;
    if (canvasY < 0 || canvasY > canvasHeight) continue;
    ctx.beginPath();
    ctx.moveTo(topLeft.x, canvasY);
    ctx.lineTo(topLeft.x + planW, canvasY);
    ctx.stroke();
  }
}

function drawOriginMarker(ctx: CanvasRenderingContext2D, topLeft: { x: number; y: number }) {
  const size = 8;
  ctx.strokeStyle = '#EF4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(topLeft.x - size, topLeft.y);
  ctx.lineTo(topLeft.x + size, topLeft.y);
  ctx.moveTo(topLeft.x, topLeft.y - size);
  ctx.lineTo(topLeft.x, topLeft.y + size);
  ctx.stroke();
}

function drawWallMeasurements(
  ctx: CanvasRenderingContext2D,
  room: Room,
  roomOrigin: { x: number; y: number },
  scale: number,
  offset: { x: number; y: number },
  floorPlan: FloorPlan,
  overlaps: WallOverlap[],
  unit: DisplayUnit,
) {
  const wallIdToLocalStart: Record<string, number> = {};
  for (const o of overlaps) {
    if (o.roomA.room.id === room.id) wallIdToLocalStart[o.wallA.id] = o.startA;
    if (o.roomB.room.id === room.id) wallIdToLocalStart[o.wallB.id] = o.startB;
  }

  for (const wall of room.walls) {
    const items: WallSegmentItem[] = [];

    for (const opening of room.openings) {
      if (opening.wallId === wall.id) {
        items.push({ positionMm: opening.position, widthMm: opening.width });
      }
    }

    const localStart = wallIdToLocalStart[wall.id];
    if (localStart !== undefined) {
      for (const shared of floorPlan.sharedOpenings) {
        if (shared.anchorRoomId === room.id && shared.anchorWallId === wall.id) {
          items.push({ positionMm: shared.position + localStart, widthMm: shared.width });
        } else if (shared.partnerRoomId === room.id && shared.partnerWallId === wall.id) {
          items.push({ positionMm: shared.position + localStart, widthMm: shared.width });
        }
      }
    }

    const segments = computeWallSegments(wall.length, items);
    const geo = getWallGeometry(wall, roomOrigin, room.dimensions.length, room.dimensions.width, scale, offset);

    ctx.fillStyle = COLORS.wallSegmentLabel;
    ctx.font = CANVAS.labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const seg of segments) {
      if (seg.type === 'opening') continue;
      if (seg.lengthMm < MEASUREMENT.minLabelMm) continue;

      const midMm = seg.startMm + seg.lengthMm / 2;
      const midX = geo.startX + midMm * scale * geo.dx;
      const midY = geo.startY + midMm * scale * geo.dy;
      const labelX = midX - geo.nx * MEASUREMENT.labelOffsetPx;
      const labelY = midY - geo.ny * MEASUREMENT.labelOffsetPx;

      ctx.fillText(formatDisplay(seg.lengthMm, unit), labelX, labelY);
    }
  }
}

const HEATMAP_LEGEND_ENTRIES: { color: string; label: string }[] = [
  { color: '#ef4444', label: '< 600 mm' },
  { color: '#f97316', label: '600 – 900 mm' },
  { color: '#eab308', label: '900 – 1200 mm' },
  { color: '#22c55e', label: '1200 – 1800 mm' },
  { color: '#3b82f6', label: '1800+ mm' },
];

function drawHeatmapLegend(ctx: CanvasRenderingContext2D, canvasWidth: number) {
  const pad = 8;
  const swatchW = 14;
  const swatchH = 10;
  const rowH = 17;
  const legendW = 148;
  const titleH = 16;
  const legendH = pad + titleH + HEATMAP_LEGEND_ENTRIES.length * rowH + pad;
  const margin = 16;
  const compassHeight = 28;
  const x = canvasWidth - margin - legendW;
  const y = margin + compassHeight + 8;

  ctx.save();

  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.fillRect(x, y, legendW, legendH);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, legendW, legendH);

  ctx.fillStyle = '#374151';
  ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Clearance', x + pad, y + pad);

  ctx.font = '10px system-ui, -apple-system, sans-serif';
  for (let i = 0; i < HEATMAP_LEGEND_ENTRIES.length; i++) {
    const rowY = y + pad + titleH + i * rowH;
    ctx.fillStyle = HEATMAP_LEGEND_ENTRIES[i].color;
    ctx.fillRect(x + pad, rowY + 1, swatchW, swatchH);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + pad, rowY + 1, swatchW, swatchH);
    ctx.fillStyle = '#374151';
    ctx.fillText(HEATMAP_LEGEND_ENTRIES[i].label, x + pad + swatchW + 6, rowY);
  }

  ctx.restore();
}

function drawCompassRose(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
) {
  const margin = 16;
  const size = 28;
  const cx = canvasWidth - margin - size / 2;
  const cy = margin + size / 2;

  ctx.save();
  ctx.strokeStyle = COLORS.dimensionLabel;
  ctx.fillStyle = COLORS.dimensionLabel;
  ctx.lineWidth = 1.5;

  // Arrow shaft
  ctx.beginPath();
  ctx.moveTo(cx, cy + size / 2);
  ctx.lineTo(cx, cy - size / 2);
  ctx.stroke();

  // Arrow head
  const headSize = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size / 2);
  ctx.lineTo(cx - headSize, cy - size / 2 + headSize);
  ctx.lineTo(cx + headSize, cy - size / 2 + headSize);
  ctx.closePath();
  ctx.fill();

  // "N" label above the arrow head
  ctx.font = CANVAS.labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', cx, cy - size / 2 - 2);

  ctx.restore();
}

function drawLockedPadlock(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#6b7280';
  ctx.fillStyle = '#6b7280';
  ctx.lineWidth = 1.25;
  // Shackle (the D-shape above the body)
  ctx.beginPath();
  ctx.arc(screenX + 7, screenY + 5, 3.5, Math.PI, 0);
  ctx.stroke();
  // Body (filled rectangle)
  ctx.beginPath();
  ctx.rect(screenX + 2, screenY + 6, 10, 7);
  ctx.fill();
  ctx.restore();
}

function drawRoomLabel(
  ctx: CanvasRenderingContext2D,
  room: Room,
  topLeft: { x: number; y: number },
  roomW: number,
  roomH: number,
) {
  ctx.fillStyle = COLORS.dimensionLabel;
  ctx.font = CANVAS.labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(room.name, topLeft.x + roomW / 2, topLeft.y + roomH / 2);
}

function drawSharedOpening(
  ctx: CanvasRenderingContext2D,
  shared: SharedOpening,
  overlapByAnchor: Map<string, WallOverlap>,
  scale: number,
  offset: { x: number; y: number },
  selectedSharedOpeningId: string | null,
) {
  const oriented = overlapByAnchor.get(`${shared.anchorRoomId}::${shared.anchorWallId}`);
  if (!oriented) return;

  const anchorRoom = oriented.roomA;
  const geo = getWallGeometry(
    oriented.wallA,
    anchorRoom.position,
    anchorRoom.room.dimensions.length,
    anchorRoom.room.dimensions.width,
    scale,
    offset,
  );

  const wallLocalStart = oriented.startA + shared.position;
  const leftX = geo.startX + wallLocalStart * scale * geo.dx;
  const leftY = geo.startY + wallLocalStart * scale * geo.dy;
  const widthPx = shared.width * scale;
  const rightX = leftX + widthPx * geo.dx;
  const rightY = leftY + widthPx * geo.dy;

  const isSelected = shared.id === selectedSharedOpeningId;
  const color = isSelected ? COLORS.openingSelected : COLORS.openingSymbol;

  // Tick marks
  const tickSize = 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftX - tickSize * geo.nx, leftY - tickSize * geo.ny);
  ctx.lineTo(leftX + tickSize * geo.nx, leftY + tickSize * geo.ny);
  ctx.moveTo(rightX - tickSize * geo.nx, rightY - tickSize * geo.ny);
  ctx.lineTo(rightX + tickSize * geo.nx, rightY + tickSize * geo.ny);
  ctx.stroke();

  const swingsIntoAnchor = shared.swingIntoRoomId === shared.anchorRoomId;
  const swingSign = swingsIntoAnchor ? 1 : -1;

  if (shared.type === 'door') {
    drawSharedDoorArc(ctx, shared, geo, leftX, leftY, rightX, rightY, widthPx, swingSign, color);
  } else if (shared.type === 'double-door') {
    drawSharedDoubleDoorArc(ctx, geo, leftX, leftY, rightX, rightY, widthPx, swingSign, color);
  } else if (shared.type === 'window') {
    const lineSpacing = 3;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    // Three parallel lines along the wall
    for (let i = -1; i <= 1; i++) {
      const ox = geo.nx * lineSpacing * i;
      const oy = geo.ny * lineSpacing * i;
      ctx.beginPath();
      ctx.moveTo(leftX + ox, leftY + oy);
      ctx.lineTo(rightX + ox, rightY + oy);
      ctx.stroke();
    }
    // End-cap strokes perpendicular to wall (matching single-room renderer)
    const capOffsetX = geo.nx * lineSpacing;
    const capOffsetY = geo.ny * lineSpacing;
    ctx.beginPath();
    ctx.moveTo(leftX - capOffsetX, leftY - capOffsetY);
    ctx.lineTo(leftX + capOffsetX, leftY + capOffsetY);
    ctx.moveTo(rightX - capOffsetX, rightY - capOffsetY);
    ctx.lineTo(rightX + capOffsetX, rightY + capOffsetY);
    ctx.stroke();
  }
  // Archway: tick marks only — nothing else.
}

function drawSharedDoorArc(
  ctx: CanvasRenderingContext2D,
  shared: SharedOpening,
  geo: WallGeometry,
  leftX: number, leftY: number,
  rightX: number, rightY: number,
  widthPx: number,
  swingSign: number,
  color: string,
) {
  const isLeft = shared.hingeSide !== 'right';
  const hingeX = isLeft ? leftX : rightX;
  const hingeY = isLeft ? leftY : rightY;
  const swingEndX = hingeX + geo.nx * widthPx * swingSign;
  const swingEndY = hingeY + geo.ny * widthPx * swingSign;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hingeX, hingeY);
  ctx.lineTo(swingEndX, swingEndY);
  ctx.stroke();

  const radius = widthPx;
  const wallAngle = Math.atan2(geo.dy, geo.dx);
  const normalAngle = Math.atan2(geo.ny * swingSign, geo.nx * swingSign);
  let startAngle: number, endAngle: number;
  if (isLeft) { startAngle = wallAngle; endAngle = normalAngle; }
  else { startAngle = normalAngle; endAngle = wallAngle + Math.PI; }

  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(hingeX, hingeY, radius, startAngle, endAngle, arcSweepCounterclockwise(geo, swingSign));
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSharedDoubleDoorArc(
  ctx: CanvasRenderingContext2D,
  geo: WallGeometry,
  leftX: number, leftY: number,
  rightX: number, rightY: number,
  widthPx: number,
  swingSign: number,
  color: string,
) {
  const halfWidthPx = widthPx / 2;
  const leftEndX = leftX + geo.nx * halfWidthPx * swingSign;
  const leftEndY = leftY + geo.ny * halfWidthPx * swingSign;
  const rightEndX = rightX + geo.nx * halfWidthPx * swingSign;
  const rightEndY = rightY + geo.ny * halfWidthPx * swingSign;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftX, leftY); ctx.lineTo(leftEndX, leftEndY);
  ctx.moveTo(rightX, rightY); ctx.lineTo(rightEndX, rightEndY);
  ctx.stroke();

  const radius = halfWidthPx;
  const wallAngle = Math.atan2(geo.dy, geo.dx);
  const normalAngle = Math.atan2(geo.ny * swingSign, geo.nx * swingSign);
  const counterclockwise = arcSweepCounterclockwise(geo, swingSign);

  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(leftX, leftY, radius, wallAngle, normalAngle, counterclockwise);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rightX, rightY, radius, normalAngle, wallAngle + Math.PI, counterclockwise);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBlocks(
  ctx: CanvasRenderingContext2D,
  room: Room,
  roomOrigin: { x: number; y: number },
  layers: Layer[],
  selectedBlockId: string | null,
  scale: number,
  offset: { x: number; y: number },
  fp: FloorPlan,
  pieceMap: Map<string, ProjectPiece>,
) {
  // Sort blocks: lower z-layer first (so higher layers paint on top)
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const visibleItems = room.items.filter((i) => layerById.get(i.layerId)?.visible);
  visibleItems.sort((a, b) => (layerById.get(a.layerId)?.z ?? 0) - (layerById.get(b.layerId)?.z ?? 0));

  for (const item of visibleItems) {
    drawSingleBlock(ctx, item, room, roomOrigin, layerById.get(item.layerId)!, fp, selectedBlockId, scale, offset, pieceMap.get(item.id));
  }
}

function drawSingleBlock(
  ctx: CanvasRenderingContext2D,
  item: RoomItem,
  room: Room,
  roomOrigin: { x: number; y: number },
  layer: Layer,
  fp: FloorPlan,
  selectedBlockId: string | null,
  scale: number,
  offset: { x: number; y: number },
  piece: ProjectPiece | undefined,
) {
  const aabb = footprintAABB(item);
  const tl = roomToCanvas(roomOrigin.x + aabb.minX, roomOrigin.y + aabb.minY, scale, offset);
  const w = (aabb.maxX - aabb.minX) * scale;
  const h = (aabb.maxY - aabb.minY) * scale;

  const group = item.groupId ? room.groups.find((g) => g.id === item.groupId) : undefined;
  const fill = group?.color ?? item.color ?? COLORS.blockFillFallback;

  ctx.fillStyle = fill;
  ctx.fillRect(tl.x, tl.y, w, h);

  const isSelected = item.id === selectedBlockId;
  const warnings = computeSoftWarnings(item, room, fp);
  const hasWarning = warnings.length > 0;
  ctx.strokeStyle = hasWarning
    ? COLORS.blockOutlineWarning
    : isSelected
      ? COLORS.blockOutlineSelected
      : COLORS.blockOutline;
  ctx.lineWidth = hasWarning || isSelected ? 2 : 1;
  ctx.strokeRect(tl.x, tl.y, w, h);

  if (piece) {
    drawConfiguredBlockDetail(ctx, piece, tl.x, tl.y, w, h);
  }

  ctx.fillStyle = COLORS.blockBadge;
  ctx.font = CANVAS.badgeFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(layer.name.charAt(0).toUpperCase(), tl.x + 3, tl.y + 3);

  if (item.label) {
    ctx.save();
    ctx.font = CANVAS.labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = tl.x + w / 2;
    const cy = tl.y + h / 2;
    const textW = ctx.measureText(item.label).width;
    const pad = 3;
    const bgW = Math.min(textW + pad * 2, w - 4);
    ctx.fillStyle = 'rgba(30,30,30,0.55)';
    ctx.fillRect(cx - bgW / 2, cy - 8, bgW, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(item.label, cx, cy);
    ctx.restore();
  }

  if (isSelected) {
    const ap = anchorPlanPosition(item);
    const apc = roomToCanvas(roomOrigin.x + ap.x, roomOrigin.y + ap.y, scale, offset);
    ctx.fillStyle = COLORS.blockOutlineSelected;
    ctx.beginPath();
    ctx.arc(apc.x, apc.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

}

function drawConfiguredBlockDetail(
  ctx: CanvasRenderingContext2D,
  piece: ProjectPiece,
  screenX: number,
  screenY: number,
  screenLength: number,
  screenDepth: number,
): void {
  if (piece.furnitureType !== 'cupboard') return;

  const config = piece.config as CupboardConfig;
  if (config.doorStyle === 'none') return;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.5;

  if (config.doorStyle === 'double') {
    ctx.beginPath();
    ctx.moveTo(screenX + screenLength / 2, screenY + 2);
    ctx.lineTo(screenX + screenLength / 2, screenY + screenDepth - 2);
    ctx.stroke();
  }

  if (config.doorStyle === 'single') {
    const radius = Math.min(screenLength, screenDepth) * 0.4;
    ctx.beginPath();
    ctx.arc(screenX, screenY + screenDepth, radius, -Math.PI / 2, 0);
    ctx.stroke();
  }

  ctx.restore();
}
