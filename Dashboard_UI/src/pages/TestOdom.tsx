import { useMemo } from "react";
import OdomViewer, { type OdomMsg } from "../components/OdomViewer"; // adjust import path as needed

/**
 * Create a mock OdomMsg from a position.
 * Orientation is dummy (identity quaternion) because not used by viewer.
 */
function createOdomMsg(x: number, y: number, z: number): OdomMsg {
  return {
    pose: {
      pose: {
        position: { x, y, z },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    twist: {
      twist: {
        linear: { x: 0, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0 },
      },
    },
  };
}

// Path examples
const straightLine = [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0],
];

const curvedPath = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [1, 1, 0],
  [1.5, 1.5, 0.5],
  [2, 2, 1],
];

const zigzag = [
  [0, 0, 0],
  [1, 1, 0],
  [2, 0, 0],
  [3, 1, 0],
  [4, 0, 0],
];

const withHeight = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 0, 2],
  [0, 0, 3],
];

export default function TestOdom() {
  // Build histories using useMemo to avoid recomputation on every render
  const emptyHistory = useMemo<OdomMsg[]>(() => [], []);
  const singleHistory = useMemo<OdomMsg[]>(() => [createOdomMsg(1, 2, 0)], []);
  const straightHistory = useMemo<OdomMsg[]>(
    () => straightLine.map(([x, y, z]) => createOdomMsg(x, y, z)),
    [],
  );
  const curvedHistory = useMemo<OdomMsg[]>(
    () => curvedPath.map(([x, y, z]) => createOdomMsg(x, y, z)),
    [],
  );
  const zigzagHistory = useMemo<OdomMsg[]>(
    () => zigzag.map(([x, y, z]) => createOdomMsg(x, y, z)),
    [],
  );
  const heightHistory = useMemo<OdomMsg[]>(
    () => withHeight.map(([x, y, z]) => createOdomMsg(x, y, z)),
    [],
  );

  return (
    <div className="p-4 pb-28 space-y-8">

      {/* Test 1: Empty history */}
      <div>
        <h2 className="text-lg font-bold mb-2">1. Empty History</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <OdomViewer odomHistory={emptyHistory} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: red sphere at origin, no line, axes visible.
        </p>
      </div>

      {/* Test 2: Single pose */}
      <div>
        <h2 className="text-lg font-bold mb-2">2. Single Pose (1,2,0)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <OdomViewer odomHistory={singleHistory} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: red sphere at (1,2,0), line (single point → invisible), axes.
        </p>
      </div>

      {/* Test 3: Straight line */}
      <div>
        <h2 className="text-lg font-bold mb-2">3. Straight Line along X</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <OdomViewer odomHistory={straightHistory} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: cyan line from (0,0,0) to (3,0,0), sphere at last point.
        </p>
      </div>

      {/* Test 4: Curved path */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          4. Curved Path with Z variation
        </h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <OdomViewer odomHistory={curvedHistory} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: path curving in XY and rising in Z.
        </p>
      </div>

      {/* Test 5: Zigzag path */}
      <div>
        <h2 className="text-lg font-bold mb-2">5. Zigzag Path</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <OdomViewer odomHistory={zigzagHistory} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: back-and-forth line in XY.
        </p>
      </div>

      {/* Test 6: Vertical line */}
      <div>
        <h2 className="text-lg font-bold mb-2">6. Vertical Line (Z axis)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <OdomViewer odomHistory={heightHistory} robotSize={0.2} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: line upward along Z, sphere at top, larger robot size.
        </p>
      </div>
    </div>
  );
}
