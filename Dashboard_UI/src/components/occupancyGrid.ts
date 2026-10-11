export type OccupancyGridMsg = {
  info: {
    width: number;
    height: number;
    resolution: number;
    origin: {
      position: { x: number; y: number };
      orientation: { w: number; x: number; y: number; z: number };
    };
  };
  data: number[];
};

export interface OccupancyGridLike {
  info: {
    width: number;
    height: number;
    resolution: number;
    origin: { position: { x: number; y: number } };
  };
  data: ArrayLike<number>;
}

export type Rgba = readonly [number, number, number, number];

export interface OccupancyPalette {
  unknown: Rgba;
  free: Rgba;
  occupied: Rgba;
}

export const DEFAULT_OCCUPANCY_PALETTE: OccupancyPalette = {
  unknown: [128, 128, 128, 255],
  free: [255, 255, 255, 255],
  occupied: [0, 0, 0, 255],
};

export interface GridImageBuffer {
  width: number;
  height: number;
  imageData: ImageData;
}

export function createGridImageBuffer(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): GridImageBuffer {
  return { width, height, imageData: context.createImageData(width, height) };
}

export function paintOccupancyGrid(
  grid: OccupancyGridLike | null | undefined,
  buffer: GridImageBuffer,
  palette: OccupancyPalette = DEFAULT_OCCUPANCY_PALETTE,
): boolean {
  if (!grid?.info) return false;

  const width = gridDimension(grid.info.width);
  const height = gridDimension(grid.info.height);
  if (
    width <= 0 ||
    height <= 0 ||
    buffer.width !== width ||
    buffer.height !== height
  ) {
    return false;
  }

  const values = grid.data;
  const pixels = buffer.imageData.data;
  const [unknownR, unknownG, unknownB, unknownA] = palette.unknown;
  const [freeR, freeG, freeB, freeA] = palette.free;
  const [occupiedR, occupiedG, occupiedB, occupiedA] = palette.occupied;

  for (let gridRow = 0; gridRow < height; gridRow += 1) {
    const imageRow = height - 1 - gridRow;
    const sourceBase = gridRow * width;
    const targetBase = imageRow * width * 4;

    for (let column = 0; column < width; column += 1) {
      const raw = values[sourceBase + column];
      const color =
        typeof raw !== "number" || !Number.isFinite(raw) || raw < 0
          ? [unknownR, unknownG, unknownB, unknownA]
          : raw >= 50
            ? [occupiedR, occupiedG, occupiedB, occupiedA]
            : [freeR, freeG, freeB, freeA];
      const target = targetBase + column * 4;
      pixels[target] = color[0];
      pixels[target + 1] = color[1];
      pixels[target + 2] = color[2];
      pixels[target + 3] = color[3];
    }
  }

  return true;
}

export function gridDimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
