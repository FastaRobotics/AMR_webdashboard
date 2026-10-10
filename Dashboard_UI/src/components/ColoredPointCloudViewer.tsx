import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type PointField = {
  name: string;
  offset: number;
  datatype: number;
  count: number;
};

export type PointCloud2Msg = {
  width: number;
  height: number;
  point_step: number;
  row_step: number;
  fields: PointField[];
  is_bigendian: boolean;
  data: string; // base64
};

type Props = {
  msg: PointCloud2Msg | null;
  pointSize?: number;
};

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new Uint8Array(len);
  for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

// Parse XYZ positions and RGB colors
function parsePointCloud(msg: PointCloud2Msg): {
  positions: Float32Array;
  colors: Float32Array;
} {
  if (!msg?.data)
    return { positions: new Float32Array(), colors: new Float32Array() };

  const buffer = base64ToArrayBuffer(msg.data);
  const view = new DataView(buffer);
  const littleEndian = !msg.is_bigendian;

  const xField = msg.fields.find((f) => f.name === "x");
  const yField = msg.fields.find((f) => f.name === "y");
  const zField = msg.fields.find((f) => f.name === "z");

  // Color fields – support various encodings
  const rgbField = msg.fields.find((f) => f.name === "rgb");
  const rgbaField = msg.fields.find((f) => f.name === "rgba");
  const rField = msg.fields.find((f) => f.name === "r");
  const gField = msg.fields.find((f) => f.name === "g");
  const bField = msg.fields.find((f) => f.name === "b");

  // Determine color mode
  let colorMode: "rgb" | "rgba" | "separate" | "none" = "none";
  if (rgbField) colorMode = "rgb";
  else if (rgbaField) colorMode = "rgba";
  else if (rField && gField && bField) colorMode = "separate";

  if (!xField || !yField || !zField) {
    return { positions: new Float32Array(), colors: new Float32Array() };
  }

  const numPoints = msg.width * msg.height;
  const positions: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i < numPoints; i++) {
    const offset = i * msg.point_step;

    // Position
    const x = view.getFloat32(offset + xField.offset, littleEndian);
    const y = view.getFloat32(offset + yField.offset, littleEndian);
    const z = view.getFloat32(offset + zField.offset, littleEndian);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      // Skip invalid points, but we need consistent arrays; we can push default color or skip.
      // For simplicity, we'll push default color (white) for skipped points.
      // Alternatively, we could filter points and colors together. Here we'll keep all points and assign default color.
    }

    positions.push(x, y, z);

    // Color
    let r = 1.0,
      g = 1.0,
      b = 1.0; // default white

    if (colorMode === "rgb" && rgbField) {
      // RGB is typically a uint32 with r,g,b in consecutive bytes. Order varies: often r,g,b from low to high or high to low.
      // In ROS, it's often a uint32 with r,g,b in that order from low to high (little-endian).
      const rgbPacked = view.getUint32(offset + rgbField.offset, littleEndian);
      // Extract components: assuming r = (rgb >> 16) & 0xFF, g = (rgb >> 8) & 0xFF, b = rgb & 0xFF
      // This matches common ROS convention (e.g., from sensor_msgs/PointCloud2).
      r = ((rgbPacked >> 16) & 0xff) / 255.0;
      g = ((rgbPacked >> 8) & 0xff) / 255.0;
      b = (rgbPacked & 0xff) / 255.0;
    } else if (colorMode === "rgba" && rgbaField) {
      const rgbaPacked = view.getUint32(
        offset + rgbaField.offset,
        littleEndian,
      );
      r = ((rgbaPacked >> 24) & 0xff) / 255.0;
      g = ((rgbaPacked >> 16) & 0xff) / 255.0;
      b = ((rgbaPacked >> 8) & 0xff) / 255.0;
      // a is ignored
    } else if (colorMode === "separate" && rField && gField && bField) {
      // Assume fields are float32 (common) or uint8. We'll handle based on datatype.
      // For simplicity, assume float32 (datatype 7) or uint8 (datatype 2). We'll detect.
      const getValue = (field: PointField): number => {
        if (field.datatype === 7) {
          // float32
          return view.getFloat32(offset + field.offset, littleEndian);
        } else if (field.datatype === 2) {
          // uint8
          return view.getUint8(offset + field.offset);
        } else {
          return 0; // unsupported
        }
      };
      r = getValue(rField);
      g = getValue(gField);
      b = getValue(bField);
      // Normalize if uint8 (0-255) to 0-1
      if (rField.datatype === 2) r /= 255.0;
      if (gField.datatype === 2) g /= 255.0;
      if (bField.datatype === 2) b /= 255.0;
    }

    colors.push(r, g, b);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
  };
}

const ColoredCloudPoints: React.FC<{
  positions: Float32Array;
  colors: Float32Array;
  size: number;
}> = ({ positions, colors, size }) => {
  const geometry = useMemo(() => {
    if (positions.length === 0 || colors.length === 0)
      return new THREE.BufferGeometry();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [positions, colors]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={size}
        vertexColors
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
};

const ColoredPointCloudViewer: React.FC<Props> = ({
  msg,
  pointSize = 0.05,
}) => {
  const { positions, colors } = useMemo(() => {
    if (!msg)
      return { positions: new Float32Array(), colors: new Float32Array() };
    return parsePointCloud(msg);
  }, [msg]);

  return (
    <div className="w-full h-full bg-black">
      <Canvas camera={{ position: [0, 0, 5], near: 0.01, far: 1000 }}>
        <ambientLight />
        <ColoredCloudPoints
          positions={positions}
          colors={colors}
          size={pointSize}
        />
        <OrbitControls />
      </Canvas>
    </div>
  );
};

export default ColoredPointCloudViewer;
