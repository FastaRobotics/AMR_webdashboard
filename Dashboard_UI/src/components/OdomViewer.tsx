import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";

export type OdomMsg = {
  pose: {
    pose: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  twist?: {
    twist: {
      linear: { x: number; y: number; z: number };
      angular: { x: number; y: number; z: number };
    };
  };
};

type Props = {
  odomHistory: OdomMsg[]; // آرایه تاریخچه موقعیت‌ها برای نمایش مسیر
  robotSize?: number; // شعاع کروی ربات
};

const OdomViewer: React.FC<Props> = ({ odomHistory, robotSize = 0.1 }) => {
  const positions = useMemo(() => {
    const points: number[] = [];
    odomHistory.forEach((msg) => {
      const { x, y, z } = msg.pose.pose.position;
      points.push(x, y, z ?? 0); // number[]
    });
    return points;
  }, [odomHistory]);

  // آخرین موقعیت ربات
  const latestPose = odomHistory.length
    ? odomHistory[odomHistory.length - 1].pose.pose.position
    : { x: 0, y: 0, z: 0 };

  return (
    <div className="w-full h-full bg-black">
      <Canvas camera={{ position: [0, 5, 5], near: 0.01, far: 100 }}>
        <ambientLight intensity={0.5} />
        <OrbitControls />

        {/* مسیر حرکت ربات */}
        {positions.length > 0 && (
          <Line points={positions} color="cyan" lineWidth={2} />
        )}

        {/* موقعیت فعلی ربات */}
        <mesh position={[latestPose.x, latestPose.y, latestPose.z ?? 0]}>
          <sphereGeometry args={[robotSize, 16, 16]} />
          <meshStandardMaterial color="red" />
        </mesh>

        {/* محورهای اصلی */}
        <axesHelper args={[1]} />
      </Canvas>
    </div>
  );
};

export default OdomViewer;
