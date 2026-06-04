export interface WallAxis {
  dx: number;
  dy: number;
  nx: number;
  ny: number;
}

export function arcSweepCounterclockwise(axis: WallAxis, normalDir: number): boolean {
  return normalDir * (axis.dx * axis.ny - axis.dy * axis.nx) < 0;
}
