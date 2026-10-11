import { useMemo } from "react";
import OccupancyGridViewer from "../components/OccupancyGridViewer";
import type { OccupancyGridMsg } from "../components/occupancyGrid";

/**
 * Scratch page for the standalone grid renderer.
 *
 * Orientation: `nav_msgs/OccupancyGrid.data` is row-major with **row 0 at the
 * BOTTOM** of the map, so the viewer flips rows while building the image. The
 * expectations below are written for that world-correct orientation — a pattern
 * with a top/bottom asymmetry (the 2x2 checkerboard) is mirrored vertically
 * compared with a naive top-down dump such as `/sim/robots/amr_1/map.png`.
 *
 * Helper: create an OccupancyGridMsg with given dimensions and data pattern.
 */
function createMap(
  width: number,
  height: number,
  pattern: (x: number, y: number) => number, // returns -1, 0, or 100
): OccupancyGridMsg {
  const data: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.push(pattern(x, y));
    }
  }

  return {
    info: {
      width,
      height,
      resolution: 0.05, // dummy, not used in rendering
      origin: {
        position: { x: 0, y: 0 },
        orientation: { w: 1, x: 0, y: 0, z: 0 },
      },
    },
    data,
  };
}

// Predefined patterns
const checkerboardPattern = (x: number, y: number) =>
  (x + y) % 2 === 0 ? 0 : 100;
const allFreePattern = () => 0;
const allOccupiedPattern = () => 100;
const allUnknownPattern = () => -1;

export default function TestOccupancyGrid() {
  // Build maps with useMemo to avoid recomputation on every render
  const nullMap = useMemo<OccupancyGridMsg | null>(() => null, []);

  const emptyMap = useMemo<OccupancyGridMsg>(
    () => createMap(0, 0, () => 0),
    [],
  );

  const singleFree = useMemo<OccupancyGridMsg>(
    () => createMap(1, 1, allFreePattern),
    [],
  );

  const singleOccupied = useMemo<OccupancyGridMsg>(
    () => createMap(1, 1, allOccupiedPattern),
    [],
  );

  const singleUnknown = useMemo<OccupancyGridMsg>(
    () => createMap(1, 1, allUnknownPattern),
    [],
  );

  const checkerboard2x2 = useMemo<OccupancyGridMsg>(
    () => createMap(2, 2, checkerboardPattern),
    [],
  );

  const checkerboard10x10 = useMemo<OccupancyGridMsg>(
    () => createMap(10, 10, checkerboardPattern),
    [],
  );

  const cross5x5 = useMemo<OccupancyGridMsg>(
    () =>
      createMap(5, 5, (x, y) => {
        if (x === 2 || y === 2) return 100;
        return 0;
      }),
    [],
  );

  const allFree3x3 = useMemo<OccupancyGridMsg>(
    () => createMap(3, 3, allFreePattern),
    [],
  );

  const allOccupied4x4 = useMemo<OccupancyGridMsg>(
    () => createMap(4, 4, allOccupiedPattern),
    [],
  );

  return (
    <div className="p-4 pb-28 space-y-8">

      {/* Test 1: null map */}
      <div>
        <h2 className="text-lg font-bold mb-2">1. Null Map</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={nullMap} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: empty canvas — nothing is drawn and no stale frame is left
          behind from a previous map.
        </p>
      </div>

      {/* Test 2: empty map (0x0) */}
      <div>
        <h2 className="text-lg font-bold mb-2">2. Empty Map (0x0)</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={emptyMap} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: canvas stays its full requested size (400x400) and is cleared;
          a 0x0 grid is rejected instead of throwing.
        </p>
      </div>

      {/* Test 3: 1x1 free (white) */}
      <div>
        <h2 className="text-lg font-bold mb-2">3. 1x1 Free (white)</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={singleFree} />
        </div>
        <p className="text-sm text-gray-500 mt-1">Expect: white square.</p>
      </div>

      {/* Test 4: 1x1 occupied (black) */}
      <div>
        <h2 className="text-lg font-bold mb-2">4. 1x1 Occupied (black)</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={singleOccupied} />
        </div>
        <p className="text-sm text-gray-500 mt-1">Expect: black square.</p>
      </div>

      {/* Test 5: 1x1 unknown (gray) */}
      <div>
        <h2 className="text-lg font-bold mb-2">5. 1x1 Unknown (gray)</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={singleUnknown} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: gray square (128,128,128).
        </p>
      </div>

      {/* Test 6: 2x2 checkerboard */}
      <div>
        <h2 className="text-lg font-bold mb-2">6. 2x2 Checkerboard</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={checkerboard2x2} width={200} height={200} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: 4 squares, in ROS orientation (row 0 is the BOTTOM row, so the
          first two data cells are drawn at the bottom): top-left black,
          top-right white, bottom-left white, bottom-right black. A renderer
          that does not flip rows shows the vertical mirror of this.
        </p>
      </div>

      {/* Test 7: 10x10 checkerboard */}
      <div>
        <h2 className="text-lg font-bold mb-2">7. 10x10 Checkerboard</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer
            map={checkerboard10x10}
            width={300}
            height={300}
          />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: alternating pattern, scaled to 300x300 (the rows are flipped
          before scaling, so this pattern is inverted row-for-row — it still
          reads as a checkerboard).
        </p>
      </div>

      {/* Test 8: 5x5 cross */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          8. 5x5 Cross (occupied at center row/col)
        </h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={cross5x5} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: black pixels at row 2 and col 2 (0-indexed), rest white.
        </p>
      </div>

      {/* Test 9: Custom width/height larger than default */}
      <div>
        <h2 className="text-lg font-bold mb-2">9. Larger Canvas (600x300)</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer
            map={checkerboard10x10}
            width={600}
            height={300}
          />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: stretched horizontally (aspect ratio may be distorted because
          scaling is independent).
        </p>
      </div>

      {/* Test 10: All free 3x3 */}
      <div>
        <h2 className="text-lg font-bold mb-2">10. All Free 3x3</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={allFree3x3} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: solid white square.
        </p>
      </div>

      {/* Test 11: All occupied 4x4 */}
      <div>
        <h2 className="text-lg font-bold mb-2">11. All Occupied 4x4</h2>
        <div className="border border-gray-300 inline-block max-w-full overflow-x-auto">
          <OccupancyGridViewer map={allOccupied4x4} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: solid black square.
        </p>
      </div>
    </div>
  );
}
