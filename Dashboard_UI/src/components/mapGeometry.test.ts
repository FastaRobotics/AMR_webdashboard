import { describe, expect, it } from "vitest";

import {
  fitViewToBounds,
  screenToWorld,
  worldToScreen,
  zoomViewAt,
} from "./mapGeometry";

describe("map coordinate transforms", () => {
  it("round-trips world points through screen coordinates", () => {
    const view = { scale: 12, offsetX: 240, offsetY: 180 };
    const world = { x: -3.25, y: 7.5 };
    expect(screenToWorld(view, worldToScreen(view, world))).toEqual(world);
  });

  it("fits bounds within the available viewport", () => {
    const view = fitViewToBounds(
      { minX: -8, minY: -5, maxX: 8, maxY: 5 },
      640,
      400,
    );
    expect(view).not.toBeNull();
    expect(view?.scale).toBeCloseTo(37.2);
    expect(worldToScreen(view!, { x: -8, y: 5 }).x).toBeGreaterThanOrEqual(0);
  });

  it("keeps the world point under the zoom anchor fixed", () => {
    const view = { scale: 10, offsetX: 50, offsetY: 80 };
    const anchor = { x: 130, y: 160 };
    const before = screenToWorld(view, anchor);
    const after = screenToWorld(zoomViewAt(view, 1.5, anchor), anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
