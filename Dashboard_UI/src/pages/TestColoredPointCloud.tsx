import { useMemo } from "react";
import ColoredPointCloudViewer, {
  type PointCloud2Msg,
} from "../components/ColoredPointCloudViewer"; // adjust import

/**
 * Convert an array of points (each {x,y,z,r,g,b}) into a PointCloud2Msg.
 * Supports different color encodings:
 * - "rgb": pack r,g,b into a uint32 (r<<16 | g<<8 | b)
 * - "separate": separate float32 fields for r,g,b
 * - "rgba": pack r,g,b,a into uint32 (r<<24 | g<<16 | b<<8 | a)
 */
function createColoredPointCloud(
  points: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    a?: number;
  }[],
  colorMode: "rgb" | "rgba" | "separate" | "none" = "rgb",
): PointCloud2Msg {
  const numPoints = points.length;
  const point_step = 12 + (colorMode === "separate" ? 12 : 4); // 3 floats (xyz) + color data
  const dataBuffer = new ArrayBuffer(numPoints * point_step);
  const view = new DataView(dataBuffer);
  const littleEndian = true; // assume little-endian

  // Define fields
  const fields = [
    { name: "x", offset: 0, datatype: 7, count: 1 }, // float32
    { name: "y", offset: 4, datatype: 7, count: 1 },
    { name: "z", offset: 8, datatype: 7, count: 1 },
  ];

  if (colorMode === "rgb") {
    fields.push({ name: "rgb", offset: 12, datatype: 6, count: 1 }); // uint32
  } else if (colorMode === "rgba") {
    fields.push({ name: "rgba", offset: 12, datatype: 6, count: 1 }); // uint32
  } else if (colorMode === "separate") {
    fields.push(
      { name: "r", offset: 12, datatype: 7, count: 1 },
      { name: "g", offset: 16, datatype: 7, count: 1 },
      { name: "b", offset: 20, datatype: 7, count: 1 },
    );
  }

  for (let i = 0; i < numPoints; i++) {
    const p = points[i];
    const base = i * point_step;

    // Position
    view.setFloat32(base + 0, p.x, littleEndian);
    view.setFloat32(base + 4, p.y, littleEndian);
    view.setFloat32(base + 8, p.z, littleEndian);

    // Color
    if (colorMode === "rgb") {
      const r = Math.round(p.r * 255) & 0xff;
      const g = Math.round(p.g * 255) & 0xff;
      const b = Math.round(p.b * 255) & 0xff;
      const packed = (r << 16) | (g << 8) | b;
      view.setUint32(base + 12, packed, littleEndian);
    } else if (colorMode === "rgba") {
      const r = Math.round(p.r * 255) & 0xff;
      const g = Math.round(p.g * 255) & 0xff;
      const b = Math.round(p.b * 255) & 0xff;
      const a = p.a !== undefined ? Math.round(p.a * 255) & 0xff : 255;
      const packed = (r << 24) | (g << 16) | (b << 8) | a;
      view.setUint32(base + 12, packed, littleEndian);
    } else if (colorMode === "separate") {
      view.setFloat32(base + 12, p.r, littleEndian);
      view.setFloat32(base + 16, p.g, littleEndian);
      view.setFloat32(base + 20, p.b, littleEndian);
    }
  }

  // Convert to base64
  const uint8Array = new Uint8Array(dataBuffer);
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  const base64 = btoa(binary);

  return {
    width: numPoints,
    height: 1,
    point_step,
    row_step: numPoints * point_step,
    fields,
    is_bigendian: false,
    data: base64,
  };
}

// Sample colored point sets
const cubeCorners = [
  { x: 0, y: 0, z: 0, r: 1, g: 0, b: 0 }, // red
  { x: 1, y: 0, z: 0, r: 0, g: 1, b: 0 }, // green
  { x: 0, y: 1, z: 0, r: 0, g: 0, b: 1 }, // blue
  { x: 0, y: 0, z: 1, r: 1, g: 1, b: 0 }, // yellow
  { x: 1, y: 1, z: 0, r: 1, g: 0, b: 1 }, // magenta
  { x: 1, y: 0, z: 1, r: 0, g: 1, b: 1 }, // cyan
  { x: 0, y: 1, z: 1, r: 1, g: 0.5, b: 0 }, // orange
  { x: 1, y: 1, z: 1, r: 1, g: 1, b: 1 }, // white
];

const randomPoints = Array.from({ length: 200 }, () => ({
  x: Math.random() * 2 - 1,
  y: Math.random() * 2 - 1,
  z: Math.random() * 2 - 1,
  r: Math.random(),
  g: Math.random(),
  b: Math.random(),
}));

export default function TestColoredPointCloud() {
  // Build messages with useMemo
  const nullMsg = useMemo<PointCloud2Msg | null>(() => null, []);

  const cubeRGB = useMemo(
    () => createColoredPointCloud(cubeCorners, "rgb"),
    [],
  );

  const cubeRGBA = useMemo(
    () =>
      createColoredPointCloud(
        cubeCorners.map((p) => ({ ...p, a: 0.5 })),
        "rgba",
      ),
    [],
  );

  const cubeSeparate = useMemo(
    () => createColoredPointCloud(cubeCorners, "separate"),
    [],
  );

  const randomRGB = useMemo(
    () => createColoredPointCloud(randomPoints, "rgb"),
    [],
  );

  const noColor = useMemo(() => {
    // Create a message without color fields (only xyz)
    const points = cubeCorners.map(({ x, y, z }) => ({
      x,
      y,
      z,
      r: 0,
      g: 0,
      b: 0,
    })); // colors ignored
    const numPoints = points.length;
    const point_step = 12; // only xyz
    const dataBuffer = new ArrayBuffer(numPoints * point_step);
    const view = new DataView(dataBuffer);
    for (let i = 0; i < numPoints; i++) {
      const p = points[i];
      view.setFloat32(i * 12 + 0, p.x, true);
      view.setFloat32(i * 12 + 4, p.y, true);
      view.setFloat32(i * 12 + 8, p.z, true);
    }
    const uint8Array = new Uint8Array(dataBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++)
      binary += String.fromCharCode(uint8Array[i]);
    const base64 = btoa(binary);
    return {
      width: numPoints,
      height: 1,
      point_step,
      row_step: numPoints * point_step,
      fields: [
        { name: "x", offset: 0, datatype: 7, count: 1 },
        { name: "y", offset: 4, datatype: 7, count: 1 },
        { name: "z", offset: 8, datatype: 7, count: 1 },
      ],
      is_bigendian: false,
      data: base64,
    };
  }, []);

  return (
    <div className="p-4 pb-28 space-y-8">

      {/* Test 1: null message */}
      <div>
        <h2 className="text-lg font-bold mb-2">1. Null Message</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <ColoredPointCloudViewer msg={nullMsg} />
        </div>
        <p className="text-sm text-gray-500">
          Expect: black canvas, nothing visible.
        </p>
      </div>

      {/* Test 2: Cube with packed RGB */}
      <div>
        <h2 className="text-lg font-bold mb-2">2. Cube Corners (packed RGB)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <ColoredPointCloudViewer msg={cubeRGB} pointSize={0.1} />
        </div>
        <p className="text-sm text-gray-500">
          Expect: colored points at cube corners (red, green, blue, etc.)
        </p>
      </div>

      {/* Test 3: Cube with separate R,G,B fields */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          3. Cube Corners (separate R,G,B fields)
        </h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <ColoredPointCloudViewer msg={cubeSeparate} pointSize={0.1} />
        </div>
        <p className="text-sm text-gray-500">Expect: same colors as test 2.</p>
      </div>

      {/* Test 4: Cube with RGBA (alpha ignored) */}
      <div>
        <h2 className="text-lg font-bold mb-2">
          4. Cube Corners (RGBA, alpha ignored)
        </h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <ColoredPointCloudViewer msg={cubeRGBA} pointSize={0.1} />
        </div>
        <p className="text-sm text-gray-500">
          Expect: same colors as test 2 (alpha ignored).
        </p>
      </div>

      {/* Test 5: Random cloud with packed RGB */}
      <div>
        <h2 className="text-lg font-bold mb-2">5. Random Cloud (packed RGB)</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <ColoredPointCloudViewer msg={randomRGB} pointSize={0.03} />
        </div>
        <p className="text-sm text-gray-500">Expect: colorful random points.</p>
      </div>

      {/* Test 6: No color fields (should default to white) */}
      <div>
        <h2 className="text-lg font-bold mb-2">6. No Color Fields</h2>
        <div className="border border-gray-300 w-96 max-w-full aspect-square h-auto">
          <ColoredPointCloudViewer msg={noColor} pointSize={0.1} />
        </div>
        <p className="text-sm text-gray-500">
          Expect: white points at cube corners.
        </p>
      </div>
    </div>
  );
}
