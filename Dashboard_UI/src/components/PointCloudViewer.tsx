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
  data: string | number[];
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

function parseXYZ(msg: PointCloud2Msg) {
  if (
    !msg.data ||
    msg.width <= 0 ||
    msg.height <= 0 ||
    msg.point_step <= 0
  ) {
    return new Float32Array();
  }

  const buffer =
    typeof msg.data === "string"
      ? base64ToArrayBuffer(msg.data)
      : Uint8Array.from(msg.data).buffer;
  const view = new DataView(buffer);

  const xField = msg.fields.find((f) => f.name === "x");
  const yField = msg.fields.find((f) => f.name === "y");
  const zField = msg.fields.find((f) => f.name === "z");

  if (
    !xField ||
    !yField ||
    !zField ||
    [xField, yField, zField].some(
      (field) => field.datatype !== 7 || field.offset + 4 > msg.point_step,
    )
  ) {
    return new Float32Array();
  }

  const points: number[] = [];
  const littleEndian = !msg.is_bigendian;

  for (let row = 0; row < msg.height; row++) {
    for (let column = 0; column < msg.width; column++) {
      const offset = row * msg.row_step + column * msg.point_step;
      if (offset + msg.point_step > view.byteLength) continue;

      const x = view.getFloat32(offset + xField.offset, littleEndian);
      const y = view.getFloat32(offset + yField.offset, littleEndian);
      const z = view.getFloat32(offset + zField.offset, littleEndian);

      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push(x, y, z);
      }
    }
  }

  return new Float32Array(points);
}

const CloudPoints: React.FC<{ points: Float32Array; size: number }> = ({
  points,
  size,
}) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
    return geo;
  }, [points]);

  return (
    <points geometry={geometry}>
      <pointsMaterial size={size} sizeAttenuation depthWrite={false} />
    </points>
  );
};

const PointCloudViewer: React.FC<Props> = ({ msg, pointSize = 0.05 }) => {
  const points = useMemo(() => {
    if (!msg) return new Float32Array();
    return parseXYZ(msg);
  }, [msg]);

  return (
    <div className="w-full h-full bg-black">
      <Canvas camera={{ position: [0, 0, 10], near: 0.01, far: 1000 }}>
        <ambientLight />
        <CloudPoints points={points} size={pointSize} />
        <OrbitControls />
      </Canvas>
    </div>
  );
};

export default PointCloudViewer;
