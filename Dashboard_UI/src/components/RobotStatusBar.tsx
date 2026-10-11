import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Battery,
  Wifi,
  WifiOff,
  Circle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Thermometer,
  Activity,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "./ui/utils";
import { useAuthStore } from "../store/authStore";
import {
  useRobotStore,
  useSelectedRobot,
  useSelectedRobotConnected,
} from "../store/robotStore";
import { useEmergencyStop } from "../hooks/useEmergencyStop";
import { useRobotState } from "../hooks/useRobotState";
import { useFleet } from "../hooks/useFleet";

/**
 * The dashboard-wide status strip.
 *
 * Every value here is real: connection state comes from the fleet poll, battery
 * / mode / temperature from `GET /sim/robots/{id}` (see hooks/useRobotState.ts),
 * and the emergency-stop button drives the robot's real
 * `emergency_stop` topic through POST /navigation/{id}/emergency_stop/{state}.
 *
 * The battery is *also* published as a ROS topic (`battery_state`) which the
 * backend never exposes over a WebSocket, so the helper route is the only way to
 * read it — when a backend answers 404 for it the strip degrades to "n/a"
 * instead of inventing a number.
 */
export default function RobotStatusBar() {
  const navigate = useNavigate();

  const { logout } = useAuthStore();
  const selectedRobotSummary = useSelectedRobot();
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const isConnected = useSelectedRobotConnected();

  // Keeps the connection dot honest on pages that do not poll the fleet.
  useFleet({ pollIntervalMs: 5000 });

  const {
    state: robotState,
    unavailable: stateUnavailable,
    lastUpdatedAt,
  } = useRobotState(selectedRobotId, { pollIntervalMs: 2000 });

  const {
    state: eStopState,
    error: eStopError,
    trigger: triggerEmergencyStop,
  } = useEmergencyStop(selectedRobotId);

  /** A ticking clock for the header, kept out of the render path. */
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedRobot = selectedRobotSummary
    ? `${selectedRobotSummary.type} (${selectedRobotSummary.id})`
    : "No robot selected";

  const batteryPercentage = robotState ? robotState.battery.percentage * 100 : null;
  const batteryLevel = batteryPercentage ?? 0;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const getBatteryStatus = () => {
    if (batteryPercentage === null)
      return { color: "text-muted-foreground", status: "n/a", bgColor: "bg-gray-400" };
    if (batteryLevel > 60)
      return {
        color: "text-emerald-500",
        status: "Good",
        bgColor: "bg-emerald-500",
      };
    if (batteryLevel > 30)
      return {
        color: "text-yellow-500",
        status: "Medium",
        bgColor: "bg-yellow-500",
      };
    if (batteryLevel > 15)
      return {
        color: "text-orange-500",
        status: "Low",
        bgColor: "bg-orange-500",
      };
    return { color: "text-red-500", status: "Critical", bgColor: "bg-red-500" };
  };

  /** Mode is derived from the robot's real task, not a local guess. */
  const mode = (() => {
    if (!isConnected) return "Offline";
    if (robotState?.emergency_stopped || eStopState === "active") return "Emergency";
    switch (robotState?.task) {
      case "mapping":
        return "Mapping";
      case "exploring":
        return "Exploring";
      case "navigation":
        return "Navigation";
      default:
        return "Idle";
    }
  })();

  const getModeConfig = () => {
    const modes = {
      Navigation: {
        color: "bg-blue-500",
        icon: "🧭",
        description: "Autonomous navigation active",
      },
      Exploring: {
        color: "bg-teal-500",
        icon: "🧭",
        description: "Frontier exploration running",
      },
      Mapping: {
        color: "bg-purple-500",
        icon: "🗺️",
        description: "SLAM mapping in progress",
      },
      Manual: {
        color: "bg-orange-500",
        icon: "🎮",
        description: "Manual control active",
      },
      Idle: { color: "bg-gray-500", icon: "⏸️", description: "Robot is idle" },
      Offline: {
        color: "bg-gray-600",
        icon: "📴",
        description: "Robot is not connected",
      },
      Emergency: {
        color: "bg-red-500",
        icon: "🚨",
        description: "Emergency stop activated",
      },
    };
    return modes[mode as keyof typeof modes] ?? modes.Idle;
  };

  /** Link quality follows connection state; Wi-Fi bars are not measurable. */
  const connectionQuality = isConnected
    ? { label: "Connected", color: "text-emerald-500", bars: 4 }
    : { label: "Offline", color: "text-red-500", bars: 0 };

  const systemHealth = (() => {
    if (!isConnected) return { label: "Offline", color: "text-muted-foreground" };
    if (batteryPercentage !== null && batteryLevel <= 15)
      return { label: "Battery low", color: "text-orange-500" };
    if (robotState?.emergency_stopped)
      return { label: "E-stop engaged", color: "text-red-500" };
    if (
      robotState &&
      robotState.hardware.cpu_temperature >= 70
    )
      return { label: "Running hot", color: "text-yellow-500" };
    return { label: "Nominal", color: "text-emerald-600" };
  })();

  const batteryStatus = getBatteryStatus();
  const modeConfig = getModeConfig();

  const cpuLoadPercent = robotState ? robotState.hardware.cpu_load * 100 : null;

  return (
    <div className="bg-card border-b border-border px-3 sm:px-4 lg:px-6 py-3 lg:py-4 shadow-sm">
      <div className="flex flex-nowrap items-center justify-between gap-2 lg:gap-3">
        <div className="flex flex-nowrap items-center gap-3 lg:gap-8 min-w-0 overflow-x-auto">
          {/* Robot Connection Status */}
          <div className="flex items-center space-x-3 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center space-x-2 cursor-pointer">
                  <div className="relative">
                    {isConnected ? (
                      <div className="flex items-center space-x-1">
                        <Circle className="w-3 h-3 fill-emerald-500 text-emerald-500 animate-pulse-slow" />
                        <Wifi className="w-4 h-4 text-emerald-500" />
                      </div>
                    ) : (
                      <div className="flex items-center space-x-1">
                        <Circle className="w-3 h-3 fill-red-500 text-red-500" />
                        <WifiOff className="w-4 h-4 text-red-500" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate max-w-[10rem] sm:max-w-none">
                      {selectedRobot}
                    </div>
                    <div className={cn("text-xs", connectionQuality.color)}>
                      {connectionQuality.label}
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-2">
                  <div className="font-medium">Connection Details</div>
                  <div className="text-xs space-y-1">
                    <div>
                      Status: {isConnected ? "Connected (rosbridge)" : "Disconnected"}
                    </div>
                    {robotState?.connection_address && (
                      <div>
                        Bridge: {robotState.connection_address.host}:
                        {robotState.connection_address.port}
                      </div>
                    )}
                    <div>
                      Last state update:{" "}
                      {lastUpdatedAt
                        ? new Date(lastUpdatedAt).toLocaleTimeString()
                        : "never"}
                    </div>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Battery Status */}
          <div className="flex items-center space-x-3 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center space-x-2 cursor-pointer">
                  <div className="relative">
                    <Battery className={cn("w-5 h-5", batteryStatus.color)} />
                    {batteryPercentage !== null && batteryLevel <= 15 && (
                      <AlertTriangle className="w-3 h-3 text-red-500 absolute -top-1 -right-1 animate-bounce" />
                    )}
                  </div>
                  <div>
                    <div
                      className={cn("text-sm font-medium", batteryStatus.color)}
                    >
                      {batteryPercentage === null
                        ? "—"
                        : `${batteryLevel.toFixed(0)}%`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {batteryStatus.status}
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-3">
                  <div className="font-medium">Battery Information</div>
                  {robotState ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Current Level:</span>
                        <span className={batteryStatus.color}>
                          {batteryLevel.toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={batteryLevel} className="h-2" />
                      <div className="text-xs space-y-1">
                        <div>Status: {batteryStatus.status}</div>
                        <div>Voltage: {robotState.battery.voltage.toFixed(2)} V</div>
                        <div>Current: {robotState.battery.current.toFixed(2)} A</div>
                        <div>
                          Temperature: {robotState.battery.temperature.toFixed(1)} °C
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {stateUnavailable
                        ? "This backend exposes no battery telemetry."
                        : "No battery telemetry yet."}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Current Mode */}
          <div className="flex items-center space-x-3 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center space-x-2 cursor-pointer">
                  <span className="text-sm text-muted-foreground">Mode:</span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      `${modeConfig.color} text-white border-0 shadow-sm`,
                      "hover:shadow-md transition-shadow",
                    )}
                  >
                    <span className="mr-1">{modeConfig.icon}</span>
                    {mode}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-2">
                  <div className="font-medium">Current Mode</div>
                  <div className="text-xs">{modeConfig.description}</div>
                  {robotState?.goal_text && robotState.goal_text !== "none" && (
                    <div className="text-xs text-muted-foreground">
                      Goal: {robotState.goal_text}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* System Health */}
          <div className="flex items-center space-x-2 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center space-x-2 cursor-pointer">
                  <CheckCircle2 className={cn("w-4 h-4", systemHealth.color)} />
                  <div>
                    <div className={cn("text-sm font-medium", systemHealth.color)}>
                      {systemHealth.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      System Health
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-2">
                  <div className="font-medium">System Status</div>
                  {robotState ? (
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between gap-4">
                        <span>CPU load:</span>
                        <span>
                          {cpuLoadPercent === null
                            ? "—"
                            : `${cpuLoadPercent.toFixed(0)}%`}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>CPU temp:</span>
                        <span>
                          {robotState.hardware.cpu_temperature.toFixed(1)} °C
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>Motor temp:</span>
                        <span>
                          {robotState.hardware.motor_temperature.toFixed(1)} °C
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span>Sim time:</span>
                        <span>{robotState.sim_time.toFixed(1)} s</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No hardware telemetry available.
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Temperature shortcut — only when there is something to show. */}
          {robotState && (
            <div className="hidden xl:flex items-center space-x-2 text-xs text-muted-foreground">
              <Thermometer className="w-3.5 h-3.5" />
              <span>{robotState.hardware.cpu_temperature.toFixed(0)} °C</span>
              <Activity className="w-3.5 h-3.5 ml-2" />
              <span>
                {robotState.map.mapped_ratio > 0
                  ? `${(robotState.map.mapped_ratio * 100).toFixed(0)}% mapped`
                  : "no map"}
              </span>
            </div>
          )}
        </div>

        {/* Right Side Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-4 shrink-0">
          {/* System Time */}
          <div className="text-right hidden lg:block">
            <div className="text-sm font-medium whitespace-nowrap">
              {now.toLocaleTimeString()}
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              {now.toLocaleDateString()}
            </div>
          </div>

          {/* Emergency Stop */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                className={cn(
                  "bg-red-600 hover:bg-red-700 shadow-md hover:shadow-lg transition-all duration-200",
                  eStopState === "active" && "animate-pulse",
                )}
                onClick={() => void triggerEmergencyStop()}
                disabled={eStopState === "activating" || !selectedRobotSummary}
              >
                {eStopState === "activating" ? (
                  <Loader2 className="w-4 h-4 sm:mr-1 animate-spin" />
                ) : (
                  <AlertTriangle className="w-4 h-4 sm:mr-1" />
                )}
                <span className="hidden sm:inline">E-Stop</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-center">
                <div className="font-medium text-red-500">
                  Emergency Stop
                  {eStopState === "active" ? " (ACTIVE)" : ""}
                </div>
                <div className="text-xs">
                  {eStopError
                    ? eStopError
                    : eStopState === "active"
                      ? "Click to release the emergency stop"
                      : "Immediately halt all robot operations"}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>

          {/* Logout Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="shadow-sm hover:bg-accent transition-all duration-200"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-center">
                <div className="font-medium">Sign Out</div>
                <div className="text-xs">Disconnect and end session</div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Connection Quality Indicator */}
      <div className="flex items-center justify-center mt-2">
        <div className="flex space-x-1">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1 h-3 rounded-full transition-colors",
                i < connectionQuality.bars
                  ? connectionQuality.color.replace("text-", "bg-")
                  : "bg-gray-300",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
