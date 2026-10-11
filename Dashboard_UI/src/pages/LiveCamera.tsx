import { useCallback, useEffect, useRef, useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import {
  AlertCircle,
  Camera,
  Circle,
  Loader2,
  Play,
  Settings,
  Square,
  Trash2,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Fullscreen,
} from "lucide-react";
import CameraFeed from "../components/CameraFeed";
import { useRobotStore } from "../store/robotStore";
import {
  decodeRecordingSnapshot,
  type RecordingSnapshot,
} from "../api/decoders";
import {
  apiErrorMessage,
  deleteRecording,
  recordingStatus,
  startRecording as startRecordingApi,
  stopRecording as stopRecordingApi,
} from "../api/routes";
import {
  useWebRTCStream,
  type UseWebRTCStreamReturn,
} from "../hooks/useWebRTCStream";
import { usePolling } from "../hooks/usePolling";

/** Status polling interval while a recording is running. */
const RECORDING_POLL_MS = 1000;

/**
 * The backend's robot ids, connection state and camera inventory are all
 * server-side; only one camera track is actually relayed. See
 * `fake_backend/routers/streaming.py`: a single synthetic camera is the only
 * relay source, so only `front_camera` can ever be shown as live.
 */
interface CameraDefinition {
  id: string;
  name: string;
  location: string;
  /** True only for the camera the relay actually carries. */
  isRelayed: boolean;
  /** Shown instead of a fake "Online" badge when the camera is not relayed. */
  reason?: string;
}

const cameraList: CameraDefinition[] = [
  {
    id: "front_camera",
    name: "Front Camera",
    location: "Robot Front",
    isRelayed: true,
  },
  {
    id: "rear_camera",
    name: "Rear Camera",
    location: "Robot Rear",
    isRelayed: false,
    reason: "The backend relays a single camera track (front camera only).",
  },
  {
    id: "left_camera",
    name: "Left Camera",
    location: "Robot Left Side",
    isRelayed: false,
    reason: "The backend relays a single camera track (front camera only).",
  },
  {
    id: "right_camera",
    name: "Right Camera",
    location: "Robot Right Side",
    isRelayed: false,
    reason: "The backend relays a single camera track (front camera only).",
  },
  {
    id: "top_camera",
    name: "Top Camera",
    location: "Robot Top",
    isRelayed: false,
    reason: "This robot exposes no top camera.",
  },
  {
    id: "gripper_camera",
    name: "Gripper Camera",
    location: "End Effector",
    isRelayed: false,
    reason: "This robot exposes no gripper camera.",
  },
];

/** The cameras a view-mode grid may show: relayed first, then the rest. */
const griddableCameras = cameraList.filter(
  (camera) => camera.isRelayed || camera.id !== "top_camera",
);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

export default function LiveCamera() {
  const [selectedCamera, setSelectedCamera] = useState("front_camera");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isRecordingBusy, setIsRecordingBusy] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingSnapshot>({
    recording: false,
    rosbagName: null,
    durationS: 0,
    rosbags: [],
  });
  const [isLibraryBusy, setIsLibraryBusy] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(
    null,
  );
  const [cameraSettings, setCameraSettings] = useState({
    brightness: [50],
    contrast: [50],
    saturation: [50],
    zoom: [100],
    nightVision: false,
    motionDetection: true,
    audioEnabled: true,
  });
  const [viewMode, setViewMode] = useState("single"); // single, quad, grid

  /** Robot id comes from the shared store — never a literal. */
  const robotId = useRobotStore((state) => state.selectedRobotId);

  // ── WebRTC ────────────────────────────────────────────────────────────────

  /**
   * ONE peer connection for the whole page. Every tile renders the same relayed
   * frame, and each extra `useWebRTCStream` would open its own pc on the backend
   * for no benefit.
   */
  const stream: UseWebRTCStreamReturn = useWebRTCStream(robotId);

  const {
    isConnecting,
    isStreaming,
    error: streamError,
    statusMessage,
    trackCount,
    streamStatus,
    start: startStream,
    stop: stopStream,
  } = stream;

  const isStreamActive = isStreaming || isConnecting;

  // A robot change invalidates anything the UI knows about the old one.
  useEffect(() => {
    setRecordingState({
      recording: false,
      rosbagName: null,
      durationS: 0,
      rosbags: [],
    });
    setRecordingError(null);
  }, [robotId]);

  // ── Recording ─────────────────────────────────────────────────────────────

  /** Guards against overlapping polls (the 1s tick can outrun a slow request). */
  const statusInFlightRef = useRef(false);

  /**
   * Reads the authoritative recording state (including the rosbag library).
   *
   * The REC overlay timer is driven by the backend's `duration_s` rather than a
   * local counter, so it stays correct after a page reload or a second tab.
   */
  const refreshRecordingStatus = useCallback(
    async (options: { silent?: boolean } = {}): Promise<void> => {
      if (!robotId) return;

      // A silent poll that overlaps an in-flight request is simply dropped.
      if (options.silent && statusInFlightRef.current) return;

      statusInFlightRef.current = true;
      if (!options.silent) setIsLibraryBusy(true);

      try {
        const payload = await recordingStatus(robotId);
        setRecordingState(decodeRecordingSnapshot(payload));
        if (!options.silent) setRecordingError(null);
      } catch (err) {
        const message = apiErrorMessage(err);
        // A failed 1s poll must not spam the banner; it clears on the next poll.
        if (!options.silent) setRecordingError(message);
      } finally {
        statusInFlightRef.current = false;
        if (!options.silent) setIsLibraryBusy(false);
      }
    },
    [robotId],
  );

  // Load the library when the page opens or the robot changes.
  useEffect(() => {
    void refreshRecordingStatus();
  }, [refreshRecordingStatus]);

  const pollRecordingStatus = useCallback(
    () => refreshRecordingStatus({ silent: true }),
    [refreshRecordingStatus],
  );
  usePolling(pollRecordingStatus, {
    intervalMs: RECORDING_POLL_MS,
    enabled: Boolean(recordingState.recording && robotId),
    key: robotId ?? "no-robot",
  });

  const handleStartRecording = async (): Promise<void> => {
    if (!robotId) {
      setRecordingError("No robot selected.");
      return;
    }

    setIsRecordingBusy(true);
    setRecordingError(null);

    try {
      const response = await startRecordingApi(
        robotId,
        `camera_${selectedCamera}`,
      );

      // The backend reports refusals (e.g. already recording) in the payload
      // rather than as an HTTP error.
      if (response.success === false) {
        setRecordingError(response.message ?? "The robot refused to start recording.");
      }

      await refreshRecordingStatus();
    } catch (err) {
      setRecordingError(apiErrorMessage(err));
    } finally {
      setIsRecordingBusy(false);
    }
  };

  const handleStopRecording = async (): Promise<void> => {
    if (!robotId) return;

    setIsRecordingBusy(true);
    setRecordingError(null);

    try {
      const response = await stopRecordingApi(robotId);
      if (response.success === false) {
        setRecordingError(response.message ?? "The robot refused to stop recording.");
      }

      await refreshRecordingStatus();
    } catch (err) {
      setRecordingError(apiErrorMessage(err));
    } finally {
      setIsRecordingBusy(false);
    }
  };

  const handleDeleteRecording = async (name: string): Promise<void> => {
    if (!robotId) return;

    setDeletingName(name);
    setRecordingError(null);

    try {
      const response = await deleteRecording(robotId, name);
      if (response.success === false) {
        setRecordingError(response.message ?? `Could not delete "${name}".`);
      }
      setConfirmDeleteName(null);
      await refreshRecordingStatus();
    } catch (err) {
      setRecordingError(apiErrorMessage(err));
    } finally {
      setDeletingName(null);
    }
  };

  // ── View ──────────────────────────────────────────────────────────────────

  const selectedCameraData =
    cameraList.find((camera) => camera.id === selectedCamera) ?? cameraList[0];

  const renderCameraGrid = () => {
    switch (viewMode) {
      case "quad":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
            {griddableCameras.slice(0, 4).map((camera) => (
              <div key={camera.id} className="relative h-full min-h-0 min-w-0">
                <CameraFeed
                  cameraId={camera.id}
                  cameraName={camera.name}
                  robotId={robotId}
                  stream={stream}
                  isSelected={camera.id === selectedCamera}
                  onClick={() => setSelectedCamera(camera.id)}
                />
              </div>
            ))}
          </div>
        );
      case "grid":
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 h-full">
            {griddableCameras.map((camera) => (
              <div key={camera.id} className="relative h-full min-h-0 min-w-0">
                <CameraFeed
                  cameraId={camera.id}
                  cameraName={camera.name}
                  robotId={robotId}
                  stream={stream}
                  isSelected={camera.id === selectedCamera}
                  onClick={() => setSelectedCamera(camera.id)}
                />
              </div>
            ))}
          </div>
        );
      default:
        return (
          <CameraFeed
            cameraId={selectedCamera}
            cameraName={selectedCameraData.name}
            robotId={robotId}
            stream={stream}
            isSelected={true}
            showControls={true}
          />
        );
    }
  };

  return (
    <div className="p-6 pb-28 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Live Camera</h1>
        <p className="text-muted-foreground">
          Live WebRTC video from the robot and rosbag recording control
        </p>
      </div>

      {!robotId && (
        <Card className="border-yellow-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div className="text-sm">
              No robot selected. Streaming and recording controls are disabled
              until you pick a robot on the Dashboard or Robot Connection page.
            </div>
          </CardContent>
        </Card>
      )}

      {recordingError && (
        <Card className="border-red-500/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div className="text-sm">{recordingError}</div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-4">
        {/* Main Camera Feed */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center space-x-2">
                  <Camera className="w-5 h-5" />
                  <span>Camera Feed</span>
                  {recordingState.recording && (
                    <Badge
                      variant="secondary"
                      className="bg-red-500 text-white animate-pulse max-w-full truncate"
                    >
                      <Circle className="w-3 h-3 mr-1 fill-current" />
                      REC {formatDuration(recordingState.durationS)}
                      {recordingState.rosbagName
                        ? ` · ${recordingState.rosbagName}`
                        : ""}
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={isStreamActive ? "secondary" : "default"}
                    disabled={!robotId || isConnecting}
                    onClick={() => {
                      if (isStreamActive) {
                        stopStream();
                      } else {
                        void startStream();
                      }
                    }}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting…
                      </>
                    ) : isStreaming ? (
                      <>
                        <Square className="w-4 h-4 mr-2" />
                        Stop Stream
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Stream
                      </>
                    )}
                  </Button>
                  <Select value={viewMode} onValueChange={setViewMode}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single View</SelectItem>
                      <SelectItem value="quad">Quad View</SelectItem>
                      <SelectItem value="grid">Grid View</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" disabled>
                    <Fullscreen className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                {renderCameraGrid()}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  {isStreaming
                    ? "Streaming"
                    : isConnecting
                      ? "Negotiating"
                      : "Stopped"}
                </Badge>
                <span>{statusMessage}</span>
                {trackCount > 0 && <span>· {trackCount} track(s) offered</span>}
              </div>

              {streamError && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <span>{streamError}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Camera Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Camera Controls</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {/* Recording Controls */}
                <div className="space-y-4">
                  <h3 className="font-medium">Recording</h3>
                  <div className="space-y-2">
                    <Button
                      onClick={() => void handleStartRecording()}
                      disabled={
                        recordingState.recording || isRecordingBusy || !robotId
                      }
                      className="w-full"
                      variant={recordingState.recording ? "secondary" : "default"}
                    >
                      <Circle className="w-4 h-4 mr-2 fill-current" />
                      {recordingState.recording
                        ? `Recording ${formatDuration(recordingState.durationS)}`
                        : isRecordingBusy
                          ? "Working…"
                          : "Start Recording"}
                    </Button>
                    <Button
                      onClick={() => void handleStopRecording()}
                      disabled={
                        !recordingState.recording || isRecordingBusy || !robotId
                      }
                      variant="destructive"
                      className="w-full"
                    >
                      <Square className="w-4 h-4 mr-2" />
                      Stop Recording
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Saving rosbags for{" "}
                    <span className="font-medium">
                      {recordingState.rosbagName ?? "—"}
                    </span>
                  </div>
                </div>

                {/* Camera Selection */}
                <div className="space-y-4">
                  <h3 className="font-medium">Camera Selection</h3>
                  <Select
                    value={selectedCamera}
                    onValueChange={setSelectedCamera}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cameraList.map((camera) => (
                        <SelectItem key={camera.id} value={camera.id}>
                          <div className="flex items-center space-x-2">
                            <span>{camera.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {camera.isRelayed ? "Live" : "Not relayed"}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {!selectedCameraData.isRelayed && (
                    <p className="text-xs text-muted-foreground">
                      {selectedCameraData.reason}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                    <Button variant="outline" size="sm" disabled>
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      <RotateCw className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      <Maximize className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The backend exposes no camera zoom/rotate controls.
                  </p>
                </div>

                {/* Quick Actions */}
                <div className="space-y-4">
                  <h3 className="font-medium">Quick Actions</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="night-vision">Night Vision</Label>
                      <Switch
                        id="night-vision"
                        checked={cameraSettings.nightVision}
                        onCheckedChange={(checked) =>
                          setCameraSettings((prev) => ({
                            ...prev,
                            nightVision: checked,
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="motion-detection">Motion Detection</Label>
                      <Switch
                        id="motion-detection"
                        checked={cameraSettings.motionDetection}
                        onCheckedChange={(checked) =>
                          setCameraSettings((prev) => ({
                            ...prev,
                            motionDetection: checked,
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="audio">Audio</Label>
                      <Switch
                        id="audio"
                        checked={cameraSettings.audioEnabled}
                        onCheckedChange={(checked) =>
                          setCameraSettings((prev) => ({
                            ...prev,
                            audioEnabled: checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    These switches are local display preferences; the backend
                    has no endpoint for them.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rosbag library — the real replacement for "Download Last". */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>All Recordings</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!robotId || isLibraryBusy}
                  onClick={() => void refreshRecordingStatus()}
                >
                  {isLibraryBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCw className="w-4 h-4 mr-2" />
                  )}
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recordingState.rosbags.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {robotId
                    ? "No rosbags on this robot yet."
                    : "Select a robot to list its rosbags."}
                </p>
              ) : (
                <ul className="divide-y">
                  {recordingState.rosbags.map((bag) => (
                    <li
                      key={bag.name}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {bag.name}
                          {recordingState.rosbagName === bag.name &&
                            recordingState.recording && (
                              <Badge
                                variant="secondary"
                                className="ml-2 bg-red-500 text-white text-xs"
                              >
                                recording
                              </Badge>
                            )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDuration(bag.duration_s)} ·{" "}
                          {formatBytes(bag.size_bytes)}
                          {bag.created_at !== undefined &&
                            ` · ${new Date(bag.created_at * 1000).toLocaleString()}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {confirmDeleteName === bag.name ? (
                          <>
                            <span className="text-xs text-muted-foreground">
                              Delete this rosbag?
                            </span>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deletingName === bag.name}
                              onClick={() => void handleDeleteRecording(bag.name)}
                            >
                              {deletingName === bag.name ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                "Delete"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmDeleteName(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!robotId}
                            onClick={() => setConfirmDeleteName(bag.name)}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Camera Settings and Status */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="w-5 h-5" />
                <span>Camera Settings</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Brightness</Label>
                <Slider
                  value={cameraSettings.brightness}
                  onValueChange={(value) =>
                    setCameraSettings((prev) => ({
                      ...prev,
                      brightness: value,
                    }))
                  }
                  max={100}
                  step={1}
                  className="mt-2"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {cameraSettings.brightness[0]}%
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Contrast</Label>
                <Slider
                  value={cameraSettings.contrast}
                  onValueChange={(value) =>
                    setCameraSettings((prev) => ({ ...prev, contrast: value }))
                  }
                  max={100}
                  step={1}
                  className="mt-2"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {cameraSettings.contrast[0]}%
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Saturation</Label>
                <Slider
                  value={cameraSettings.saturation}
                  onValueChange={(value) =>
                    setCameraSettings((prev) => ({
                      ...prev,
                      saturation: value,
                    }))
                  }
                  max={100}
                  step={1}
                  className="mt-2"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {cameraSettings.saturation[0]}%
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Zoom</Label>
                <Slider
                  value={cameraSettings.zoom}
                  onValueChange={(value) =>
                    setCameraSettings((prev) => ({ ...prev, zoom: value }))
                  }
                  min={100}
                  max={500}
                  step={10}
                  className="mt-2"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {cameraSettings.zoom[0]}%
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Applying these to the stream needs a backend endpoint that does
                not exist yet; only the sliders are local.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Camera Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Camera:</span>
                  <span>{selectedCameraData.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Feed:</span>
                  <Badge
                    variant={selectedCameraData.isRelayed ? "default" : "secondary"}
                    className={selectedCameraData.isRelayed ? "bg-cyan-500" : ""}
                  >
                    {selectedCameraData.isRelayed ? "Relayed" : "Not relayed"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location:</span>
                  <span>{selectedCameraData.location}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connection:</span>
                  <span>
                    {isStreaming
                      ? "Streaming"
                      : isConnecting
                        ? "Connecting"
                        : "Idle"}
                  </span>
                </div>
              </div>

              {/* Real numbers from GET /streaming/status. */}
              <div className="border-t pt-3 space-y-2 text-sm">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  Backend relay
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source tracks:</span>
                  <span>
                    {streamStatus ? streamStatus.source_tracks : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Peer connections:</span>
                  <span>{streamStatus ? streamStatus.total_pcs : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Robot push:</span>
                  <span>
                    {streamStatus
                      ? streamStatus.client_connected
                        ? "Connected"
                        : "No robot client"
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Offered tracks:</span>
                  <span>{trackCount}</span>
                </div>
                {!streamStatus && (
                  <p className="text-xs text-muted-foreground">
                    Relay statistics appear once a stream is running.
                  </p>
                )}
              </div>

              {!selectedCameraData.isRelayed && (
                <p className="text-xs text-muted-foreground">
                  {selectedCameraData.reason}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All Cameras</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {cameraList.map((camera) => (
                <div
                  key={camera.id}
                  className={`p-2 border rounded-lg cursor-pointer transition-colors ${camera.id === selectedCamera
                      ? "border-cyan-500 bg-cyan-50"
                      : "border-border hover:bg-accent/50"
                    }`}
                  onClick={() => setSelectedCamera(camera.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{camera.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {camera.location}
                      </div>
                    </div>
                    <Badge
                      variant={camera.isRelayed ? "default" : "secondary"}
                      className={`text-xs ${camera.isRelayed ? "bg-cyan-500" : ""}`}
                    >
                      {camera.isRelayed ? "Live" : "Unavailable"}
                    </Badge>
                  </div>
                  {!camera.isRelayed && (
                    <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                      {camera.reason}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
