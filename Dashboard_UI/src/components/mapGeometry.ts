import type {
  OccupancyGridMessage,
  SimWorldResponse,
} from "../api/types";
import type { OccupancyGridLike } from "./occupancyGrid";

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface GridGeometry {
  width: number;
  height: number;
  resolution: number;
  originX: number;
  originY: number;
}

const FIT_PADDING_PX = 14;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4000;

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function gridGeometry(
  grid: OccupancyGridLike | null | undefined,
): GridGeometry | null {
  if (!grid?.info?.origin?.position) return null;
  const width = Math.floor(finiteNumber(grid.info.width));
  const height = Math.floor(finiteNumber(grid.info.height));
  const resolution = finiteNumber(grid.info.resolution);
  if (width <= 0 || height <= 0 || resolution <= 0) return null;

  return {
    width,
    height,
    resolution,
    originX: finiteNumber(grid.info.origin.position.x),
    originY: finiteNumber(grid.info.origin.position.y),
  };
}

export function boundsFromGrid(geometry: GridGeometry): MapBounds {
  return {
    minX: geometry.originX,
    minY: geometry.originY,
    maxX: geometry.originX + geometry.width * geometry.resolution,
    maxY: geometry.originY + geometry.height * geometry.resolution,
  };
}

export function worldToScreen(
  view: MapViewTransform,
  point: MapPoint,
): MapPoint {
  return {
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY - point.y * view.scale,
  };
}

export function screenToWorld(
  view: MapViewTransform,
  point: MapPoint,
): MapPoint {
  return {
    x: (point.x - view.offsetX) / view.scale,
    y: (view.offsetY - point.y) / view.scale,
  };
}

export function fitViewToBounds(
  bounds: MapBounds,
  viewWidth: number,
  viewHeight: number,
  padding = FIT_PADDING_PX,
): MapViewTransform | null {
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;
  if (!(worldWidth > 0) || !(worldHeight > 0)) return null;
  if (!(viewWidth > 0) || !(viewHeight > 0)) return null;

  const usableWidth = Math.max(1, viewWidth - padding * 2);
  const usableHeight = Math.max(1, viewHeight - padding * 2);
  const scale = Math.min(usableWidth / worldWidth, usableHeight / worldHeight);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;

  return {
    scale,
    offsetX: viewWidth / 2 - centreX * scale,
    offsetY: viewHeight / 2 + centreY * scale,
  };
}

export function zoomViewAt(
  view: MapViewTransform,
  factor: number,
  anchor: MapPoint,
  minScale = MIN_SCALE,
  maxScale = MAX_SCALE,
): MapViewTransform {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const applied = scale / view.scale;
  return {
    scale,
    offsetX: anchor.x - (anchor.x - view.offsetX) * applied,
    offsetY: anchor.y - (anchor.y - view.offsetY) * applied,
  };
}

export function quaternionToYaw(
  quaternion: { x: number; y: number; z: number; w: number } | null | undefined,
): number {
  if (!quaternion) return 0;
  const { x, y, z, w } = quaternion;
  const norm = Math.hypot(x, y, z, w);
  if (!Number.isFinite(norm) || norm === 0) return 0;

  const nx = x / norm;
  const ny = y / norm;
  const nz = z / norm;
  const nw = w / norm;
  return Math.atan2(2 * (nw * nz + nx * ny), 1 - 2 * (ny * ny + nz * nz));
}

export function gridFromRosMessage(
  message: OccupancyGridMessage | null | undefined,
): OccupancyGridLike | null {
  if (!message?.info?.origin?.position) return null;
  const width = Math.floor(finiteNumber(message.info.width));
  const height = Math.floor(finiteNumber(message.info.height));
  if (width <= 0 || height <= 0) return null;

  return {
    info: {
      width,
      height,
      resolution: finiteNumber(message.info.resolution),
      origin: {
        position: {
          x: finiteNumber(message.info.origin.position.x),
          y: finiteNumber(message.info.origin.position.y),
        },
      },
    },
    data: Array.isArray(message.data) ? message.data : [],
  };
}

export function gridFromSimWorld(
  world: SimWorldResponse | null | undefined,
): OccupancyGridLike | null {
  if (!world) return null;
  const width = Math.floor(finiteNumber(world.width));
  const height = Math.floor(finiteNumber(world.height));
  if (width <= 0 || height <= 0) return null;

  return {
    info: {
      width,
      height,
      resolution: finiteNumber(world.resolution),
      origin: {
        position: {
          x: finiteNumber(world.origin[0]),
          y: finiteNumber(world.origin[1]),
        },
      },
    },
    data: world.cells,
  };
}
