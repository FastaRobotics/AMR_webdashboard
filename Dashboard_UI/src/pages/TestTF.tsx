import { useMemo } from "react";
import TFViewer, { type TFMessage, type Transform } from "../components/TFViewer"; // adjust import path as needed
import * as THREE from "three";

/**
 * Helper: create a Transform from frame_id, child_frame_id, translation, and rotation (as Euler degrees).
 */
function createTransform(
  frame_id: string,
  child_frame_id: string,
  translation: { x: number; y: number; z: number },
  rotationDegrees: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): Transform {
  // Convert Euler degrees to quaternion
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotationDegrees.x),
    THREE.MathUtils.degToRad(rotationDegrees.y),
    THREE.MathUtils.degToRad(rotationDegrees.z),
    "XYZ"
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler);

  return {
    header: {
      frame_id,
    },
    child_frame_id,
    transform: {
      translation,
      rotation: {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      },
    },
  };
}

/**
 * Helper: create a TFMessage from an array of transforms.
 */
function createTFMessage(transforms: Transform[]): TFMessage {
  return { transforms };
}

// Sample transforms
const transform1 = createTransform("world", "frame1", { x: 1, y: 0, z: 0 });
const transform2 = createTransform("world", "frame2", { x: 0, y: 1, z: 0 });
const transform3 = createTransform("world", "frame3", { x: 0, y: 0, z: 1 });
const transformRotated = createTransform(
  "world",
  "rotated_frame",
  { x: 1, y: 1, z: 0 },
  { x: 0, y: 0, z: 90 } // 90° around Z
);

export default function TestTF() {
  // Build TF messages with useMemo
  const nullMsg = useMemo<TFMessage | null>(() => null, []);
  const emptyMsg = useMemo<TFMessage>(() => createTFMessage([]), []);
  const singleMsg = useMemo<TFMessage>(
    () => createTFMessage([transform1]),
    []
  );
  const multipleMsg = useMemo<TFMessage>(
    () => createTFMessage([transform1, transform2, transform3]),
    []
  );
  const rotatedMsg = useMemo<TFMessage>(
    () => createTFMessage([transformRotated]),
    []
  );
  const mixedMsg = useMemo<TFMessage>(
    () => createTFMessage([transform1, transformRotated]),
    []
  );

  return (
    <div className="p-4 pb-28 space-y-8">

      {/* Test 1: null message */}
      <div>
        <h2 className="text-lg font-bold mb-2">1. Null Message</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TFViewer tf={nullMsg} />
        </div>
        <p className="text-sm text-gray-500 mt-1">Expect: black canvas, no axes/lines.</p>
      </div>

      {/* Test 2: empty transforms array */}
      <div>
        <h2 className="text-lg font-bold mb-2">2. Empty Transforms</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TFViewer tf={emptyMsg} />
        </div>
        <p className="text-sm text-gray-500 mt-1">Expect: black canvas, no axes/lines.</p>
      </div>

      {/* Test 3: single transform at (1,0,0) */}
      <div>
        <h2 className="text-lg font-bold mb-2">3. Single Frame at (1,0,0)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TFViewer tf={singleMsg} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: axes at (1,0,0), line from origin to that point.
        </p>
      </div>

      {/* Test 4: multiple frames on axes */}
      <div>
        <h2 className="text-lg font-bold mb-2">4. Three Frames on X, Y, Z</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TFViewer tf={multipleMsg} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: axes at (1,0,0), (0,1,0), (0,0,1) with corresponding lines.
        </p>
      </div>

      {/* Test 5: rotated frame */}
      <div>
        <h2 className="text-lg font-bold mb-2">5. Rotated Frame (90° around Z)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TFViewer tf={rotatedMsg} axisSize={0.5} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: axes at (1,1,0) but rotated 90°, line from origin, larger axis size.
        </p>
      </div>

      {/* Test 6: mixed frames (unrotated + rotated) */}
      <div>
        <h2 className="text-lg font-bold mb-2">6. Mixed Frames</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <TFViewer tf={mixedMsg} axisSize={0.3} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Expect: one frame at (1,0,0) with standard orientation, another at (1,1,0) rotated.
        </p>
      </div>
    </div>
  );
}