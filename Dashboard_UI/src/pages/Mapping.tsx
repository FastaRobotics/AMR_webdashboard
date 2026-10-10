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
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Play,
  Square,
  Save,
  RotateCcw,
  Map as MapIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Crosshair,
  Layers,
} from "lucide-react";
import { cn } from "../components/ui/utils";
import MapPanel from "../components/MapPanel";
import { useRobotStore } from "../store/robotStore";
import { useFleet } from "../hooks/useFleet";
import { useRobotState } from "../hooks/useRobotState";
import {
  apiErrorMessage,
  deleteMap,
  revealMap,
  saveLocation,
  startExploring,
  startMapping,
  stopExploring,
  stopMapping,
  stopNavigation,
  startNavigationWithMap,
} from "../api/routes";

/**
 * SLAM mapping.
 *
 * Every button maps to a real backend call:
 *
 *   Start Mapping    POST /mapping/{id}/start
 *   Stop Mapping     POST /mapping/{id}/stop          (saves the map by name)
 *   Auto Mapping     POST /navigation/{id}/exploring/start|stop
 *   Save Location    POST /mapping/{id}/save_location
 *   Load             POST /navigation/{id}/start_with_map
 *   Delete           DELETE /mapping/{id}/delete      (map_name in the body)
 *
 * The map itself streams over
 * ws /streaming_socket/{id}/ws/subscribe/map and is drawn by MapPanel; the
 * progress bar reports the SLAM map's real coverage (mapped cells / total),
 * not a timer.
 */
export default function Mapping() {
  const { robots, connectionStatus } = useFleet({ pollIntervalMs: 5000 });
  const selectedRobotId = useRobotStore((state) => state.selectedRobotId);
  const selectRobot = useRobotStore((state) => state.selectRobot);

  const {
    state: robotState,
    unavailable,
    error: stateError,
    refresh: refreshState,
  } = useRobotState(selectedRobotId, { pollIntervalMs: 1000 });

  const [mapName, setMapName] = useState("latest");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showGroundTruth, setShowGroundTruth] = useState(false);

  const connected = selectedRobotId
    ? (connectionStatus[selectedRobotId] ?? false)
    : false;

  const mappedPercent = robotState ? robotState.map.mapped_ratio * 100 : 0;
  const mappingActive = robotState?.task === "mapping";
  const exploringActive = robotState?.task === "exploring";
  const mapTopicAvailable = robotState?.capabilities.map_topic ?? true;

  /** Keep the suggested map name in step with the robot's current map. */
  useEffect(() => {
    if (robotState?.map.loaded_map) setMapName(robotState.map.loaded_map);
  }, [robotState?.map.loaded_map]);

  /** Clear stale messages when the selection changes. */
  useEffect(() => {
    setActionError(null);
    setActionMessage(null);
  }, [selectedRobotId]);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setIsBusy(true);
      setActionError(null);
      setActionMessage(null);

      try {
        await action();
        setActionMessage(label);
        await refreshState();
      } catch (err) {
        setActionError(apiErrorMessage(err));
      } finally {
        setIsBusy(false);
      }
    },
    [refreshState],
  );

  const handleStartMapping = () =>
    run("Mapping started — drive the robot to build the map.", () =>
      startMapping(selectedRobotId!),
    );

  const handleStopMapping = () =>
    run(`Map saved as “${mapName}”.`, () =>
      stopMapping(selectedRobotId!, { map_name: mapName }),
    );

  const handleAutoMapping = () =>
    exploringActive
      ? run("Exploration stopped.", () => stopExploring(selectedRobotId!))
      : run("Exploring started — the robot is mapping on its own.", () =>
        startExploring(selectedRobotId!),
      );

  const handleSaveLocation = async () => {
    if (!selectedRobotId) return;
    setIsBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const response = (await saveLocation(selectedRobotId)) as {
        location?: { x: number; y: number; yaw: number };
        message?: string;
      };
      const location = response.location;
      setActionMessage(
        location
          ? `Location saved: x ${location.x.toFixed(2)}, y ${location.y.toFixed(2)}, yaw ${location.yaw.toFixed(2)} rad`
          : (response.message ?? "Location saved."),
      );
      await refreshState();
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadMap = (name: string) =>
    run(`Loading “${name}” and localising…`, () =>
      startNavigationWithMap(selectedRobotId!, {
        map_name: name,
        localize_after_load: true,
        localize_failure_is_fatal: false,
      }),
    );

  const handleDeleteMap = (name: string) =>
    run(`“${name}” deleted.`, () => deleteMap(selectedRobotId!, name));

  const handleStopNavigation = () =>
    run("Navigation stopped.", () => stopNavigation(selectedRobotId!));

  const handleReveal = () =>
    run("Whole world revealed into the SLAM map (test helper).", () =>
      revealMap(selectedRobotId!),
    );

  const savedMaps = useMemo(
    () => robotState?.saved_maps ?? [],
    [robotState?.saved_maps],
  );

  return (
    <div className="p-6 pb-28 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Mapping</h1>
          <p className="text-muted-foreground">
            Build and manage SLAM maps of the environment
          </p>
        </div>

        {/* Robot picker — the mapping target is never a hardcoded id */}
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

      {actionError && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">{actionError}</div>
          </CardContent>
        </Card>
      )}

      {actionMessage && !actionError && (
        <Card className="border-green-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
            <div className="text-sm">{actionMessage}</div>
          </CardContent>
        </Card>
      )}

      {!connected && !mappingActive && (
        <Card className="border-yellow-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div className="text-sm">
              This robot is not connected, so mapping services will fail. Connect
              it on the Robot Connection page first.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main viewer */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center space-x-2">
                  <Layers className="w-5 h-5" />
                  <span>SLAM Viewer</span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      mappingActive
                        ? "bg-green-500 text-white"
                        : exploringActive
                          ? "bg-teal-500 text-white"
                          : "bg-gray-500 text-white",
                    )}
                  >
                    {mappingActive
                      ? "Mapping"
                      : exploringActive
                        ? "Exploring"
                        : robotState
                          ? "Idle"
                          : "No telemetry"}
                  </Badge>
                </CardTitle>

                <div className="flex items-center space-x-2">
                  <Label
                    htmlFor="ground-truth"
                    className="text-xs text-muted-foreground"
                  >
                    World overlay
                  </Label>
                  <Switch
                    id="ground-truth"
                    checked={showGroundTruth}
                    onCheckedChange={setShowGroundTruth}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleReveal()}
                    disabled={isBusy || !connected}
                    title="Fill the SLAM map with the simulated world"
                  >
                    <Crosshair className="w-4 h-4 mr-1" />
                    Reveal
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {mapTopicAvailable ? (
                <MapPanel
                  robotId={selectedRobotId}
                  showGroundTruth={showGroundTruth}
                  height={420}
                />
              ) : (
                <div className="h-[240px] sm:h-[420px] flex items-center justify-center text-sm text-muted-foreground border rounded-lg">
                  This robot publishes no map topic, so SLAM mapping is not
                  available on it. (The Go2 has no SLAM stack.)
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Map coverage</span>
                  <span>
                    {robotState
                      ? `${mappedPercent.toFixed(1)}%`
                      : unavailable
                        ? "n/a"
                        : "—"}
                  </span>
                </div>
                <Progress value={mappedPercent} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {/* Mapping controls */}
          <Card>
            <CardHeader>
              <CardTitle>Mapping Controls</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="map-name" className="mb-2 block text-sm font-medium">
                      Map name to save
                    </Label>
                    <Input
                      id="map-name"
                      value={mapName}
                      onChange={(event) => setMapName(event.target.value)}
                      placeholder="latest"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Sent as the JSON body of POST /mapping/&lt;robot&gt;/stop,
                      together with the visual-SLAM flags.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => void handleStartMapping()}
                      disabled={isBusy || mappingActive || !connected}
                      variant={mappingActive ? "secondary" : "default"}
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Start Mapping
                    </Button>
                    <Button
                      onClick={() => void handleStopMapping()}
                      disabled={isBusy || !mappingActive}
                      variant="destructive"
                    >
                      <Square className="w-4 h-4 mr-2" />
                      Stop &amp; Save
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Button
                      onClick={() => void handleSaveLocation()}
                      disabled={isBusy || !connected}
                      variant="outline"
                      className="w-full"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save Current Location
                    </Button>
                    <Button
                      onClick={() => void handleAutoMapping()}
                      disabled={isBusy || !connected}
                      variant="outline"
                      className="w-full"
                    >
                      {exploringActive ? (
                        <>
                          <Square className="w-4 h-4 mr-2" />
                          Stop Auto Mapping
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Auto Mapping (Frontier Exploration)
                        </>
                      )}
                    </Button>
                    {robotState?.task === "navigation" && (
                      <Button
                        onClick={() => void handleStopNavigation()}
                        disabled={isBusy}
                        variant="outline"
                        className="w-full"
                      >
                        <Square className="w-4 h-4 mr-2" />
                        Stop Navigation
                      </Button>
                    )}
                  </div>

                  <div className="bg-muted p-3 rounded-lg text-sm">
                    <h4 className="font-medium mb-2">Mapping Status</h4>
                    {robotState ? (
                      <div className="space-y-1">
                        <div>Task: {robotState.task ?? "idle"}</div>
                        <div>
                          Loop closures: {robotState.map.loop_closures}
                        </div>
                        <div>Map revision: {robotState.map.revision}</div>
                        <div>
                          Loaded map: {robotState.map.loaded_map ?? "none"}
                        </div>
                        <div>
                          Grid: {robotState.map.size[0]} ×{" "}
                          {robotState.map.size[1]} @{" "}
                          {robotState.map.resolution} m/cell
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground">
                        {stateError
                          ? stateError
                          : unavailable
                            ? "No mapping status on this backend."
                            : "No mapping status yet."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Saved maps */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center space-x-2">
                  <MapIcon className="w-5 h-5" />
                  <span>Saved Maps</span>
                </span>
                <Badge variant="outline">{savedMaps.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {savedMaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {unavailable
                    ? "This backend reports no saved-map list."
                    : "No maps saved yet. Run a mapping session and stop it to save one."}
                </p>
              ) : (
                savedMaps.map((name) => {
                  const isLoaded = robotState?.map.loaded_map === name;
                  return (
                    <div
                      key={name}
                      className="p-3 border border-border rounded-lg space-y-2"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <h4 className="font-medium truncate">{name}</h4>
                          <div className="text-xs text-muted-foreground">
                            {isLoaded ? "loaded in the robot" : "on the robot"}
                          </div>
                        </div>
                        <Badge variant={isLoaded ? "default" : "outline"}>
                          {isLoaded ? "Active" : "Saved"}
                        </Badge>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          disabled={isBusy || !connected}
                          onClick={() => void handleLoadMap(name)}
                        >
                          Load
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          disabled={isBusy || !connected}
                          onClick={() => void handleDeleteMap(name)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mapping Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolution</span>
                  <span>
                    {robotState
                      ? `${robotState.map.resolution} m/cell`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Map topic</span>
                  <span>{mapTopicAvailable ? "available" : "unavailable"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Path topic</span>
                  <span>
                    {robotState?.capabilities.path_topic === false
                      ? "unavailable"
                      : "available"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Diagnostics</span>
                  <span>
                    {robotState?.capabilities.diagnostics_topic === false
                      ? "unavailable"
                      : "available"}
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Resolution and update rate are fixed by the robot's SLAM node;
                the backend exposes no endpoint to change them at runtime.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
