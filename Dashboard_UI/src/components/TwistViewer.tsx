import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ArrowHelper, Vector3 } from "three";
import { OrbitControls } from "@react-three/drei";

type Twist = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

export type Pose = {
  position: { x: number; y: number; z: number };
  orientation?: { x: number; y: number; z: number; w: number };
  twist?: Twist;
};

type Props = {
  pose: Pose; // می‌تواند از OdomMsg یا Twist message باشد
  scale?: number; // اندازه arrow
};

const TwistArrow: React.FC<{
  position: Vector3;
  twist: Twist;
  scale: number;
}> = ({ position, twist, scale }) => {
  const dir = useMemo(() => {
    const v = new Vector3(twist.linear.x, twist.linear.y, twist.linear.z);
    if (v.length() === 0) return new Vector3(0, 0, 1); // default
    return v.normalize();
  }, [twist]);

  const length = useMemo(() => {
    const v = new Vector3(twist.linear.x, twist.linear.y, twist.linear.z);
    return v.length() * scale;
  }, [twist, scale]);

  return (
    <primitive object={new ArrowHelper(dir, position, length, 0x00ff00)} />
  );
};

const TwistViewer: React.FC<Props> = ({ pose, scale = 1 }) => {
  const position = useMemo(
    () => new Vector3(pose.position.x, pose.position.y, pose.position.z ?? 0),
    [pose],
  );

  if (!pose.twist) return null;

  return (
    <div className="w-full h-full bg-black">
      <Canvas camera={{ position: [0, 5, 5], near: 0.01, far: 100 }}>
        <ambientLight intensity={0.5} />
        <OrbitControls />

        <TwistArrow position={position} twist={pose.twist} scale={scale} />

        {/* optional: robot as sphere */}
        <mesh position={position}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="red" />
        </mesh>

        <axesHelper args={[1]} />
      </Canvas>
    </div>
  );
};

export default TwistViewer;
