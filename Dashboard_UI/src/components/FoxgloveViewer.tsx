/**
 * FoxgloveViewer — the map view the page components already mount.
 *
 * It used to be a hand-drawn mock (animated "LIDAR" points, a fixed robot
 * rectangle, a fake plan). It is now a thin wrapper around `MapPanel`, which
 * renders live backend telemetry, so the mapping / manual-control / mission /
 * navigation pages get a real map without changing their imports.
 *
 * The robot comes from the `robotId` prop when a page passes one, otherwise
 * from the dashboard-wide selection in `robotStore` (falling back to the first
 * robot in the fleet so the panel is live even before a robot is picked).
 */

import { useRobotStore } from "../store/robotStore";
import MapPanel, { type MapPanelProps } from "./MapPanel";

export interface FoxgloveViewerProps extends Omit<MapPanelProps, "robotId"> {
  /** Overrides the globally selected robot. */
  robotId?: string | null;
}

export default function FoxgloveViewer({
  robotId,
  ...mapProps
}: FoxgloveViewerProps) {
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const firstRobotId = useRobotStore((state) => state.robots[0]?.id ?? null);
  const target = robotId ?? selectedRobotId ?? firstRobotId;

  return <MapPanel robotId={target} {...mapProps} />;
}
