import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";

export type Transform = {
  header: {
    frame_id: string;
  };
  child_frame_id: string;
  transform: {
    translation: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  };
};

export type TFMessage = {
  transforms: Transform[];
};

type Props = {
  tf: TFMessage | null;
  axisSize?: number;
};

function createPose(transform: Transform["transform"]) {
  const position = new THREE.Vector3(
    transform.translation.x,
    transform.translation.y,
    transform.translation.z,
  );

  const quaternion = new THREE.Quaternion(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
  );

  return { position, quaternion };
}

const FrameAxes: React.FC<{
  transform: Transform;
  size: number;
}> = ({ transform, size }) => {
  const { position, quaternion } = createPose(transform.transform);

  return (
    <group position={position} quaternion={quaternion}>
      <axesHelper args={[size]} />
    </group>
  );
};

const FrameLink: React.FC<{ transform: Transform }> = ({ transform }) => {
  const start: [number, number, number] = [0, 0, 0];

  const end: [number, number, number] = [
    transform.transform.translation.x,
    transform.transform.translation.y,
    transform.transform.translation.z,
  ];

  return <Line points={[start, end]} lineWidth={1} />;
};

const TFViewer: React.FC<Props> = ({ tf, axisSize = 0.3 }) => {
  const transforms = useMemo(() => tf?.transforms ?? [], [tf]);

  return (
    <div className="w-full h-full bg-black">
      <Canvas camera={{ position: [2, 2, 2], near: 0.01, far: 1000 }}>
        <ambientLight intensity={0.6} />
        <OrbitControls />

        {transforms.map((t, i) => (
          <group key={i}>
            <FrameAxes transform={t} size={axisSize} />
            <FrameLink transform={t} />
          </group>
        ))}
      </Canvas>
    </div>
  );
};

export default TFViewer;
