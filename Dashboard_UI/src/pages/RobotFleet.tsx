import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import {
  Truck,
  Dog,
  Activity,
  Battery,
  Wifi,
  MapPin,
  Shield,
  Search,
  Package,
  Play,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Cpu,
  Thermometer,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { useFleet } from "../hooks/useFleet";
import { useRobotState } from "../hooks/useRobotState";
import { useRobotStore, useSelectedRobot } from "../store/robotStore";
import type { RobotSummary } from "../api/types";

/**
 * The fleet overview page.
 *
 * Everything on it is derived from the backend: the robot list and connection
 * badges come from the fleet poll, battery/task/pose from the robot-state
 * endpoint, and the per-class sections group the robots by the backend's own
 * `type` field ("AMR" / "Go2") rather than assuming a fixed fleet size.
 */

function RobotCard({ robot }: { robot: RobotSummary }) {
  const connectionStatus = useRobotStore((state) => state.connectionStatus);
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const selectRobot = useRobotStore((state) => state.selectRobot);

  const connected = connectionStatus[robot.id] ?? false;
  const isSelected = robot.id === selectedRobotId;

  const { state, unavailable } = useRobotState(robot.id, {
    pollIntervalMs: 3000,
  });

  const battery = state ? state.battery.percentage * 100 : null;

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        isSelected ? "ring-2 ring-primary" : "hover:shadow-md",
      )}
    >
      <div
        className={cn(
          "h-1.5 bg-gradient-to-r",
          connected
            ? "from-green-500 to-emerald-500"
            : "from-gray-400 to-gray-500",
        )}
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-muted">
              {robot.type.toLowerCase().includes("go") ? (
                <Dog className="w-5 h-5" />
              ) : (
                <Truck className="w-5 h-5" />
              )}
            </div>
            <div>
              <CardTitle className="text-base">{robot.id}</CardTitle>
              <div className="text-xs text-muted-foreground">{robot.type}</div>
            </div>
          </div>
          <Badge
            variant={connected ? "default" : "secondary"}
            className={cn(
              "text-xs",
              connected ? "bg-green-500" : "bg-gray-500 text-white",
            )}
          >
            {connected ? (
              <CheckCircle2 className="w-3 h-3 mr-1" />
            ) : (
              <AlertCircle className="w-3 h-3 mr-1" />
            )}
            {connected ? "Online" : "Offline"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {battery !== null && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Battery</span>
              <span
                className={cn(
                  battery <= 15
                    ? "text-red-500"
                    : battery <= 30
                      ? "text-yellow-600"
                      : "text-green-600",
                )}
              >
                {battery.toFixed(0)}%
              </span>
            </div>
            <Progress value={battery} className="h-1.5" />
          </div>
        )}

        {state ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Task</span>
              <span>{state.task ?? "idle"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Map</span>
              <span>{(state.map.mapped_ratio * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pose</span>
              <span>
                {state.pose.x.toFixed(1)}, {state.pose.y.toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">CPU</span>
              <span>{(state.hardware.cpu_load * 100).toFixed(0)}%</span>
            </div>
            {state.emergency_stopped && (
              <div className="col-span-2 text-red-500 font-medium">
                Emergency stop engaged
              </div>
            )}
            {state.recording.active && (
              <div className="col-span-2 text-blue-500">
                Recording “{state.recording.rosbag_name}”
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {unavailable
              ? "No state telemetry on this backend."
              : "Waiting for state telemetry..."}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant={isSelected ? "secondary" : "outline"}
            disabled={isSelected}
            onClick={() => selectRobot(robot.id)}
            className="flex-1"
          >
            {isSelected ? "Selected" : "Select"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/robot-connection">Manage</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RobotFleet() {
  const { robots, connectionStatus, isLoading, error, refresh } = useFleet();
  const selectedRobot = useSelectedRobot();
  const selectedRobotId = selectedRobot?.id ?? null;

  const { state: selectedState } = useRobotState(selectedRobotId, {
    pollIntervalMs: 3000,
  });

  const online = robots.filter((robot) => connectionStatus[robot.id]).length;
  const amrRobots = robots.filter((robot) => !robot.type.toLowerCase().includes("go"));
  const quadrupedRobots = robots.filter((robot) =>
    robot.type.toLowerCase().includes("go"),
  );

  /** Battery of the selected robot — the one number the header can report. */
  const selectedBattery = useMemo(
    () => (selectedState ? selectedState.battery.percentage * 100 : null),
    [selectedState],
  );

  return (
    <div className="p-6 pb-28 max-w-7xl mx-auto space-y-8">
      {/* Company Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-primary shadow-glow mb-4">
          <div className="flex items-center space-x-1">
            <Truck className="w-6 h-6 text-white" />
            <Dog className="w-6 h-6 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
          Fasta Robotics
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Autonomous AMRs and quadrupeds for logistics, inspection, and
          search-and-rescue — live from the robot backend.
        </p>
      </div>

      {error && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Backend unreachable</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fleet Overview Stats — all four values are real */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
                {isLoading ? (
                  <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                ) : (
                  <Activity className="w-5 h-5 text-green-600" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Online</p>
                <p className="text-2xl font-bold text-green-600">{online}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Offline</p>
                <p className="text-2xl font-bold text-red-600">
                  {robots.length - online}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-100 dark:bg-yellow-500/20 flex items-center justify-center">
                <Battery className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Battery ({selectedRobotId ?? "no selection"})
                </p>
                <p className="text-2xl font-bold text-yellow-600">
                  {selectedBattery === null
                    ? "—"
                    : `${selectedBattery.toFixed(0)}%`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Selected task</p>
                <p className="text-2xl font-bold text-primary">
                  {selectedState?.task ?? "idle"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fleet */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold">Registered Robots</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{robots.length} total</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Activity className="w-4 h-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </div>

        {robots.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No robots are registered on the backend.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {robots.map((robot) => (
              <RobotCard key={robot.id} robot={robot} />
            ))}
          </div>
        )}
      </section>

      {/* Per-class sections, built from whatever the backend reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <ClassSection
          title="Autonomous Mobile Robots"
          subtitle="Warehouse & Logistics Solutions"
          icon={<Truck className="w-8 h-8 text-white" />}
          robots={amrRobots}
          connectionStatus={connectionStatus}
          highlights={[
            { icon: <Package className="w-3 h-3" />, label: "Material Transport" },
            { icon: <Search className="w-3 h-3" />, label: "Inventory Scanning" },
            { icon: <Shield className="w-3 h-3" />, label: "Security Patrol" },
          ]}
          description="AMRs with lidar SLAM, autonomous navigation and path planning. Connect one to map a site, save a map, then navigate it."
          action={
            <Button className="flex-1" asChild>
              <Link to="/mapping">
                <Play className="w-4 h-4 mr-2" />
                Start Mapping
              </Link>
            </Button>
          }
        />

        <ClassSection
          title="Quadruped Robots"
          subtitle="Inspection & Search-Rescue"
          icon={<Dog className="w-8 h-8 text-white" />}
          robots={quadrupedRobots}
          connectionStatus={connectionStatus}
          highlights={[
            { icon: <Search className="w-3 h-3" />, label: "Site Inspection" },
            { icon: <Shield className="w-3 h-3" />, label: "Search & Rescue" },
            { icon: <MapPin className="w-3 h-3" />, label: "Perimeter Patrol" },
          ]}
          description="Quadrupeds with dynamic mobility and odometry. The Go2 exposes no map topic, so mapping and navigation-with-map are unavailable on it."
          action={
            <Button className="flex-1" asChild>
              <Link to="/manual-control">
                <Play className="w-4 h-4 mr-2" />
                Open Manual Control
              </Link>
            </Button>
          }
        />
      </div>

      {/* Selected robot detail */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5" />
            Selected Robot Hardware
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedState ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Robot</div>
                <div className="font-medium">
                  {selectedState.robot_id} ({selectedState.kind})
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Status</div>
                <div className="font-medium">{selectedState.status}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Battery</div>
                <div className="font-medium">
                  {(selectedState.battery.percentage * 100).toFixed(0)}% ·{" "}
                  {selectedState.battery.voltage.toFixed(1)} V ·{" "}
                  {selectedState.battery.current.toFixed(2)} A
                </div>
              </div>
              <div>
                <div className="text-muted-foreground flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5" /> Temperatures
                </div>
                <div className="font-medium">
                  CPU {selectedState.hardware.cpu_temperature.toFixed(0)} °C ·
                  motor {selectedState.hardware.motor_temperature.toFixed(0)} °C
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Velocity</div>
                <div className="font-medium">
                  {selectedState.velocity.linear_x.toFixed(2)} m/s ·{" "}
                  {selectedState.velocity.angular_z.toFixed(2)} rad/s
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Map</div>
                <div className="font-medium">
                  {(selectedState.map.mapped_ratio * 100).toFixed(0)}% known ·
                  rev {selectedState.map.revision}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-muted-foreground">Saved maps</div>
                <div className="font-medium min-w-0 break-words">
                  {selectedState.saved_maps.length
                    ? selectedState.saved_maps.join(", ")
                    : "none"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Rosbags</div>
                <div className="font-medium">
                  {selectedState.recording.rosbags.length || "none"}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Wifi className="w-4 h-4" />
              {selectedRobot
                ? "Waiting for hardware telemetry from the backend..."
                : "Select a robot to see its hardware state."}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ClassSectionProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  robots: RobotSummary[];
  connectionStatus: Record<string, boolean>;
  highlights: { icon: ReactNode; label: string }[];
  description: string;
  action: ReactNode;
}

function ClassSection({
  title,
  subtitle,
  icon,
  robots,
  connectionStatus,
  highlights,
  description,
  action,
}: ClassSectionProps) {
  const online = robots.filter((robot) => connectionStatus[robot.id]).length;

  return (
    <Card className="border-0 shadow-lg overflow-hidden">
      <CardHeader className="bg-gradient-primary text-white p-6">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center">
            {icon}
          </div>
          <div>
            <CardTitle className="text-2xl">{title}</CardTitle>
            <p className="text-cyan-100 mt-1">{subtitle}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        <p className="text-muted-foreground">{description}</p>

        <div className="flex flex-wrap gap-2">
          {highlights.map((highlight) => (
            <Badge
              key={highlight.label}
              variant="secondary"
              className="flex items-center space-x-1"
            >
              {highlight.icon}
              <span>{highlight.label}</span>
            </Badge>
          ))}
        </div>

        <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
          <h4 className="font-semibold">Fleet Status</h4>
          {robots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No robots of this class are registered.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Registered:</span>
                <span className="font-medium">{robots.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Online:</span>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="font-medium">{online}</span>
                </div>
              </div>
              <div className="flex items-center justify-between col-span-2">
                <span className="text-muted-foreground">Ids:</span>
                <span className="font-medium">{robots.map((r) => r.id).join(", ")}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex space-x-3">{action}</div>
      </CardContent>
    </Card>
  );
}
