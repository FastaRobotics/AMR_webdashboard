import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  BatteryCharging,
  CheckCircle2,
  Code2,
  Database,
  Map,
  Move3D,
  Network,
  RefreshCw,
  RotateCcw,
  Siren,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  apiErrorMessage,
  connectRobot,
  getSimConfig,
  getSimHealth,
  getSimRobots,
  getSimWorld,
  publishSimMessage,
  resetSimulation,
  revealMap,
  startExploring,
  startMapping,
  stopExploring,
  stopMapping,
  setSimBattery,
  setSimFault,
  setSimGoal,
  setUnreachableHosts as updateUnreachableHosts,
  teleportSimRobot,
} from "../api/routes";
import { API_BASE_URL, ENDPOINTS } from "../api/config";
import type {
  SimConfigResponse,
  SimHealthResponse,
  SimRobotState,
  SimWorldResponse,
} from "../api/types";
import { Button } from "../components/ui/button";
import { useFleet } from "../hooks/useFleet";
import { usePolling } from "../hooks/usePolling";
import { useRobotStore } from "../store/robotStore";

type ActionFeedback = {
  kind: "success" | "error";
  message: string;
  details?: string;
  at: number;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function SimulationTestBench() {
  const { robots, selectedRobotId, selectRobot } = useFleet();
  const storedRobotId = useRobotStore((state) => state.selectedRobotId);
  const robotId = selectedRobotId ?? storedRobotId;
  const [health, setHealth] = useState<SimHealthResponse | null>(null);
  const [simConfig, setSimConfig] = useState<SimConfigResponse | null>(null);
  const [simRobots, setSimRobots] = useState<SimRobotState[] | null>(null);
  const [world, setWorld] = useState<SimWorldResponse | null>(null);
  const [simDetailsError, setSimDetailsError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [batteryPercent, setBatteryPercent] = useState("25");
  const [teleportX, setTeleportX] = useState("-6.2");
  const [teleportY, setTeleportY] = useState("-3.2");
  const [teleportYaw, setTeleportYaw] = useState("0");
  const [unreachableHosts, setUnreachableHosts] = useState("");
  const [publishTopic, setPublishTopic] = useState("goal_pose");
  const [publishMessage, setPublishMessage] = useState("{}");
  const [mapSource, setMapSource] = useState<"slam" | "world">("world");
  const [mapImageError, setMapImageError] = useState(false);
  const [mapImageVersion, setMapImageVersion] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(
    null,
  );
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const next = await getSimHealth();
      if (!next) {
        setHealth(null);
        setHealthError("The simulator health endpoint is unavailable on this backend.");
        return;
      }
      setHealth(next);
      setHealthError(null);
    } catch (error) {
      setHealthError(apiErrorMessage(error));
    } finally {
      setHealthLoading(false);
    }
  }, []);
  const refreshHealth = usePolling(loadHealth, { intervalMs: 2500 });

  const refreshSimulatorDetails = useCallback(async () => {
    setDetailsLoading(true);
    setSimDetailsError(null);
    try {
      const [config, robotStates, nextWorld] = await Promise.all([
        getSimConfig(),
        getSimRobots(),
        robotId ? getSimWorld(robotId) : Promise.resolve(null),
      ]);
      setSimConfig(config);
      setSimRobots(robotStates);
      setWorld(nextWorld);
      if (!config || !robotStates || (robotId && !nextWorld)) {
        setSimDetailsError(
          "One or more simulator detail endpoints are unavailable on this backend.",
        );
      } else {
        setUnreachableHosts(config.unreachable_hosts.join(", "));
      }
      setMapImageVersion((version) => version + 1);
    } catch (error) {
      setSimDetailsError(apiErrorMessage(error));
    } finally {
      setDetailsLoading(false);
    }
  }, [robotId]);

  useEffect(() => {
    void refreshSimulatorDetails();
  }, [refreshSimulatorDetails]);

  const runAction = async (
    actionId: string,
    action: () => Promise<unknown>,
    successMessage: (result: unknown) => string,
  ) => {
    setActionInProgress(actionId);
    setActionFeedback(null);
    try {
      const result = await action();
      setActionFeedback({
        kind: "success",
        message: successMessage(result),
        details: JSON.stringify(result, null, 2),
        at: Date.now(),
      });
      setMapImageVersion((version) => version + 1);
      await refreshHealth();
    } catch (error) {
      setActionFeedback({
        kind: "error",
        message: apiErrorMessage(error),
        at: Date.now(),
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const selectedState = robotId ? health?.robots[robotId] : undefined;
  const robotConnected =
    robotId !== null && (health?.connected.includes(robotId) ?? false);
  const hasRobot = Boolean(robotId);
  const disabled = !hasRobot || actionInProgress !== null || health === null;

  useEffect(() => {
    if (mapSource === "slam" && selectedState?.map.active) {
      setMapImageVersion((version) => version + 1);
    }
  }, [mapSource, selectedState?.map.active, selectedState?.map.revision]);

  const updateBattery = () => {
    const percentage = Number(batteryPercent);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setActionFeedback({
        kind: "error",
        message: "Battery level must be between 0 and 100 percent.",
        at: Date.now(),
      });
      return;
    }
    if (!robotId) return;
    void runAction(
      "battery",
      () => setSimBattery(robotId, percentage / 100),
      () => `Battery level set to ${percentage}%.`,
    );
  };

  const teleport = () => {
    if (!robotId) return;
    const x = Number(teleportX);
    const y = Number(teleportY);
    const yaw = Number(teleportYaw);
    if (![x, y, yaw].every(Number.isFinite)) {
      setActionFeedback({
        kind: "error",
        message: "Teleport coordinates and heading must be valid numbers.",
        at: Date.now(),
      });
      return;
    }
    void runAction(
      "teleport",
      () => teleportSimRobot(robotId, { x, y, yaw }),
      () => `Robot moved to x ${x.toFixed(2)}, y ${y.toFixed(2)}, yaw ${yaw.toFixed(2)} rad.`,
    );
  };

  const sendDirectGoal = () => {
    if (!robotId) return;
    const x = Number(teleportX);
    const y = Number(teleportY);
    const yaw = Number(teleportYaw);
    if (![x, y, yaw].every(Number.isFinite)) {
      setActionFeedback({
        kind: "error",
        message: "Goal coordinates and heading must be valid numbers.",
        at: Date.now(),
      });
      return;
    }
    void runAction(
      "direct-goal",
      () => setSimGoal(robotId, { x, y, yaw }),
      () => `Direct goal set for ${robotId} at (${x.toFixed(2)}, ${y.toFixed(2)}).`,
    );
  };

  const updateUnreachableHostList = () => {
    const hosts = unreachableHosts
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean);
    if (
      hosts.length > 0 &&
      !window.confirm(
        `Connections to ${hosts.join(", ")} will fail until this list is cleared. Continue?`,
      )
    ) {
      return;
    }
    void runAction(
      "unreachable-hosts",
      () => updateUnreachableHosts(hosts),
      () =>
        hosts.length
          ? `Connection failures enabled for ${hosts.join(", ")}.`
          : "Unreachable-host list cleared.",
    );
  };

  const publishCustomMessage = () => {
    if (!robotId) return;
    const topic = publishTopic.trim();
    if (!topic) {
      setActionFeedback({
        kind: "error",
        message: "Enter a topic name before publishing.",
        at: Date.now(),
      });
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(publishMessage);
    } catch {
      setActionFeedback({
        kind: "error",
        message: "Message must be valid JSON.",
        at: Date.now(),
      });
      return;
    }
    if (!isJsonObject(message)) {
      setActionFeedback({
        kind: "error",
        message: "Message must be a JSON object.",
        at: Date.now(),
      });
      return;
    }
    void runAction(
      "custom-publish",
      () => publishSimMessage(robotId, topic, message),
      () => `Published a message on ${topic}.`,
    );
  };

  const mapImageUrl =
    robotId &&
    `${API_BASE_URL}${ENDPOINTS.sim.mapImage(robotId, mapSource, 2)}&refresh=${mapImageVersion}`;

  const resetOneRobot = () => {
    if (!robotId) return;
    if (!window.confirm(`Reset simulated state for ${robotId}?`)) return;
    void runAction(
      "reset-robot",
      () => resetSimulation(robotId),
      () => `Simulation state reset for ${robotId}.`,
    );
  };

  const resetAllRobots = () => {
    if (!window.confirm("Reset the simulation state for every robot?")) return;
    void runAction(
      "reset-all",
      () => resetSimulation(null),
      () => "Simulation state reset for all robots.",
    );
  };

  const revealFullMap = () => {
    if (!robotId) return;
    void runAction(
      "reveal-map",
      () => revealMap(robotId),
      (result) => {
        const mappedRatio =
          result !== null &&
          typeof result === "object" &&
          "mapped_ratio" in result &&
          typeof result.mapped_ratio === "number"
            ? result.mapped_ratio
            : null;
        return mappedRatio === null
          ? "Full map reveal completed."
          : `Full map revealed (${(mappedRatio * 100).toFixed(1)}% mapped).`;
      },
    );
  };

  const connectForMapping = () => {
    if (!robotId) return;
    void runAction(
      "slam-connect",
      () => connectRobot(robotId),
      () => `Connected ${robotId}; SLAM is ready to start.`,
    );
  };

  const startSlamMapping = () => {
    if (!robotId) return;
    void runAction(
      "slam-start",
      () => startMapping(robotId),
      () => `SLAM mapping started for ${robotId}.`,
    );
  };

  const startAutoMapping = () => {
    if (!robotId) return;
    void runAction(
      "slam-explore",
      () => startExploring(robotId),
      () => `Auto Mapping started for ${robotId}.`,
    );
  };

  const stopAutoMapping = () => {
    if (!robotId) return;
    void runAction(
      "slam-stop-explore",
      () => stopExploring(robotId),
      () => `Auto Mapping stopped for ${robotId}.`,
    );
  };

  const stopSlamMapping = () => {
    if (!robotId) return;
    void runAction(
      "slam-stop",
      () => stopMapping(robotId),
      () => `SLAM mapping stopped and the map saved for ${robotId}.`,
    );
  };

  const runFault = (
    kind: "disconnect" | "estop" | "clear",
    label: string,
  ) => {
    if (!robotId) return;
    void runAction(
      kind,
      () => setSimFault(robotId, kind),
      () => `${label} action completed for ${robotId}.`,
    );
  };

  const worldBounds = health
    ? {
        minX: health.world.origin[0],
        minY: health.world.origin[1],
        maxX: health.world.origin[0] + health.world.width * health.world.resolution,
        maxY: health.world.origin[1] + health.world.height * health.world.resolution,
      }
    : null;

  return (
    <div className="space-y-6 p-6 pb-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-700">
            <Activity className="h-4 w-4" />
            Fake backend · QA tools
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Simulation Test Bench
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Trigger repeatable simulation states and verify that the dashboard
            receives the backend changes. Actions affect only the fake backend.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="testbench-robot" className="sr-only">
            Select robot
          </label>
          <select
            id="testbench-robot"
            value={robotId ?? ""}
            onChange={(event) => {
              if (event.target.value) selectRobot(event.target.value);
            }}
            disabled={robots.length === 0}
            className="h-10 min-w-40 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {robots.length === 0 && <option value="">No robots available</option>}
            {robots.map((robot) => (
              <option key={robot.id} value={robot.id}>
                {robot.id} · {robot.type}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshHealth()}
            disabled={healthLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${healthLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </header>

      {healthError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Cannot read simulator status</p>
            <p className="mt-1">{healthError}</p>
          </div>
        </div>
      )}

      {actionFeedback && (
        <div
          role={actionFeedback.kind === "error" ? "alert" : "status"}
          className={`rounded-xl border p-4 ${
            actionFeedback.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <div className="flex items-start gap-3">
            {actionFeedback.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{actionFeedback.message}</p>
                <span className="text-xs opacity-70">
                  {formatTime(actionFeedback.at)}
                </span>
              </div>
              {actionFeedback.details && (
                <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-white/70 p-3 text-xs">
                  {actionFeedback.details}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Engine",
            value: health ? (health.running ? "Running" : "Stopped") : "—",
            detail: health ? `${health.ticks.toLocaleString()} ticks · ${health.tick_hz} Hz` : "No backend status",
            icon: health?.running ? CheckCircle2 : Activity,
            online: health?.running,
          },
          {
            label: "Robot connection",
            value: selectedState?.connected ? "Connected" : selectedState ? "Offline" : "—",
            detail: robotId ?? "No robot selected",
            icon: selectedState?.connected ? Wifi : WifiOff,
            online: selectedState?.connected,
          },
          {
            label: "Current task",
            value: selectedState?.task ?? (selectedState ? "Idle" : "—"),
            detail: selectedState?.status ?? "Waiting for robot state",
            icon: Activity,
            online: undefined,
          },
          {
            label: "Map coverage",
            value: selectedState ? `${(selectedState.map.mapped_ratio * 100).toFixed(1)}%` : "—",
            detail: selectedState ? `${selectedState.map.size[0]} × ${selectedState.map.size[1]} cells` : "Waiting for robot state",
            icon: Map,
            online: undefined,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="truncate text-lg font-semibold">{card.value}</p>
                </div>
              </div>
              <p className="mt-3 truncate text-xs text-muted-foreground">{card.detail}</p>
            </article>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <BatteryCharging className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Battery test</h2>
              <p className="text-xs text-muted-foreground">
                Set the backend battery level to test warning thresholds.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-36 flex-1">
              <label htmlFor="battery-level" className="mb-2 block text-sm font-medium">
                Battery level (%)
              </label>
              <input
                id="battery-level"
                type="number"
                min="0"
                max="100"
                step="1"
                value={batteryPercent}
                onChange={(event) => setBatteryPercent(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button onClick={updateBattery} disabled={disabled}>
              {actionInProgress === "battery" ? "Updating…" : "Set battery"}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[10, 25, 50, 100].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setBatteryPercent(String(level))}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-cyan-300 hover:text-cyan-800"
              >
                {level}%
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-700">
              <Siren className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Fault injection</h2>
              <p className="text-xs text-muted-foreground">
                Exercise connection loss, emergency stop, and recovery states.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => runFault("disconnect", "Disconnect")}
              disabled={disabled}
            >
              {actionInProgress === "disconnect" ? "Disconnecting…" : "Simulate disconnect"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => runFault("estop", "Emergency stop")}
              disabled={disabled || !selectedState?.connected}
            >
              {actionInProgress === "estop" ? "Stopping…" : "Emergency stop"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => runFault("clear", "Recovery")}
              disabled={disabled}
            >
              {actionInProgress === "clear" ? "Recovering…" : "Clear / recover"}
            </Button>
          </div>
          {!selectedState?.connected && hasRobot && (
            <p className="mt-3 text-xs text-muted-foreground">
              Emergency stop requires a connected robot. Use Recovery to clear
              a fault; reconnect from the Connection page to test E-stop again.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <Move3D className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Teleport robot</h2>
              <p className="text-xs text-muted-foreground">
                Place the robot at a repeatable world pose (metres and radians).
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { id: "teleport-x", label: "X (m)", value: teleportX, setValue: setTeleportX },
              { id: "teleport-y", label: "Y (m)", value: teleportY, setValue: setTeleportY },
              { id: "teleport-yaw", label: "Yaw (rad)", value: teleportYaw, setValue: setTeleportYaw },
            ].map((field) => (
              <div key={field.id}>
                <label htmlFor={field.id} className="mb-2 block text-sm font-medium">
                  {field.label}
                </label>
                <input
                  id={field.id}
                  type="number"
                  step="0.1"
                  value={field.value}
                  onChange={(event) => field.setValue(event.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            ))}
          </div>
          {worldBounds && (
            <p className="mt-3 text-xs text-muted-foreground">
              World bounds: X {worldBounds.minX.toFixed(1)} to {worldBounds.maxX.toFixed(1)} m · Y {worldBounds.minY.toFixed(1)} to {worldBounds.maxY.toFixed(1)} m
            </p>
          )}
          <Button className="mt-4" onClick={teleport} disabled={disabled}>
            {actionInProgress === "teleport" ? "Moving robot…" : "Teleport"}
          </Button>
          <Button
            className="ml-2 mt-4"
            variant="outline"
            onClick={sendDirectGoal}
            disabled={disabled}
          >
            {actionInProgress === "direct-goal" ? "Setting goal…" : "Set direct goal"}
          </Button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Map className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Map test</h2>
              <p className="text-xs text-muted-foreground">
                Reveal the simulated ground-truth map to test map rendering.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/50 p-4">
            <div>
              <p className="text-sm font-medium">
                {selectedState?.map.topic_available ? "Map topic available" : "Map topic unavailable"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedState
                  ? `${(selectedState.map.mapped_ratio * 100).toFixed(1)}% mapped · revision ${selectedState.map.revision}`
                  : "Waiting for robot map state"}
              </p>
            </div>
            <Button onClick={revealFullMap} disabled={disabled}>
              {actionInProgress === "reveal-map" ? "Revealing…" : "Reveal full map"}
            </Button>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <Database className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Simulator data & map endpoints</h2>
              <p className="text-xs text-muted-foreground">
                Read effective configuration, robot collection, ground-truth grid, and rendered maps.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => void refreshSimulatorDetails()}
            disabled={detailsLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${detailsLoading ? "animate-spin" : ""}`} />
            Refresh details
          </Button>
        </div>
        {simDetailsError && (
          <p role="alert" className="mb-3 text-sm text-amber-700">
            {simDetailsError}
          </p>
        )}
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/50 p-4">
              <h3 className="text-sm font-medium">Ground-truth world grid</h3>
              {world ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {world.width} × {world.height} cells · {world.resolution} m/cell ·{" "}
                  {world.cells.length.toLocaleString()} values ·{" "}
                  {Object.keys(world.waypoints).length} world waypoints
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {robotId ? "No world grid loaded." : "Select a robot to load its world grid."}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Robot snapshots: {simRobots?.length ?? "unavailable"}
              </p>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  {mapSource === "world" ? "Ground-truth map image" : "SLAM map image"}
                </h3>
                <div className="flex gap-2">
                  {(["world", "slam"] as const).map((source) => (
                    <Button
                      key={source}
                      size="sm"
                      variant={mapSource === source ? "default" : "outline"}
                      onClick={() => {
                        setMapSource(source);
                        setMapImageError(false);
                      }}
                    >
                      {source === "world" ? "World" : "SLAM"}
                    </Button>
                  ))}
                </div>
              </div>
              {mapImageUrl && !mapImageError ? (
                <img
                  key={mapImageUrl}
                  src={mapImageUrl}
                  alt={`${mapSource} occupancy map for ${robotId}`}
                  onError={() => setMapImageError(true)}
                  className="max-h-72 w-full rounded-xl border border-border bg-muted object-contain"
                />
              ) : (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  {mapImageError ? "Map image endpoint unavailable." : "Select a robot to load a map."}
                </div>
              )}
              {mapSource === "slam" && selectedState && (
                <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
                  {!selectedState.capabilities.mapping ||
                  !selectedState.map.topic_available ? (
                    <p className="text-sm text-muted-foreground">
                      SLAM mapping is not supported by {robotId}.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {selectedState.map.active
                          ? `SLAM active · ${(selectedState.map.mapped_ratio * 100).toFixed(1)}% mapped · revision ${selectedState.map.revision}`
                          : "SLAM is inactive. Start mapping to generate a map; the preview is gray until then."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {!robotConnected ? (
                          <Button
                            size="sm"
                            onClick={connectForMapping}
                            disabled={disabled}
                          >
                            {actionInProgress === "slam-connect"
                              ? "Connecting…"
                              : "Connect robot"}
                          </Button>
                        ) : !selectedState.map.active ? (
                          <Button
                            size="sm"
                            onClick={startSlamMapping}
                            disabled={disabled}
                          >
                            {actionInProgress === "slam-start"
                              ? "Starting…"
                              : "Start SLAM"}
                          </Button>
                        ) : (
                          <>
                            {selectedState.task === "exploring" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={stopAutoMapping}
                                disabled={disabled}
                              >
                                {actionInProgress === "slam-stop-explore"
                                  ? "Stopping exploration…"
                                  : "Stop Auto Mapping"}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={startAutoMapping}
                                disabled={disabled}
                              >
                                {actionInProgress === "slam-explore"
                                  ? "Starting exploration…"
                                  : "Auto Mapping"}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={stopSlamMapping}
                              disabled={disabled || selectedState.task === "exploring"}
                            >
                              {actionInProgress === "slam-stop"
                                ? "Saving…"
                                : "Stop & Save"}
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-medium">Effective simulator configuration</h3>
              {simConfig ? (
                <pre className="max-h-64 overflow-auto rounded-xl bg-muted/50 p-3 text-xs">
                  {JSON.stringify(simConfig, null, 2)}
                </pre>
              ) : (
                <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                  Configuration endpoint unavailable.
                </p>
              )}
            </div>
            <details className="rounded-xl border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Robot collection snapshots
              </summary>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-xs">
                {JSON.stringify(simRobots ?? [], null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
              <Network className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Unreachable-host fault injection</h2>
              <p className="text-xs text-muted-foreground">
                Connections to listed hosts will fail. Separate multiple hosts with commas.
              </p>
            </div>
          </div>
          <label htmlFor="unreachable-hosts" className="mb-2 block text-sm font-medium">
            Hosts
          </label>
          <input
            id="unreachable-hosts"
            value={unreachableHosts}
            onChange={(event) => setUnreachableHosts(event.target.value)}
            placeholder="192.168.1.219, 10.0.0.5"
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={updateUnreachableHostList} disabled={actionInProgress !== null}>
              {actionInProgress === "unreachable-hosts" ? "Updating…" : "Apply host list"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setUnreachableHosts("");
                void runAction(
                  "unreachable-hosts",
                  () => updateUnreachableHosts([]),
                  () => "Unreachable-host list cleared.",
                );
              }}
              disabled={actionInProgress !== null}
            >
              Clear list
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
              <Code2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Custom topic publish</h2>
              <p className="text-xs text-muted-foreground">
                Publish a JSON message through the fake robot&apos;s topic interface.
              </p>
            </div>
          </div>
          <label htmlFor="publish-topic" className="mb-2 block text-sm font-medium">
            Topic
          </label>
          <input
            id="publish-topic"
            value={publishTopic}
            onChange={(event) => setPublishTopic(event.target.value)}
            placeholder="goal_pose"
            className="mb-3 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label htmlFor="publish-message" className="mb-2 block text-sm font-medium">
            Message JSON
          </label>
          <textarea
            id="publish-message"
            value={publishMessage}
            onChange={(event) => setPublishMessage(event.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button className="mt-3" onClick={publishCustomMessage} disabled={disabled}>
            {actionInProgress === "custom-publish" ? "Publishing…" : "Publish message"}
          </Button>
        </section>
      </div>

      <section className="rounded-2xl border border-red-200 bg-card p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <RotateCcw className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold">Reset simulation</h2>
            <p className="text-xs text-muted-foreground">
              Reset restores initial pose, map, plan, recording registry, and battery.
              Each reset asks for confirmation.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={resetOneRobot}
            disabled={disabled}
          >
            {actionInProgress === "reset-robot" ? "Resetting…" : `Reset ${robotId ?? "robot"}`}
          </Button>
          <Button
            variant="destructive"
            onClick={resetAllRobots}
            disabled={health === null || actionInProgress !== null}
          >
            {actionInProgress === "reset-all" ? "Resetting all…" : "Reset all robots"}
          </Button>
        </div>
      </section>
    </div>
  );
}
