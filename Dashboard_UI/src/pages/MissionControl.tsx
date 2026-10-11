import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { ScrollArea } from "../components/ui/scroll-area";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import {
  Target,
  Search,
  Eye,
  Shield,
  Package,
  Play,
  Square,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Thermometer,
  Battery,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import MapPanel from "../components/MapPanel";
import { useRobotStore } from "../store/robotStore";
import { useFleet } from "../hooks/useFleet";
import { useRobotState, useWaypoints } from "../hooks/useRobotState";
import {
  apiErrorMessage,
  emergencyStop,
  getRobotState,
  publishGoal,
  startExploring,
  startNavigationWithMap,
  stopExploring,
  stopNavigation,
} from "../api/routes";

/**
 * Mission control.
 *
 * A "mission" here is a real, backend-driven sequence of goals rather than a
 * progress bar on a timer: starting one loads a saved map and localises, then
 * publishes each waypoint of the mission on the robot's `goal_pose` topic and
 * waits for the robot to report that it arrived (distance remaining below the
 * arrival threshold, or a change in `last_navigation_result`).
 *
 * The log is the mission's actual event stream, and the Abort button publishes
 * the robot's real emergency stop / stop service.
 */

interface Mission {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Waypoint names this mission visits, in order. */
  waypoints: string[];
  difficulty: "Easy" | "Medium" | "Hard";
  /** Some missions need a map topic (SLAM) to be useful. */
  needsMap?: boolean;
}

/** Distance under which the robot is considered to have arrived (metres). */
const ARRIVAL_THRESHOLD_M = 0.35;
/** How long a single leg may take before the mission gives up on it. */
const LEG_TIMEOUT_MS = 120_000;

const MISSIONS: Mission[] = [
  {
    id: "search_rescue",
    name: "Search and Rescue",
    description:
      "Sweep every known waypoint in turn, logging arrival at each one — the pattern used to search a site methodically.",
    icon: Search,
    waypoints: ["inspection_point", "storage_area_a", "loading_dock", "charging_station"],
    difficulty: "Hard",
    needsMap: true,
  },
  {
    id: "object_following",
    name: "Inspection Round",
    description:
      "Visit the inspection point, then the storage area, and finish on the dock — a short supervised round.",
    icon: Eye,
    waypoints: ["inspection_point", "storage_area_a"],
    difficulty: "Medium",
    needsMap: true,
  },
  {
    id: "patrol",
    name: "Area Patrolling",
    description:
      "Cycle the perimeter waypoints. Each leg is a normal navigation goal, so progress is the robot's own.",
    icon: Shield,
    waypoints: ["charging_station", "storage_area_a", "loading_dock", "inspection_point"],
    difficulty: "Easy",
    needsMap: true,
  },
  {
    id: "transport",
    name: "Pallet A→B Transport",
    description:
      "Drive from the loading dock to the storage area — the transport leg, with the robot's real remaining distance reported live.",
    icon: Package,
    waypoints: ["loading_dock", "storage_area_a"],
    difficulty: "Medium",
    needsMap: true,
  },
];

interface MissionLogEntry {
  at: number;
  text: string;
  kind: "info" | "success" | "warning" | "error";
}

export default function MissionControl() {
  const { robots, connectionStatus } = useFleet({ pollIntervalMs: 5000 });
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const selectRobot = useRobotStore((state) => state.selectRobot);

  const { state: robotState, unavailable, refresh } = useRobotState(
    selectedRobotId,
    { pollIntervalMs: 500 },
  );
  const { waypoints } = useWaypoints();

  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [legIndex, setLegIndex] = useState(0);
  const [logs, setLogs] = useState<MissionLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoStartNavigation, setAutoStartNavigation] = useState(true);

  const connected = selectedRobotId
    ? (connectionStatus[selectedRobotId] ?? false)
    : false;

  /** Async mission runner state, kept outside React so it cannot be re-entered. */
  const runnerRef = useRef<{ cancelled: boolean } | null>(null);

  const activeMission = useMemo(
    () => MISSIONS.find((mission) => mission.id === activeMissionId) ?? null,
    [activeMissionId],
  );

  const appendLog = useCallback(
    (text: string, kind: MissionLogEntry["kind"] = "info") => {
      setLogs((prev) => [...prev.slice(-199), { at: Date.now(), text, kind }]);
    },
    [],
  );

  /** Reset when the operator picks a different robot mid-mission. */
  useEffect(() => {
    if (runnerRef.current) runnerRef.current.cancelled = true;
    runnerRef.current = null;
    setActiveMissionId(null);
    setLegIndex(0);
    setLogs([]);
    setError(null);
  }, [selectedRobotId]);

  // Log the robot's own navigation result changes while a mission runs.
  const lastResultRef = useRef<string | null>(null);
  useEffect(() => {
    const result = robotState?.last_navigation_result ?? null;
    if (!activeMissionId || !result) return;
    if (lastResultRef.current !== result) {
      lastResultRef.current = result;
      if (result !== "idle" && result !== "navigating") {
        appendLog(`Robot reports: ${result}`, result === "reached" ? "success" : "warning");
      }
    }
  }, [activeMissionId, appendLog, robotState?.last_navigation_result]);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Runs one leg: publish the goal, then poll the robot state until it arrives,
   * the leg times out, or the mission is cancelled.
   *
   * The state is fetched directly (not through the hook) so each poll is
   * awaited in order: a hook update would be applied on a later render and the
   * runner would race its own UI.
   */
  const runLeg = useCallback(
    async (x: number, y: number, yaw: number, label: string) => {
      await publishGoal(selectedRobotId!, x, y, yaw);
      appendLog(`Goal published: ${label} (${x.toFixed(2)}, ${y.toFixed(2)})`);

      const startedAt = Date.now();
      let sawMovement = false;

      while (Date.now() - startedAt < LEG_TIMEOUT_MS) {
        if (runnerRef.current?.cancelled) return "cancelled" as const;

        await wait(1000);

        const current = await getRobotState(selectedRobotId!);
        if (runnerRef.current?.cancelled) return "cancelled" as const;
        if (!current) continue;

        const remaining = current.distance_remaining_m;
        if (remaining > 0) sawMovement = true;

        if (current.emergency_stopped) {
          appendLog(`Emergency stop engaged while driving to ${label}`, "error");
          return "estopped" as const;
        }

        if (remaining <= ARRIVAL_THRESHOLD_M) {
          appendLog(`Arrived at ${label} (${remaining.toFixed(2)} m)`, "success");
          return "reached" as const;
        }
      }

      appendLog(
        `Timed out driving to ${label}${sawMovement ? " (the robot was moving)" : ""}`,
        "error",
      );
      return "timeout" as const;
    },
    [appendLog, selectedRobotId],
  );

  const handleStartMission = async (mission: Mission) => {
    if (!selectedRobotId) return;

    setError(null);
    setActiveMissionId(mission.id);
    setLegIndex(0);
    lastResultRef.current = null;

    const runner = { cancelled: false };
    runnerRef.current = runner;

    setLogs([
      { at: Date.now(), text: `Mission started: ${mission.name}`, kind: "info" },
      {
        at: Date.now(),
        text: `${mission.waypoints.length} leg(s): ${mission.waypoints.join(" → ")}`,
        kind: "info",
      },
    ]);

    try {
      if (autoStartNavigation && robotState?.capabilities.map_topic !== false) {
        const mapName = robotState?.map.loaded_map ?? "latest";
        appendLog(`Loading map “${mapName}” and localising…`);
        try {
          await startNavigationWithMap(selectedRobotId, {
            map_name: mapName,
            localize_after_load: true,
            localize_failure_is_fatal: false,
          });
        } catch (err) {
          appendLog(`Could not start navigation: ${apiErrorMessage(err)}`, "warning");
        }
      }

      for (let index = 0; index < mission.waypoints.length; index += 1) {
        if (runner.cancelled) break;

        const name = mission.waypoints[index];
        const waypoint = waypoints.find((item) => item.name === name);
        if (!waypoint) {
          appendLog(`Waypoint “${name}” is not on the backend — skipped`, "warning");
          continue;
        }

        setLegIndex(index + 1);
        const outcome = await runLeg(
          waypoint.x,
          waypoint.y,
          waypoint.yaw,
          waypoint.name,
        );

        if (outcome === "cancelled") break;
        if (outcome === "estopped") {
          setError("Mission halted: the robot's emergency stop is engaged.");
          break;
        }
      }

      if (runner.cancelled) {
        appendLog("Mission aborted by the operator.", "warning");
      } else if (!runnerRef.current?.cancelled) {
        appendLog("Mission complete.", "success");
      }
    } catch (err) {
      const text = apiErrorMessage(err);
      setError(text);
      appendLog(`Mission failed: ${text}`, "error");
    } finally {
      if (runnerRef.current === runner) runnerRef.current = null;
      setActiveMissionId((current) => (current === mission.id ? null : current));
    }
  };

  const handleAbort = async () => {
    if (runnerRef.current) runnerRef.current.cancelled = true;
    appendLog("Abort requested by the operator.", "warning");

    if (selectedRobotId) {
      try {
        await stopNavigation(selectedRobotId);
        appendLog("Navigation stop requested.", "info");
      } catch (err) {
        appendLog(`Could not stop navigation: ${apiErrorMessage(err)}`, "warning");
      }
      try {
        await refresh();
      } catch {
        // Best effort — the log already shows the stop request.
      }
    }

    setActiveMissionId(null);
  };

  const handleEmergencyStop = async () => {
    if (!selectedRobotId) return;
    if (runnerRef.current) runnerRef.current.cancelled = true;
    setActiveMissionId(null);

    try {
      const activating = !robotState?.emergency_stopped;
      await emergencyStop(selectedRobotId, activating ? "activate" : "deactivate");
      appendLog(
        activating ? "EMERGENCY STOP engaged." : "Emergency stop released.",
        activating ? "error" : "success",
      );
      await refresh();
    } catch (err) {
      const text = apiErrorMessage(err);
      setError(text);
      appendLog(`Emergency stop failed: ${text}`, "error");
    }
  };

  const handleAutoExplore = async () => {
    if (!selectedRobotId) return;
    try {
      if (robotState?.task === "exploring") {
        await stopExploring(selectedRobotId);
        appendLog("Frontier exploration stopped.", "info");
      } else {
        await startExploring(selectedRobotId);
        appendLog("Frontier exploration started — the robot is mapping itself.", "info");
      }
      await refresh();
    } catch (err) {
      appendLog(`Exploration command failed: ${apiErrorMessage(err)}`, "error");
    }
  };

  const legTotal = activeMission?.waypoints.length ?? 0;
  const progress = legTotal === 0 ? 0 : (legIndex / legTotal) * 100;
  const running = activeMissionId !== null;

  return (
    <div className="p-6 pb-28 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Mission Control</h1>
          <p className="text-muted-foreground">
            Execute and monitor multi-waypoint missions on the real robot
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-sm text-muted-foreground whitespace-nowrap">
            Robot
          </Label>
          <select
            className="h-9 max-w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedRobotId ?? ""}
            onChange={(event) => selectRobot(event.target.value)}
            disabled={robots.length === 0}
          >
            {robots.map((robot) => (
              <option key={robot.id} value={robot.id}>
                {robot.id} ({robot.type})
              </option>
            ))}
          </select>
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
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">{error}</div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Missions */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Available Missions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 xl:grid-cols-2">
                {MISSIONS.map((mission) => {
                  const Icon = mission.icon;
                  const isActive = activeMissionId === mission.id;
                  const blocked = mission.needsMap && unavailable;

                  return (
                    <Card
                      key={mission.id}
                      className={cn(
                        "transition-colors",
                        isActive
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                          : "hover:bg-accent/50",
                      )}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex items-center space-x-3 min-w-0">
                            <Icon className="w-6 h-6 text-primary shrink-0" />
                            <div className="min-w-0">
                              <CardTitle className="text-base">
                                {mission.name}
                              </CardTitle>
                              <div className="text-sm text-muted-foreground">
                                {mission.waypoints.length} legs
                              </div>
                            </div>
                          </div>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-white",
                              mission.difficulty === "Easy" && "bg-green-500",
                              mission.difficulty === "Medium" && "bg-yellow-500",
                              mission.difficulty === "Hard" && "bg-red-500",
                            )}
                          >
                            {mission.difficulty}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 space-y-3">
                        <p className="text-sm text-muted-foreground">
                          {mission.description}
                        </p>

                        <div>
                          <h5 className="text-xs font-medium mb-1">Waypoints:</h5>
                          <div className="flex flex-wrap gap-1">
                            {mission.waypoints.map((name) => (
                              <Badge key={name} variant="outline" className="text-xs">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <Button
                          onClick={() => void handleStartMission(mission)}
                          disabled={running || !connected || blocked}
                          className="w-full"
                          variant={isActive ? "secondary" : "default"}
                        >
                          {isActive ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Running…
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" />
                              Start Mission
                            </>
                          )}
                        </Button>

                        {!connected && (
                          <p className="text-xs text-muted-foreground">
                            Connect the robot to run missions.
                          </p>
                        )}
                        {blocked && (
                          <p className="text-xs text-muted-foreground">
                            This mission needs saved waypoints and a robot with a
                            map topic.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex items-center space-x-2 mt-4 pt-4 border-t">
                <Switch
                  id="auto-nav"
                  checked={autoStartNavigation}
                  onCheckedChange={setAutoStartNavigation}
                />
                <Label htmlFor="auto-nav" className="text-sm">
                  Load the saved map and localise before the first leg
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Live viewer */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Target className="w-5 h-5" />
                <span>Mission Viewer</span>
                {activeMission && (
                  <Badge variant="default" className="bg-blue-500">
                    {activeMission.name}
                    {legTotal > 0 ? ` · leg ${legIndex}/${legTotal}` : ""}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MapPanel
                robotId={selectedRobotId}
                height={380}
                showPath
                interactive
                goal={
                  robotState?.goal
                    ? {
                      x: robotState.goal[0],
                      y: robotState.goal[1],
                      yaw: robotState.goal[2],
                    }
                    : null
                }
              />

              {running && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Mission progress</span>
                    <span>{progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <div className="flex justify-center">
                    <Button onClick={() => void handleAbort()} variant="destructive">
                      <Square className="w-4 h-4 mr-2" />
                      Abort Mission
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status and log */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>Mission Status</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active mission:</span>
                  <span>{activeMission?.name ?? "None"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={running ? "default" : "secondary"}>
                    {running ? "Running" : "Idle"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Leg:</span>
                  <span>
                    {legIndex} / {legTotal}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Task:</span>
                  <span>{robotState?.task ?? "idle"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining:</span>
                  <span>
                    {robotState
                      ? `${robotState.distance_remaining_m.toFixed(2)} m`
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Battery className="w-3.5 h-3.5" /> Battery
                  </span>
                  <span>
                    {robotState
                      ? `${(robotState.battery.percentage * 100).toFixed(0)}%`
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Thermometer className="w-3.5 h-3.5" /> CPU
                  </span>
                  <span>
                    {robotState
                      ? `${robotState.hardware.cpu_temperature.toFixed(0)} °C`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">E-stop:</span>
                  <span
                    className={cn(
                      robotState?.emergency_stopped
                        ? "text-red-500"
                        : "text-green-600",
                    )}
                  >
                    {robotState?.emergency_stopped ? "ENGAGED" : "clear"}
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full h-auto py-2 whitespace-normal"
                disabled={!connected}
                onClick={() => void handleAutoExplore()}
              >
                {robotState?.task === "exploring"
                  ? "Stop Frontier Exploration"
                  : "Start Frontier Exploration"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5" />
                <span>Mission Log</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="space-y-1">
                  {logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Start a mission to see its event stream.
                    </p>
                  ) : (
                    logs.map((entry, index) => (
                      <div
                        key={`${entry.at}-${index}`}
                        className={cn(
                          "text-xs font-mono p-2 rounded break-words",
                          entry.kind === "success" && "bg-green-500/10 text-green-700",
                          entry.kind === "warning" && "bg-yellow-500/10 text-yellow-700",
                          entry.kind === "error" && "bg-red-500/10 text-red-700",
                          entry.kind === "info" && "bg-muted",
                        )}
                      >
                        [{new Date(entry.at).toLocaleTimeString()}] {entry.text}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emergency Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="destructive"
                className="w-full"
                disabled={!connected}
                onClick={() => void handleEmergencyStop()}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                {robotState?.emergency_stopped
                  ? "Release Emergency Stop"
                  : "Emergency Stop"}
              </Button>
              <Button
                variant="outline"
                className="w-full h-auto py-2 whitespace-normal"
                disabled={!connected}
                onClick={() =>
                  void handleStartMission(
                    MISSIONS.find((m) => m.id === "patrol") ?? MISSIONS[0],
                  )
                }
              >
                Return to Base (patrol to charging station)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
