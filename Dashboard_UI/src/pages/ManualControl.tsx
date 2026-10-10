// src/pages/ManualControl.tsx
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible";
import { Badge } from "../components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import PointCloudViewer from "../components/PointCloudViewer";
import VirtualJoystick from "../components/VirtualJoystick";
import {
  useRobotWebSocket,
  type TwistCommand,
} from "../hooks/useRobotWebSocket";
import { usePointCloud } from "../hooks/usePointCloud";
import { useRobotStream } from "../hooks/useRobotStream";
import { useEmergencyStop } from "../hooks/useEmergencyStop";
import { useRobotStore } from "../store/robotStore";
import { apiErrorMessage, publishInitialPose } from "../api/routes";
import type { OdomMessage } from "../api/types";

/** Convert a quaternion to roll/pitch/yaw (radians). */
function quaternionToEuler(x: number, y: number, z: number, w: number) {
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const pitch =
    Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return { roll, pitch, yaw };
}

function RobotStatePanel({ odom }: { odom: OdomMessage | null | undefined }) {
  const pose = odom?.pose?.pose;
  const twist = odom?.twist?.twist;

  const euler = useMemo(() => {
    const q = pose?.orientation;
    if (!q) return null;
    return quaternionToEuler(q.x, q.y, q.z, q.w);
  }, [pose?.orientation]);

  if (!pose) {
    return (
      <div className="text-sm text-muted-foreground">
        Waiting for odometry from the robot...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-medium mb-2">Position</h4>
        <div className="text-sm space-y-1">
          <div>X: {(pose.position.x ?? 0).toFixed(2)} m</div>
          <div>Y: {(pose.position.y ?? 0).toFixed(2)} m</div>
          <div>Z: {(pose.position.z ?? 0).toFixed(2)} m</div>
        </div>
      </div>

      <div>
        <h4 className="font-medium mb-2">Orientation</h4>
        <div className="text-sm space-y-1">
          <div>Roll: {(euler?.roll ?? 0).toFixed(3)} rad</div>
          <div>Pitch: {(euler?.pitch ?? 0).toFixed(3)} rad</div>
          <div>Yaw: {(euler?.yaw ?? 0).toFixed(3)} rad</div>
        </div>
      </div>

      <div>
        <h4 className="font-medium mb-2">Velocity</h4>
        <div className="text-sm space-y-1">
          <div>Linear: {(twist?.linear.x ?? 0).toFixed(3)} m/s</div>
          <div>Angular: {(twist?.angular.z ?? 0).toFixed(3)} rad/s</div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Frame: {odom?.child_frame_id || "—"}
      </div>
    </div>
  );
}

export default function ManualControl() {
  const [isControlActive, setIsControlActive] = useState<boolean>(false);
  const [robotStateOpen, setRobotStateOpen] = useState<boolean>(true);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [velocity, setVelocity] = useState<TwistCommand>({
    linear: 0,
    angular: 0,
  });

  /** Robot id comes from the shared store — never a literal. */
  const robotId = useRobotStore((state) => state.selectedRobotId);
  const connectionStatus = useRobotStore((state) => state.connectionStatus);
  const connected = robotId ? (connectionStatus[robotId] ?? false) : false;
  const {
    msg: pointCloud,
    isLoading: isPointCloudLoading,
    error: pointCloudError,
    unavailable: pointCloudUnavailable,
  } = usePointCloud(robotId);

  const { isConnected, statusMessage, error, sendTwist, connect, disconnect } =
    useRobotWebSocket(robotId);

  const {
    state: eStopState,
    error: eStopError,
    trigger: triggerEmergencyStop,
  } = useEmergencyStop(robotId);

  /** Live odometry for the robot state panel. */
  const { data: odomData } = useRobotStream({
    robotId,
    topic: "odom",
    autoConnect: isControlActive,
  });

  /**
   * "Reset Position" publishes the robot's own pose as its `initialpose`, i.e.
   * the same thing RViz's *2D Pose Estimate* does with the current pose: it
   * re-localises without moving the robot. It cannot move the robot, so the
   * button is honest about what it does.
   */
  const handleResetPosition = async () => {
    if (!robotId) return;

    const pose = odomData?.odom?.pose?.pose;
    if (!pose) {
      setResetError("No odometry yet — nothing to re-localise against.");
      return;
    }

    setIsResetting(true);
    setResetError(null);
    setResetMessage(null);

    try {
      const yaw = quaternionToEuler(
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
      ).yaw;

      await publishInitialPose(robotId, pose.position.x, pose.position.y, yaw);
      setResetMessage(
        `Initial pose published: x ${pose.position.x.toFixed(2)}, y ${pose.position.y.toFixed(2)}, yaw ${yaw.toFixed(2)} rad`,
      );
    } catch (err) {
      setResetError(apiErrorMessage(err));
    } finally {
      setIsResetting(false);
    }
  };

  const handleJoystickChange = (x: number, y: number) => {
    const command: TwistCommand = {
      linear: y * 0.5, // Max 0.5 m/s
      angular: -x * 1.0, // Max 1.0 rad/s
    };
    setVelocity(command);

    if (isControlActive && isConnected) {
      sendTwist(command);
    }
  };

  const toggleControl = () => {
    const newState = !isControlActive;
    setIsControlActive(newState);

    if (newState) {
      connect();
    } else {
      // `disconnect` here is stopAndDisconnect: it sends a zero twist while
      // the socket is still open, then closes it.
      disconnect();
      setVelocity({ linear: 0, angular: 0 });
    }
  };

  return (
    <div className="p-6 pb-28 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Manual Control</h1>
        <p className="text-muted-foreground">
          Direct teleoperation with real-time feedback
        </p>
      </div>

      {!robotId && (
        <Card className="border-yellow-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div className="text-sm">
              No robot selected. Pick one on the Dashboard or the Robot
              Connection page before teleoperating.
            </div>
          </CardContent>
        </Card>
      )}

      {robotId && !isConnected && isControlActive && (
        <Card className="border-yellow-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div className="text-sm">
              {error ??
                "Control is enabled but the command socket is not connected. The robot may be offline."}
            </div>
          </CardContent>
        </Card>
      )}

      {resetError && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">{resetError}</div>
          </CardContent>
        </Card>
      )}

      {resetMessage && !resetError && (
        <Card className="border-green-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="text-sm">{resetMessage}</div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Viewer */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <span>Point Cloud Viewer</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-[360px] overflow-hidden rounded-md">
                <PointCloudViewer msg={pointCloud} pointSize={0.05} />
                <div
                  aria-live="polite"
                  className={`absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs ${pointCloudError ? "text-red-300" : "text-white"
                    }`}
                >
                  {pointCloudError ??
                    (pointCloudUnavailable
                      ? "Point cloud telemetry is unavailable."
                      : pointCloud
                        ? `${pointCloud.width * pointCloud.height} points · ${robotId}`
                        : !robotId
                          ? "Select a robot to view its point cloud."
                          : isPointCloudLoading
                            ? "Connecting to point cloud telemetry…"
                            : "Waiting for point cloud data…")}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Control Interface */}
          <Card>
            <CardHeader>
              <CardTitle>Control Interface</CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                {/* Virtual Joystick */}
                <div className="space-y-4">
                  <h3 className="font-medium">Virtual Joystick</h3>
                  <VirtualJoystick
                    onMove={handleJoystickChange}
                    disabled={!isControlActive}
                  />
                  <div className="text-center text-sm text-muted-foreground">
                    Linear: {velocity.linear.toFixed(2)} m/s | Angular:{" "}
                    {velocity.angular.toFixed(2)} rad/s
                  </div>

                  {/* WebSocket status and errors */}
                  <div className="text-center text-xs">
                    <span
                      className={
                        isConnected ? "text-green-500" : "text-red-500"
                      }
                    >
                      {isConnected ? "● Connected" : "● Disconnected"}
                    </span>
                    {statusMessage && (
                      <span className="ml-2 text-gray-600">
                        {statusMessage}
                      </span>
                    )}
                    {error && <div className="text-red-500 mt-1">{error}</div>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-4 mt-6 pt-4 border-t">
                <Button
                  onClick={toggleControl}
                  variant={isControlActive ? "destructive" : "default"}
                >
                  {isControlActive ? (
                    <>
                      <Square className="w-4 h-4 mr-2" />
                      Stop Control
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Start Control
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleResetPosition()}
                  disabled={!robotId || isResetting || !connected}
                  title="Publish the robot's current pose as its initial pose (re-localise)"
                >
                  {isResetting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4 mr-2" />
                  )}
                  Reset Position
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Robot State Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Control Status
                <Badge
                  variant={isControlActive ? "default" : "secondary"}
                  className={isControlActive ? "bg-green-500" : ""}
                >
                  {isControlActive ? "Active" : "Inactive"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                <div className="text-muted-foreground">Mode</div>
                <div>Manual Teleoperation</div>
              </div>
              <div className="text-sm">
                <div className="text-muted-foreground">Safety Status</div>
                <div className="text-green-500">All Systems Normal</div>
              </div>
              <div className="text-sm">
                <div className="text-muted-foreground">Emergency Stop</div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => void triggerEmergencyStop()}
                  disabled={eStopState === "activating" || !robotId}
                >
                  {eStopState === "activating" ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <AlertCircle className="w-4 h-4 mr-2" />
                  )}
                  {eStopState === "active"
                    ? "RELEASE EMERGENCY STOP"
                    : "EMERGENCY STOP"}
                </Button>
                {eStopError && (
                  <div className="text-xs text-red-500 mt-1">{eStopError}</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Collapsible open={robotStateOpen} onOpenChange={setRobotStateOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer">
                  <CardTitle className="flex items-center justify-between">
                    Robot State
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${robotStateOpen ? "rotate-180" : ""
                        }`}
                    />
                  </CardTitle>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <RobotStatePanel odom={odomData?.odom} />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
