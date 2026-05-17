import type { Room, Opening } from '../types/room';
import type { Layer } from '../types/floorPlan';
import { toIso, computeIsoLayout, blockFootprintDepthKey, openingVoidCorners, type IsoPoint, type IsoLayout } from '../utils/isometric';
import { footprintAABB } from '../utils/blocks';
import { COLORS } from '../constants/theme';
import type { ProjectPiece } from '@/lib/roomcraft/types';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

export const ISO_ROTATE_BTN = { cx: 28, cy: 28, r: 16 } as const;

function project(rx: number, ry: number, rz: number, layout: IsoLayout, flip: boolean): IsoPoint {
  const prx = flip ? layout.roomLength - rx : rx;
  const pry = flip ? layout.roomWidth - ry : ry;
  const iso = toIso(prx, pry, rz, layout.scale);
  return { x: layout.originX + iso.x, y: layout.originY + iso.y };
}

function fillQuad(ctx: CanvasRenderingContext2D, p0: IsoPoint, p1: IsoPoint, p2: IsoPoint, p3: IsoPoint): void {
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();
}

function shadeColor(hex: string, factor: number): string {
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const n = parseInt(full.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((n & 0xff) * factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  zBase: number,
  zTop: number,
  layout: IsoLayout,
  color: string,
  cameraFlipped: boolean,
  image?: HTMLImageElement,
): void {
  if (image) {
    const anchor = project((minX + maxX) / 2, (minY + maxY) / 2, zBase, layout, cameraFlipped);
    ctx.drawImage(image, anchor.x - image.naturalWidth / 2, anchor.y - image.naturalHeight, image.naturalWidth, image.naturalHeight);
    return;
  }
  const p = (rx: number, ry: number, rz: number) => project(rx, ry, rz, layout, cameraFlipped);
  const visibleX = cameraFlipped ? minX : maxX;
  const visibleY = cameraFlipped ? minY : maxY;

  // X-facing side
  ctx.fillStyle = shadeColor(color, 0.78);
  fillQuad(ctx, p(visibleX, minY, zBase), p(visibleX, maxY, zBase), p(visibleX, maxY, zTop), p(visibleX, minY, zTop));

  // Y-facing side
  ctx.fillStyle = shadeColor(color, 0.60);
  fillQuad(ctx, p(minX, visibleY, zBase), p(maxX, visibleY, zBase), p(maxX, visibleY, zTop), p(minX, visibleY, zTop));

  // Top face
  ctx.fillStyle = color;
  fillQuad(ctx, p(minX, minY, zTop), p(maxX, minY, zTop), p(maxX, maxY, zTop), p(minX, maxY, zTop));
}

function drawConfiguredBlockIso(
  ctx: CanvasRenderingContext2D,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  zBase: number,
  zTop: number,
  layout: IsoLayout,
  color: string,
  cameraFlipped: boolean,
  piece: ProjectPiece,
): void {
  drawBlock(ctx, minX, maxX, minY, maxY, zBase, zTop, layout, color, cameraFlipped);

  if (piece.furnitureType !== 'cupboard') return;
  const config = piece.config as CupboardConfig;
  if (config.doorStyle === 'none') return;

  const p = (rx: number, ry: number, rz: number) => project(rx, ry, rz, layout, cameraFlipped);

  // The visible front face is along the Y-axis (darker 60% shade side).
  const visibleY = cameraFlipped ? minY : maxY;
  const proud = 8;

  const insetX = (maxX - minX) * 0.02;
  const insetZ = (zTop - zBase) * 0.02;
  const dX0 = minX + insetX;
  const dX1 = maxX - insetX;
  const dZ0 = zBase + insetZ;
  const dZ1 = zTop - insetZ;
  const doorY = visibleY + (cameraFlipped ? -proud : proud);

  const doorColor = shadeColor(color, 0.65);

  if (config.doorStyle === 'double') {
    const midX = (dX0 + dX1) / 2;
    const gap = 2;
    ctx.fillStyle = doorColor;

    fillQuad(ctx, p(dX0, visibleY, dZ0), p(midX - gap / 2, visibleY, dZ0), p(midX - gap / 2, doorY, dZ0), p(dX0, doorY, dZ0));
    fillQuad(ctx, p(dX0, doorY, dZ0), p(midX - gap / 2, doorY, dZ0), p(midX - gap / 2, doorY, dZ1), p(dX0, doorY, dZ1));
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(dX0, visibleY, dZ1), p(dX0, doorY, dZ1), p(dX0, doorY, dZ0));

    fillQuad(ctx, p(midX + gap / 2, visibleY, dZ0), p(dX1, visibleY, dZ0), p(dX1, doorY, dZ0), p(midX + gap / 2, doorY, dZ0));
    fillQuad(ctx, p(midX + gap / 2, doorY, dZ0), p(dX1, doorY, dZ0), p(dX1, doorY, dZ1), p(midX + gap / 2, doorY, dZ1));
    fillQuad(ctx, p(dX1, visibleY, dZ0), p(dX1, visibleY, dZ1), p(dX1, doorY, dZ1), p(dX1, doorY, dZ0));
  } else {
    ctx.fillStyle = doorColor;
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(dX1, visibleY, dZ0), p(dX1, doorY, dZ0), p(dX0, doorY, dZ0));
    fillQuad(ctx, p(dX0, doorY, dZ0), p(dX1, doorY, dZ0), p(dX1, doorY, dZ1), p(dX0, doorY, dZ1));
    fillQuad(ctx, p(dX0, visibleY, dZ0), p(dX0, visibleY, dZ1), p(dX0, doorY, dZ1), p(dX0, doorY, dZ0));
    fillQuad(ctx, p(dX1, visibleY, dZ0), p(dX1, visibleY, dZ1), p(dX1, doorY, dZ1), p(dX1, doorY, dZ0));
  }
}

function drawOpeningVoid(
  ctx: CanvasRenderingContext2D,
  opening: Opening,
  wallFixedCoord: number,
  wallAxis: 'along-x' | 'along-y',
  layout: IsoLayout,
  cameraFlipped: boolean,
): void {
  const zBase = opening.distanceFromFloor;
  const zTop = opening.distanceFromFloor + opening.height;
  const corners = openingVoidCorners(
    opening.position, opening.width, zBase, zTop,
    wallFixedCoord, wallAxis, layout, cameraFlipped,
  );
  ctx.fillStyle = '#111111';
  fillQuad(ctx, corners[0], corners[1], corners[2], corners[3]);
}

export function drawIsoRotateButton(ctx: CanvasRenderingContext2D): void {
  const { cx, cy, r } = ISO_ROTATE_BTN;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, -Math.PI * 0.75, Math.PI * 0.75);
  ctx.stroke();
  const endAngle = Math.PI * 0.75;
  const ax = cx + 7 * Math.cos(endAngle);
  const ay = cy + 7 * Math.sin(endAngle);
  const tangent = endAngle + Math.PI / 2;
  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + 5 * Math.cos(tangent - 0.5), ay + 5 * Math.sin(tangent - 0.5));
  ctx.lineTo(ax + 5 * Math.cos(tangent + 0.5), ay + 5 * Math.sin(tangent + 0.5));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function renderIsometricView(
  ctx: CanvasRenderingContext2D,
  room: Room,
  layers: Layer[],
  canvasW: number,
  canvasH: number,
  cameraFlipped: boolean,
  pieceMap?: Map<string, ProjectPiece>,
): void {
  const { length: L, width: W, height: H } = room.dimensions;
  const layout = computeIsoLayout(L, W, H, canvasW, canvasH);

  // Floor
  ctx.fillStyle = '#F5F0EB';
  fillQuad(
    ctx,
    project(0, 0, 0, layout, cameraFlipped),
    project(L, 0, 0, layout, cameraFlipped),
    project(L, W, 0, layout, cameraFlipped),
    project(0, W, 0, layout, cameraFlipped),
  );

  // Back wall pair - SE view: north + west; NW view: south + east
  const wallSide1 = cameraFlipped ? 'south' : 'north';
  const ry1 = cameraFlipped ? W : 0;
  const wallSide2 = cameraFlipped ? 'east' : 'west';
  const rx2 = cameraFlipped ? L : 0;

  // Wall 1 + voids
  ctx.fillStyle = '#E0D8D0';
  fillQuad(
    ctx,
    project(0, ry1, 0, layout, cameraFlipped),
    project(L, ry1, 0, layout, cameraFlipped),
    project(L, ry1, H, layout, cameraFlipped),
    project(0, ry1, H, layout, cameraFlipped),
  );
  for (const opening of room.openings) {
    const wall = room.walls.find((w) => w.id === opening.wallId);
    if (wall?.side === wallSide1) {
      drawOpeningVoid(ctx, opening, ry1, 'along-x', layout, cameraFlipped);
    }
  }

  // Wall 2 + voids
  ctx.fillStyle = '#CCC4BB';
  fillQuad(
    ctx,
    project(rx2, 0, 0, layout, cameraFlipped),
    project(rx2, W, 0, layout, cameraFlipped),
    project(rx2, W, H, layout, cameraFlipped),
    project(rx2, 0, H, layout, cameraFlipped),
  );
  for (const opening of room.openings) {
    const wall = room.walls.find((w) => w.id === opening.wallId);
    if (wall?.side === wallSide2) {
      drawOpeningVoid(ctx, opening, rx2, 'along-y', layout, cameraFlipped);
    }
  }

  // Blocks - painter's algorithm (back to front)
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const visible = room.items.filter((item) => layerById.get(item.layerId)?.visible ?? false);
  visible.sort((a, b) => {
    const aabbA = footprintAABB(a);
    const aabbB = footprintAABB(b);
    return (
      blockFootprintDepthKey(aabbA.minX, aabbA.maxX, aabbA.minY, aabbA.maxY, cameraFlipped, L, W) -
      blockFootprintDepthKey(aabbB.minX, aabbB.maxX, aabbB.minY, aabbB.maxY, cameraFlipped, L, W)
    );
  });
  for (const item of visible) {
    const layer = layerById.get(item.layerId);
    if (!layer) continue;
    const aabb = footprintAABB(item);
    const group = item.groupId ? room.groups.find((g) => g.id === item.groupId) : undefined;
    const color = group?.color ?? item.color ?? COLORS.blockFillFallback;
    const piece = pieceMap?.get(item.id);
    if (piece) {
      drawConfiguredBlockIso(ctx, aabb.minX, aabb.maxX, aabb.minY, aabb.maxY, layer.z, layer.z + item.height, layout, color, cameraFlipped, piece);
    } else {
      drawBlock(ctx, aabb.minX, aabb.maxX, aabb.minY, aabb.maxY, layer.z, layer.z + item.height, layout, color, cameraFlipped);
    }
  }
}
