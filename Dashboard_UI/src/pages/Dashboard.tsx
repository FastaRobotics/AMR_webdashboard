import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip";
import {
  Bot,
  Camera,
  Map,
  Navigation,
  Target,
  Shield,
  Gauge,
  Activity,
  AlertCircle,
  CheckCircle,
  Cpu,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "../components/ui/utils";
import { useFleet } from "../hooks/useFleet";
import { useRobotStream } from "../hooks/useRobotStream";
import { useRobotState } from "../hooks/useRobotState";
import { API_BASE_URL } from "../api/config";
import type { DiagnosticLevel, DiagnosticStatus } from "../api/types";

/**
 * Screen these topics have no REST equivalent in the backend — telemetry is
 * only available over the streaming WebSocket — so the dashboard reads
 * `diagnostics` for per-service health and counts the fleet over REST.
 */

const DIAGNOSTIC_LEVELS: Record<
  DiagnosticLevel,
  { label: string; badge: string }
> = {
  0: { label: "OK", badge: "bg-green-500" },
  1: { label: "Warn", badge: "bg-yellow-500" },
  2: { label: "Error", badge: "bg-red-500" },
  3: { label: "Stale", badge: "bg-gray-500" },
};

function levelConfig(level: DiagnosticLevel) {
  return DIAGNOSTIC_LEVELS[level] ?? DIAGNOSTIC_LEVELS[3];
}

export default function Dashboard() {
  const {
    robots,
    selectedRobotId,
    connectionStatus,
    isLoading,
    isRefreshing,
    error,
    refresh,
    selectRobot,
  } = useFleet();

  /** Live service health for the selected robot. */
  const {
    data: diagnosticsData,
    isConnected: diagnosticsConnected,
    error: diagnosticsError,
  } = useRobotStream({
    robotId: selectedRobotId,
    topic: "diagnostics",
  });

  /**
   * Battery, task, goal and map statistics have no WebSocket route, so they are
   * polled from the backend's robot-state endpoint.
   */
  const { state: robotState } = useRobotState(selectedRobotId, {
    pollIntervalMs: 2000,
  });

  const connectedCount = useMemo(
    () => robots.filter((robot) => connectionStatus[robot.id]).length,
    [connectionStatus, robots],
  );

  const diagnosticServices: DiagnosticStatus[] = useMemo(
    () => diagnosticsData?.diagnostics?.status ?? [],
    [diagnosticsData],
  );

  const healthyCount = diagnosticServices.filter((s) => s.level === 0).length;
  const problemCount = diagnosticServices.length - healthyCount;

  /** Prefer the streamed status; fall back to the polled state. */
  const robotStatus = diagnosticsData?.status ?? robotState?.status;

  const features = [
    {
      title: "Manual Control",
      description:
        "Real-time teleoperation with camera feed and joystick control",
      icon: Gauge,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      href: "/manual-control",
      status: "Ready",
    },
    {
      title: "SLAM Mapping",
      description: "Create detailed maps using advanced SLAM algorithms",
      icon: Map,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      href: "/mapping",
      status: "Ready",
    },
    {
      title: "Autonomous Navigation",
      description: "Navigate to precise coordinates with obstacle avoidance",
      icon: Navigation,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      href: "/navigation",
      status: "Ready",
    },
    {
      title: "Mission Planning",
      description: "Execute complex missions with real-time monitoring",
      icon: Target,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
      href: "/mission-control",
      status: "Ready",
    },
    {
      title: "Live Camera Feed",
      description: "Monitor camera feeds and control recording",
      icon: Camera,
      color: "text-red-500",
      bgColor: "bg-red-500/10",
      href: "/live-camera",
      status: "Live",
    },
    {
      title: "Robot Connection",
      description: "Connect robots and review system diagnostics",
      icon: Shield,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
      href: "/robot-connection",
      status: "Active",
    },
  ];

  return (
    <div className="p-6 pb-28 space-y-8 animate-fade-in overflow-x-hidden">
      {/* Hero Section */}
      <div className="text-center py-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 animate-pulse-slow" />
        <div className="relative">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
            Robot Fleet Operations Center
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Advanced control interface for managing autonomous robots in
            industrial environments. Monitor, control, and coordinate your
            robotic fleet with precision and reliability.
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-6">
            <Button
              onClick={() => void refresh()}
              variant="outline"
              disabled={isRefreshing}
              className="hover:shadow-md transition-shadow"
            >
              <RefreshCw
                className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")}
              />
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </Button>
            <Button
              className="gradient-primary hover:shadow-md transition-shadow"
              asChild
            >
              <a
                href={`${API_BASE_URL}/docs`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Backend API Docs
              </a>
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <div className="font-medium">Backend unreachable</div>
              <div className="text-sm text-muted-foreground">{error}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fleet Overview — real data from GET /connection/robot_list */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Fleet Overview</h2>
          {isLoading && (
            <span className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Loading fleet...
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Bot className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium">Registered Robots</span>
                </div>
                <span className="text-lg font-bold">{robots.length}</span>
              </div>
              <Progress
                value={robots.length ? (connectedCount / robots.length) * 100 : 0}
                className="h-2"
              />
              <div className="text-xs text-muted-foreground mt-2">
                {connectedCount} of {robots.length} connected
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Activity className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium">Selected Robot State</span>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-xs",
                    robotStatus === "run_task" && "bg-blue-500 text-white",
                    robotStatus === "idle" && "bg-green-500 text-white",
                    robotStatus === "offline" && "bg-gray-500 text-white",
                  )}
                >
                  {robotStatus ?? "unknown"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {diagnosticsConnected
                  ? "Live over WebSocket"
                  : "No live stream"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Selected: {selectedRobotId ?? "none"}
              </div>

              {robotState ? (
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Battery</span>
                    <span>
                      {(robotState.battery.percentage * 100).toFixed(0)}% ·{" "}
                      {robotState.battery.voltage.toFixed(1)} V
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Task</span>
                    <span>{robotState.task ?? "idle"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Map known</span>
                    <span>{(robotState.map.mapped_ratio * 100).toFixed(0)}%</span>
                  </div>
                  {robotState.goal_text && robotState.goal_text !== "none" && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Goal</span>
                      <span className="truncate pl-2">
                        {robotState.goal_text} ·{" "}
                        {robotState.distance_remaining_m.toFixed(1)} m
                      </span>
                    </div>
                  )}
                  {robotState.emergency_stopped && (
                    <div className="text-red-500 font-medium">
                      Emergency stop engaged
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground">
                  No robot-state telemetry available.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Cpu className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium">Diagnostics</span>
                </div>
                <span className="text-lg font-bold">
                  {diagnosticServices.length}
                </span>
              </div>
              {diagnosticServices.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {healthyCount} OK
                  {problemCount > 0 && (
                    <span className="text-yellow-600">
                      {" "}
                      · {problemCount} need attention
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {diagnosticsError
                    ? diagnosticsError
                    : "Waiting for diagnostics stream"}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Robot List — lets every other page follow the same selection */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Fleet Status</h2>
          <span className="text-sm text-muted-foreground">
            Selecting a robot applies across the dashboard
          </span>
        </div>

        {robots.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No robots are registered on the backend.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {robots.map((robot) => {
              const connected = connectionStatus[robot.id] ?? false;
              const isSelected = robot.id === selectedRobotId;

              return (
                <Card
                  key={robot.id}
                  className={cn(
                    "overflow-hidden hover:shadow-xl transition-all duration-300",
                    isSelected && "ring-2 ring-primary",
                  )}
                >
                  <div
                    className={cn(
                      "h-2 bg-gradient-to-r",
                      connected
                        ? "from-green-500 to-emerald-500"
                        : "from-gray-400 to-gray-500",
                    )}
                  />
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-xl bg-muted">
                          <Bot className="w-6 h-6" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{robot.id}</CardTitle>
                          <CardDescription className="font-medium">
                            {robot.type}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge
                        variant={connected ? "default" : "secondary"}
                        className={cn(
                          connected
                            ? "bg-green-500 hover:bg-green-600"
                            : "bg-gray-500 text-white",
                        )}
                      >
                        {connected ? (
                          <CheckCircle className="w-3 h-3 mr-1" />
                        ) : (
                          <AlertCircle className="w-3 h-3 mr-1" />
                        )}
                        {connected ? "Connected" : "Offline"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-xs text-muted-foreground">
                        {isSelected ? "Currently selected" : "Not selected"}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={isSelected ? "secondary" : "outline"}
                          size="sm"
                          disabled={isSelected}
                          onClick={() => selectRobot(robot.id)}
                        >
                          {isSelected ? "Selected" : "Select"}
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to="/robot-connection">
                                <ArrowRight className="w-4 h-4" />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Manage connection</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Live Diagnostics — real data from the `diagnostics` ROS topic */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Live Diagnostics</h2>
        <Card>
          <CardContent className="p-0">
            {diagnosticServices.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                {diagnosticsError
                  ? diagnosticsError
                  : selectedRobotId
                    ? "Waiting for the first diagnostics message from the robot..."
                    : "Select a robot to stream diagnostics."}
              </div>
            ) : (
              <div className="divide-y">
                {diagnosticServices.map((service) => {
                  const config = levelConfig(service.level);
                  return (
                    <div
                      key={service.name}
                      className="flex items-center justify-between p-4"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {service.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {service.message || service.hardware_id || "—"}
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn("text-white", config.badge)}
                      >
                        {config.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Dashboard Features */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Available Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Tooltip key={feature.title}>
                <TooltipTrigger asChild>
                  <Card className="group hover:shadow-xl transition-all duration-300 hover:scale-[1.05] cursor-pointer animate-scale-in">
                    <Link to={feature.href}>
                      <CardContent className="p-6 relative overflow-hidden">
                        <div
                          className={cn(
                            "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity",
                            feature.bgColor,
                          )}
                        />
                        <div className="relative">
                          <div className="flex items-start justify-between mb-4">
                            <Icon
                              className={cn(
                                "w-8 h-8 transition-colors group-hover:scale-110",
                                feature.color,
                              )}
                            />
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-xs transition-colors",
                                feature.status === "Live" &&
                                "bg-red-500/20 text-red-700",
                                feature.status === "Active" &&
                                "bg-green-500/20 text-green-700",
                              )}
                            >
                              {feature.status}
                            </Badge>
                          </div>
                          <h3 className="font-semibold mb-2 group-hover:text-primary transition-colors">
                            {feature.title}
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {feature.description}
                          </p>
                          <div className="flex items-center mt-4 text-sm text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                            <span>Explore feature</span>
                            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      </CardContent>
                    </Link>
                  </Card>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-center">
                    <div className="font-medium">{feature.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Click to access
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </section>
    </div>
  );
}
