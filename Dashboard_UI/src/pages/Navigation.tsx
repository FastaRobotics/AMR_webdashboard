import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Navigation as NavigationIcon,
  MapPin,
  Target,
  Play,
  Square,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Save,
  Trash2,
  Compass,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import MapPanel from "../components/MapPanel";
import { useRobotStore } from "../store/robotStore";
import { useFleet } from "../hooks/useFleet";
import { useRobotState, useWaypoints } from "../hooks/useRobotState";
import {
  apiErrorMessage,
  deleteWaypoint,
  publishGoal,
  publishInitialPose,
  saveWaypoint,
  startNavigationWithMap,
  stopNavigation,
} from "../api/routes";

/**
 * Autonomous navigation.
 *
 * Goals are published on the robot's own `goal_pose` topic — the same thing
 * RViz's "2D Goal Pose" does — and the resulting plan arrives on the `path`
 * socket, which MapPanel draws. Status (goal, remaining distance, plan length,
 * last result) comes from the robot-state endpoint, so the page never invents a
 * progress figure: it reports what the robot is actually doing.
 */
export default function Navigation() {
  const { robots, connectionStatus } = useFleet({ pollIntervalMs: 5000 });
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const selectRobot = useRobotStore((state) => state.selectRobot);

  const {
    state: robotState,
    unavailable,
    refresh: refreshState,
  } = useRobotState(selectedRobotId, { pollIntervalMs: 500 });

  const {
    waypoints,
    available: waypointsAvailable,
    refresh: refreshWaypoints,
  } = useWaypoints();

  const [goal, setGoal] = useState({ x: "0.0", y: "0.0", theta: "0.0" });
  const [initialPose, setInitialPose] = useState({
    x: "0.0",
    y: "0.0",
    theta: "0.0",
  });
  const [waypointName, setWaypointName] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState("latest");

  const connected = selectedRobotId
    ? (connectionStatus[selectedRobotId] ?? false)
    : false;

  const savedMaps = useMemo(
    () => robotState?.saved_maps ?? [],
    [robotState?.saved_maps],
  );

  useEffect(() => {
    if (savedMaps.length && !savedMaps.includes(selectedMap)) {
      setSelectedMap(savedMaps.includes("latest") ? "latest" : savedMaps[0]);
    }
  }, [savedMaps, selectedMap]);

  useEffect(() => {
    setError(null);
    setMessage(null);
  }, [selectedRobotId]);

  /** Numeric view of the goal form, or null when a field is not a number. */
  const parsedGoal = useMemo(() => {
    const x = Number(goal.x);
    const y = Number(goal.y);
    const theta = Number(goal.theta);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(theta)) {
      return null;
    }
    return { x, y, theta };
  }, [goal]);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setIsBusy(true);
      setError(null);
      setMessage(null);
      try {
        await action();
        setMessage(label);
        await refreshState();
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        setIsBusy(false);
      }
    },
    [refreshState],
  );

  const sendGoal = (x: number, y: number, theta: number) =>
    run(`Goal published: x ${x.toFixed(2)}, y ${y.toFixed(2)}, yaw ${theta.toFixed(2)} rad.`, () =>
      publishGoal(selectedRobotId!, x, y, theta),
    );

  const handleStartNavigation = () => {
    if (!selectedRobotId) return;
    if (!parsedGoal) {
      setError("Goal coordinates must be numbers.");
      return;
    }
    void sendGoal(parsedGoal.x, parsedGoal.y, parsedGoal.theta);
  };

  const handleStopNavigation = () =>
    run("Navigation stopped.", () => stopNavigation(selectedRobotId!));

  const handleSetInitialPose = () => {
    if (!selectedRobotId) return;
    const x = Number(initialPose.x);
    const y = Number(initialPose.y);
    const theta = Number(initialPose.theta);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(theta)) {
      setError("Initial pose values must be numbers.");
      return;
    }
    void run(
      "Initial pose published — the robot re-localised against it.",
      () => publishInitialPose(selectedRobotId, x, y, theta),
    );
  };

  const handleLoadMapAndLocalize = () =>
    run(`Loaded “${selectedMap}” and localising…`, () =>
      startNavigationWithMap(selectedRobotId!, {
        map_name: selectedMap,
        localize_after_load: true,
        localize_failure_is_fatal: false,
        pose_hint_position_xyz: parsedGoal
          ? [parsedGoal.x, parsedGoal.y, 0]
          : [0, 0, 0],
      }),
    );

  const handleSaveWaypoint = () => {
    if (!selectedRobotId || !robotState) {
      setError("No robot state available to save a waypoint from.");
      return;
    }
    const name = waypointName.trim() || `wp_${Date.now().toString(36)}`;
    void (async () => {
      await run(
        `Waypoint “${name}” saved at the robot's current pose.`,
        () =>
          saveWaypoint({
            name,
            x: robotState.pose.x,
            y: robotState.pose.y,
            yaw: robotState.pose.yaw,
          }),
      );
      setWaypointName("");
      await refreshWaypoints();
    })();
  };

  const handleDeleteWaypoint = (name: string) =>
    void (async () => {
      await run(`Waypoint “${name}” deleted.`, () => deleteWaypoint(name));
      await refreshWaypoints();
    })();

  /** Progress is derived from the plan the robot is executing. */
  const planProgress = useMemo(() => {
    if (!robotState || robotState.plan_points === 0) return 0;
    return Math.min(
      100,
      (robotState.plan_index / robotState.plan_points) * 100,
    );
  }, [robotState]);

  const navigationState = robotState?.task === "navigation" ? "ACTIVE" : "IDLE";
  const speed = robotState
    ? Math.hypot(robotState.velocity.linear_x, robotState.velocity.angular_z)
    : 0;

  const goalDisplay = robotState?.goal_text && robotState.goal_text !== "none"
    ? robotState.goal_text
    : "None";

  return (
    <div className="p-6 pb-28 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Navigation</h1>
          <p className="text-muted-foreground">
            Autonomous navigation with path planning and obstacle avoidance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">
            Robot
          </Label>
          <Select
            value={selectedRobotId ?? ""}
            onValueChange={selectRobot}
            disabled={robots.length === 0}
          >
            <SelectTrigger className="w-48 max-w-full min-w-0">
              <SelectValue placeholder="Choose a robot" />
            </SelectTrigger>
            <SelectContent>
              {robots.map((robot) => (
                <SelectItem key={robot.id} value={robot.id}>
                  {robot.id} ({robot.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge
            variant="secondary"
            className={cn(
              connected ? "bg-green-500 text-white" : "bg-gray-500 text-white",
            )}
          >
            {connected ? "Connected" : "Offline"}
          </Badge>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">{error}</div>
          </CardContent>
        </Card>
      )}

      {message && !error && (
        <Card className="border-green-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="text-sm">{message}</div>
          </CardContent>
        </Card>
      )}

      {!connected && (
        <Card className="border-yellow-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div className="text-sm">
              The robot is offline; goals and pose estimates will fail until it is
              connected on the Robot Connection page.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Viewer */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <NavigationIcon className="w-5 h-5" />
                <span>Navigation Viewer</span>
                <Badge
                  variant="secondary"
                  className={cn(
                    navigationState === "ACTIVE"
                      ? "bg-blue-500 text-white"
                      : "bg-gray-500 text-white",
                  )}
                >
                  {navigationState}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MapPanel
                robotId={selectedRobotId}
                height={420}
                showPath
                showTf
                interactive
                goal={
                  robotState?.goal
                    ? { x: robotState.goal[0], y: robotState.goal[1], yaw: robotState.goal[2] }
                    : null
                }
                onMapClick={(point) => {
                  // Clicking the map is the fastest way to set a goal.
                  setGoal({
                    x: point.x.toFixed(2),
                    y: point.y.toFixed(2),
                    theta: goal.theta,
                  });
                }}
                onGoalClick={(point) => {
                  if (!selectedRobotId) return;
                  setGoal({
                    x: point.x.toFixed(2),
                    y: point.y.toFixed(2),
                    theta: goal.theta,
                  });
                  void sendGoal(point.x, point.y, Number(goal.theta) || 0);
                }}
              />

              <p className="text-xs text-muted-foreground">
                Click anywhere on the map to publish a goal there.
              </p>

              {navigationState === "ACTIVE" && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Plan progress</span>
                    <span>{planProgress.toFixed(0)}%</span>
                  </div>
                  <Progress value={planProgress} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      Distance remaining:{" "}
                      {robotState
                        ? `${robotState.distance_remaining_m.toFixed(2)} m`
                        : "—"}
                    </span>
                    <span>
                      Waypoints: {robotState?.plan_index ?? 0} /{" "}
                      {robotState?.plan_points ?? 0}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Path planning */}
          <Card>
            <CardHeader>
              <CardTitle>Path Planning</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 xl:grid-cols-2">
                {/* Goal */}
                <div className="space-y-4">
                  <h3 className="font-medium">Set Navigation Goal</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="goal-x">X (m)</Label>
                      <Input
                        id="goal-x"
                        value={goal.x}
                        onChange={(e) =>
                          setGoal((prev) => ({ ...prev, x: e.target.value }))
                        }
                        placeholder="0.0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="goal-y">Y (m)</Label>
                      <Input
                        id="goal-y"
                        value={goal.y}
                        onChange={(e) =>
                          setGoal((prev) => ({ ...prev, y: e.target.value }))
                        }
                        placeholder="0.0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="goal-theta">θ (rad)</Label>
                      <Input
                        id="goal-theta"
                        value={goal.theta}
                        onChange={(e) =>
                          setGoal((prev) => ({ ...prev, theta: e.target.value }))
                        }
                        placeholder="0.0"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={handleStartNavigation}
                      disabled={isBusy || !connected || !parsedGoal}
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Navigate
                    </Button>
                    <Button
                      onClick={() => void handleStopNavigation()}
                      disabled={isBusy || navigationState !== "ACTIVE"}
                      variant="destructive"
                    >
                      <Square className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      robotState &&
                      setGoal({
                        x: robotState.pose.x.toFixed(2),
                        y: robotState.pose.y.toFixed(2),
                        theta: robotState.pose.yaw.toFixed(2),
                      })
                    }
                    disabled={!robotState}
                  >
                    <Target className="w-4 h-4 mr-2" />
                    Use Current Pose as Goal
                  </Button>
                </div>

                {/* Localisation */}
                <div className="space-y-4">
                  <h3 className="font-medium">Localisation</h3>

                  <div>
                    <Label className="mb-2 block text-sm">Saved map</Label>
                    <div className="flex gap-2">
                      <Select
                        value={selectedMap}
                        onValueChange={setSelectedMap}
                        disabled={savedMaps.length === 0}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="No saved maps" />
                        </SelectTrigger>
                        <SelectContent>
                          {savedMaps.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        onClick={() => void handleLoadMapAndLocalize()}
                        disabled={isBusy || !connected || savedMaps.length === 0}
                      >
                        <Compass className="w-4 h-4 mr-2" />
                        Load
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="pose-x">X (m)</Label>
                      <Input
                        id="pose-x"
                        value={initialPose.x}
                        onChange={(e) =>
                          setInitialPose((prev) => ({
                            ...prev,
                            x: e.target.value,
                          }))
                        }
                        placeholder="0.0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="pose-y">Y (m)</Label>
                      <Input
                        id="pose-y"
                        value={initialPose.y}
                        onChange={(e) =>
                          setInitialPose((prev) => ({
                            ...prev,
                            y: e.target.value,
                          }))
                        }
                        placeholder="0.0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="pose-theta">θ (rad)</Label>
                      <Input
                        id="pose-theta"
                        value={initialPose.theta}
                        onChange={(e) =>
                          setInitialPose((prev) => ({
                            ...prev,
                            theta: e.target.value,
                          }))
                        }
                        placeholder="0.0"
                      />
                    </div>
                  </div>

                  <Button
                    onClick={handleSetInitialPose}
                    variant="outline"
                    className="w-full"
                    disabled={isBusy || !connected}
                  >
                    <MapPin className="w-4 h-4 mr-2" />
                    Publish Initial Pose
                  </Button>

                  <div className="bg-muted p-3 rounded-lg text-sm">
                    <h4 className="font-medium mb-2">Waypoints</h4>
                    <div className="flex gap-2">
                      <Input
                        value={waypointName}
                        onChange={(e) => setWaypointName(e.target.value)}
                        placeholder="waypoint name"
                      />
                      <Button
                        variant="outline"
                        onClick={handleSaveWaypoint}
                        disabled={isBusy || !robotState}
                        title="Save the robot's current pose as a waypoint"
                      >
                        <Save className="w-4 h-4" />
                      </Button>
                    </div>
                    {!waypointsAvailable && !unavailable && (
                      <p className="text-xs text-muted-foreground mt-2">
                        The backend returned no waypoints.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Status and waypoints */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Compass className="w-5 h-5" />
                <span>Navigation Status</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">State:</span>
                  <Badge
                    variant={navigationState === "ACTIVE" ? "default" : "secondary"}
                  >
                    {navigationState}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current goal:</span>
                  <span className="truncate pl-2">{goalDisplay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan points:</span>
                  <span>{robotState?.plan_points ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining:</span>
                  <span>
                    {robotState
                      ? `${robotState.distance_remaining_m.toFixed(2)} m`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Velocity:</span>
                  <span>
                    {robotState
                      ? `${robotState.velocity.linear_x.toFixed(2)} m/s, ${robotState.velocity.angular_z.toFixed(2)} rad/s`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Speed:</span>
                  <span>{speed.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last result:</span>
                  <span>{robotState?.last_navigation_result ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pose:</span>
                  <span>
                    {robotState
                      ? `${robotState.pose.x.toFixed(2)}, ${robotState.pose.y.toFixed(2)}, ${robotState.pose.yaw.toFixed(2)}`
                      : "—"}
                  </span>
                </div>
              </div>

              {!robotState && (
                <p className="text-xs text-muted-foreground">
                  {unavailable
                    ? "This backend exposes no navigation status endpoint."
                    : "Waiting for the first state sample…"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Saved Waypoints</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void refreshWaypoints()}
                  title="Reload the waypoint list"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {waypoints.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No waypoints on the backend yet. Save the robot's current pose
                  above to create one.
                </p>
              ) : (
                waypoints.map((waypoint) => (
                  <div
                    key={waypoint.name}
                    className="p-3 border border-border rounded-lg space-y-2"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h4 className="font-medium truncate">{waypoint.name}</h4>
                        <div className="text-xs text-muted-foreground">
                          ({waypoint.x.toFixed(1)}, {waypoint.y.toFixed(1)},{" "}
                          {waypoint.yaw.toFixed(2)})
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {waypoint.source}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() =>
                          setGoal({
                            x: waypoint.x.toFixed(2),
                            y: waypoint.y.toFixed(2),
                            theta: waypoint.yaw.toFixed(2),
                          })
                        }
                      >
                        Select Goal
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteWaypoint(waypoint.name)}
                        disabled={isBusy}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Capabilities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {robotState ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Map topic</span>
                    <span>
                      {robotState.capabilities.map_topic ? "yes" : "no"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Path topic</span>
                    <span>
                      {robotState.capabilities.path_topic ? "yes" : "no"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      start_with_map
                    </span>
                    <span>
                      {robotState.kind === "Go2" ? "no" : "yes"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-2">
                    Planner configuration is owned by the robot's nav2 stack; the
                    backend exposes no endpoint to change it.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Capabilities appear once the robot reports state.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
