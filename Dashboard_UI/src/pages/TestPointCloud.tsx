import { useMemo } from "react";
import PointCloudViewer, {
  type PointCloud2Msg,
} from "../components/PointCloudViewer";

/**
 * Convert an array of points (each [x,y,z]) into a base64-encoded PointCloud2 message.
 */
function createMockPointCloud(pointsArray: number[][]): PointCloud2Msg {
  const points = pointsArray.flat(); // [x,y,z, x,y,z, ...]
  const floatArray = new Float32Array(points);
  const byteArray = new Uint8Array(floatArray.buffer);

  // Convert to base64
  let binary = "";
  for (let i = 0; i < byteArray.length; i++) {
    binary += String.fromCharCode(byteArray[i]);
  }
  const base64 = btoa(binary);

  const numPoints = pointsArray.length;

  return {
    width: numPoints,
    height: 1,
    point_step: 12, // 3 floats * 4 bytes
    row_step: 12 * numPoints,
    fields: [
      { name: "x", offset: 0, datatype: 7, count: 1 }, // 7 = FLOAT32
      { name: "y", offset: 4, datatype: 7, count: 1 },
      { name: "z", offset: 8, datatype: 7, count: 1 },
    ],
    is_bigendian: false,
    data: base64,
  };
}

// Define some test point clouds
const cubePoints = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

const randomPoints = Array.from({ length: 100 }, () => [
  Math.random() * 2 - 1,
  Math.random() * 2 - 1,
  Math.random() * 2 - 1,
]);

export default function TestPointCloud() {
  const cubeMsg = useMemo(() => createMockPointCloud(cubePoints), []);
  const randomMsg = useMemo(() => createMockPointCloud(randomPoints), []);
  const emptyMsg = useMemo(() => createMockPointCloud([]), []);

  return (
    <div className="p-4 pb-28 space-y-8">

      {/* Test case 1: null message */}
      <div>
        <h2 className="text-lg font-bold mb-2">1. Null Message</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <PointCloudViewer msg={null} />
        </div>
      </div>

      {/* Test case 2: empty point cloud */}
      <div>
        <h2 className="text-lg font-bold mb-2">2. Empty Cloud</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <PointCloudViewer msg={emptyMsg} />
        </div>
      </div>

      {/* Test case 3: cube (8 points) */}
      <div>
        <h2 className="text-lg font-bold mb-2">3. Cube (8 points)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <PointCloudViewer msg={cubeMsg} pointSize={0.1} />
        </div>
      </div>

      {/* Test case 4: random cloud (100 points) */}
      <div>
        <h2 className="text-lg font-bold mb-2">4. Random Cloud (100 points)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <PointCloudViewer msg={randomMsg} pointSize={0.05} />
        </div>
      </div>
    </div>
  );
}
