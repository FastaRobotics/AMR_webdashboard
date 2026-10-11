import React from "react";

type BatteryStatusMsg = {
  percentage: number; // 0.0 - 1.0
  voltage?: number; // optional
  current?: number; // optional
};

type Props = {
  battery: BatteryStatusMsg | null;
};

const BatteryStatus: React.FC<Props> = ({ battery }) => {
  if (!battery) return <div>Battery data not available</div>;

  const percent = Math.max(0, Math.min(1, battery.percentage));

  // رنگ باتری
  let color = "bg-green-500";
  if (percent < 0.3) color = "bg-red-500";
  else if (percent < 0.6) color = "bg-yellow-500";

  return (
    <div className="w-full max-w-48 p-2 border border-border rounded-lg bg-card text-card-foreground">
      <div className="flex justify-between mb-1">
        <span>Battery</span>
        <span>{Math.round(percent * 100)}%</span>
      </div>
      <div className="w-full h-4 bg-muted rounded">
        <div
          className={`${color} h-4 rounded`}
          style={{ width: `${percent * 100}%` }}
        />
      </div>
      {battery.voltage !== undefined && (
        <div className="text-xs mt-1">
          Voltage: {battery.voltage.toFixed(2)} V
        </div>
      )}
      {battery.current !== undefined && (
        <div className="text-xs">Current: {battery.current.toFixed(2)} A</div>
      )}
    </div>
  );
};

export default BatteryStatus;
