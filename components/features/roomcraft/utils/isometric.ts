export interface IsoPoint {
  x: number;
  y: number;
}

export interface IsoLayout {
  scale: number;
  originX: number;
  originY: number;
  roomLength: number;
  roomWidth: number;
}

export function toIso(rx: number, ry: number, rz: number, scale: number): IsoPoint {
  return {
    x: (rx - ry) * scale,
    y: (rx + ry) * 0.5 * scale - rz * scale,
  };
}

export function computeIsoLayout(
  roomLength: number,
  roomWidth: number,
  roomHeight: number,
  canvasW: number,
  canvasH: number,
): IsoLayout {
  const pad = 0.85;
  const scaleW = (canvasW * pad) / (roomLength + roomWidth);
  const scaleH = (canvasH * pad) / ((roomLength + roomWidth) * 0.5 + roomHeight);
  const scale = Math.min(scaleW, scaleH);
  const centerX = (roomLength - roomWidth) * 0.5 * scale;
  const centerY = ((roomLength + roomWidth) * 0.5 - roomHeight) * 0.5 * scale;
  return {
    scale,
    originX: canvasW / 2 - centerX,
    originY: canvasH / 2 - centerY,
    roomLength,
    roomWidth,
  };
}

export function blockDepthKey(
  minX: number,
  minY: number,
  cameraFlipped: boolean,
  roomLength: number,
  roomWidth: number,
): number {
  return cameraFlipped
    ? (roomLength - minX) + (roomWidth - minY)
    : minX + minY;
}

export function blockFootprintDepthKey(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  cameraFlipped: boolean,
  roomLength: number,
  roomWidth: number,
): number {
  return cameraFlipped
    ? blockDepthKey(minX, minY, cameraFlipped, roomLength, roomWidth)
    : blockDepthKey(maxX, maxY, cameraFlipped, roomLength, roomWidth);
}

export function openingVoidCorners(
  openingPosition: number,
  openingWidth: number,
  zBase: number,
  zTop: number,
  wallFixedCoord: number,
  wallAxis: 'along-x' | 'along-y',
  layout: IsoLayout,
  cameraFlipped: boolean,
): [IsoPoint, IsoPoint, IsoPoint, IsoPoint] {
  function p(rx: number, ry: number, rz: number): IsoPoint {
    const prx = cameraFlipped ? layout.roomLength - rx : rx;
    const pry = cameraFlipped ? layout.roomWidth - ry : ry;
    const iso = toIso(prx, pry, rz, layout.scale);
    return { x: layout.originX + iso.x, y: layout.originY + iso.y };
  }
  if (wallAxis === 'along-x') {
    return [
      p(openingPosition, wallFixedCoord, zBase),
      p(openingPosition + openingWidth, wallFixedCoord, zBase),
      p(openingPosition + openingWidth, wallFixedCoord, zTop),
      p(openingPosition, wallFixedCoord, zTop),
    ];
  }
  return [
    p(wallFixedCoord, openingPosition, zBase),
    p(wallFixedCoord, openingPosition + openingWidth, zBase),
    p(wallFixedCoord, openingPosition + openingWidth, zTop),
    p(wallFixedCoord, openingPosition, zTop),
  ];
}
