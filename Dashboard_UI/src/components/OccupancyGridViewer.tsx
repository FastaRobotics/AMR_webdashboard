import React, { useEffect, useRef } from "react";
import {
  createGridImageBuffer,
  gridDimension,
  paintOccupancyGrid,
  type GridImageBuffer,
  type OccupancyGridMsg,
} from "./occupancyGrid";

type Props = {
  map: OccupancyGridMsg | null;
  width?: number;
  height?: number;
};

/**
 * Minimal standalone occupancy-grid viewer: one 1:1 offscreen image of the
 * grid, nearest-neighbour scaled to fill the canvas.
 *
 * For a real map view (robot, plan, zoom/pan, world coordinates) use
 * `MapPanel`; this component stays deliberately dumb so the telemetry test page
 * can feed it hand-built grids.
 */
const OccupancyGridViewer: React.FC<Props> = ({
  map,
  width = 400,
  height = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<GridImageBuffer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    // Clear first: when the map becomes null (robot switched, socket dropped)
    // the previous frame must not stay on screen.
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!map?.info) return;

    const gridWidth = gridDimension(map.info.width);
    const gridHeight = gridDimension(map.info.height);
    if (gridWidth <= 0 || gridHeight <= 0) return; // 0x0 grid: nothing to draw

    let offscreen = offscreenRef.current;
    if (!offscreen) {
      offscreen = document.createElement("canvas");
      offscreenRef.current = offscreen;
    }

    if (offscreen.width !== gridWidth || offscreen.height !== gridHeight) {
      offscreen.width = gridWidth;
      offscreen.height = gridHeight;
      // A differently sized grid needs a differently sized buffer.
      bufferRef.current = null;
    }

    const offscreenContext = offscreen.getContext("2d");
    if (!offscreenContext) return;

    if (!bufferRef.current) {
      bufferRef.current = createGridImageBuffer(
        offscreenContext,
        gridWidth,
        gridHeight,
      );
    }

    if (!paintOccupancyGrid(map, bufferRef.current)) return;

    offscreenContext.putImageData(bufferRef.current.imageData, 0, 0);

    context.imageSmoothingEnabled = false;
    context.drawImage(
      offscreen,
      0,
      0,
      gridWidth,
      gridHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [map, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="border border-gray-500 max-w-full h-auto"
    />
  );
};

export default OccupancyGridViewer;
