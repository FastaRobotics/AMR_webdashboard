import TwistViewer, { type Pose } from "../components/TwistViewer"; // adjust import path as needed

/**
 * Helper: create a Pose object with given position, twist, and optional orientation.
 */
function createPose(
  position: { x: number; y: number; z?: number },
  twist?: {
    linear: { x: number; y: number; z: number };
    angular?: { x: number; y: number; z: number };
  },
): Pose {
  return {
    position: {
      x: position.x,
      y: position.y,
      z: position.z ?? 0,
    },
    orientation: { x: 0, y: 0, z: 0, w: 1 }, // dummy, not used
    twist: twist
      ? {
        linear: twist.linear,
        angular: twist.angular ?? { x: 0, y: 0, z: 0 }, // default angular if missing
      }
      : undefined,
  };
}

// Test poses
const poseX = createPose(
  { x: 1, y: 0, z: 0 },
  { linear: { x: 1, y: 0, z: 0 } },
);
const poseY = createPose(
  { x: 0, y: 1, z: 0 },
  { linear: { x: 0, y: 1, z: 0 } },
);
const poseZ = createPose(
  { x: 0, y: 0, z: 1 },
  { linear: { x: 0, y: 0, z: 1 } },
);
const poseDiagonal = createPose(
  { x: 1, y: 1, z: 0 },
  { linear: { x: 1, y: 1, z: 0 } },
);
const poseZeroTwist = createPose(
  { x: 0, y: 0, z: 0 },
  { linear: { x: 0, y: 0, z: 0 } },
);
const poseNoTwist = createPose({ x: 2, y: 0, z: 0 }); // twist undefined

export default function TestTwist() {
  return (
    <div className="p-4 pb-28 space-y-8">

      {/* Test 1: Twist along X at (1,0,0) */}
      <div>
        <h2 className="text-lg font-bold mb-2">1. Twist +X at (1,0,0)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseX} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: green arrow pointing +X from red sphere at (1,0,0), length ~1.
        </p>
      </div>

      {/* Test 2: Twist along Y at (0,1,0) */}
      <div>
        <h2 className="text-lg font-bold mb-2">2. Twist +Y at (0,1,0)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseY} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: green arrow pointing +Y from red sphere at (0,1,0).
        </p>
      </div>

      {/* Test 3: Twist along Z at (0,0,1) */}
      <div>
        <h2 className="text-lg font-bold mb-2">3. Twist +Z at (0,0,1)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseZ} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: green arrow pointing +Z from red sphere at (0,0,1).
        </p>
      </div>

      {/* Test 4: Diagonal twist (1,1,0) at (1,1,0) */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          4. Diagonal Twist (1,1,0) at (1,1,0)
        </h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseDiagonal} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: green arrow at 45° in XY from sphere at (1,1,0).
        </p>
      </div>

      {/* Test 5: Zero twist vector */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          5. Zero Twist (0,0,0) at origin
        </h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseZeroTwist} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: default arrow pointing +Z (or invisible because length zero?)
          Red sphere at origin, axes visible.
        </p>
      </div>

      {/* Test 6: No twist (undefined) */}
      <div>
        <h2 className="text-lg font-bold mb-2">6. No Twist (undefined)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseNoTwist} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: Nothing (component returns null) → empty black container.
        </p>
      </div>

      {/* Test 7: Scale factor applied */}
      <div>
        <h2 className="text-lg font-bold mb-2">7. Scale factor 2 on X twist</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer pose={poseX} scale={2} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: green arrow twice as long (length 2) at (1,0,0).
        </p>
      </div>

      {/* Test 8: Position with default Z */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          8. Position with default Z (z omitted)
        </h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TwistViewer
            pose={createPose(
              { x: -1, y: -1 },
              { linear: { x: 1, y: 0, z: 0 } },
            )}
          />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: sphere at (-1,-1,0) with arrow along +X.
        </p>
      </div>
    </div>
  );
}
