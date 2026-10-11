import { describe, expect, it } from "vitest";

import {
  paintOccupancyGrid,
  type GridImageBuffer,
} from "./occupancyGrid";

describe("paintOccupancyGrid", () => {
  it("flips ROS bottom-first rows into top-first image pixels", () => {
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    const buffer: GridImageBuffer = {
      width: 2,
      height: 2,
      imageData: { data: pixels } as ImageData,
    };

    expect(
      paintOccupancyGrid(
        {
          info: {
            width: 2,
            height: 2,
            resolution: 1,
            origin: { position: { x: 0, y: 0 } },
          },
          data: [0, 100, 100, -1],
        },
        buffer,
      ),
    ).toBe(true);

    expect([...pixels]).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });
});
