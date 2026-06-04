export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function calculateScale(
  room: { length: number; width: number },
  canvas: Size,
  padding: number,
): number {
  const usableWidth = canvas.width * (1 - 2 * padding);
  const usableHeight = canvas.height * (1 - 2 * padding);
  const scaleX = usableWidth / room.length;
  const scaleY = usableHeight / room.width;
  return Math.min(scaleX, scaleY);
}

export function roomToCanvas(
  roomX: number,
  roomY: number,
  scale: number,
  offset: Point,
): Point {
  return {
    x: roomX * scale + offset.x,
    y: roomY * scale + offset.y,
  };
}

export function canvasToRoom(
  canvasX: number,
  canvasY: number,
  scale: number,
  offset: Point,
): Point {
  return {
    x: (canvasX - offset.x) / scale,
    y: (canvasY - offset.y) / scale,
  };
}
