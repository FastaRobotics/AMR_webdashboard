import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronRight,
  Clock3,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  apiErrorMessage,
  getTelemetry,
  getSimRobotTelemetryTopic,
} from "../api/routes";
import type {
  DiagnosticsMessage,
  OdomMessage,
  OccupancyGridMessage,
  PathMessage,
  RobotStreamMessage,
  RobotStreamTopic,
  TfMessage,
  TelemetryTopicsResponse,
} from "../api/types";
import { Button } from "../components/ui/button";
import OccupancyGridViewer from "../components/OccupancyGridViewer";
import PointCloudViewer, {
  type PointCloud2Msg,
} from "../components/PointCloudViewer";
import TFViewer from "../components/TFViewer";
import { useFleet } from "../hooks/useFleet";
import { useRobotStream } from "../hooks/useRobotStream";
import { usePolling } from "../hooks/usePolling";
import { useRobotStore } from "../store/robotStore";

const topicDefinitions = [
  { id: "odom", label: "Odometry", source: "stream", description: "Position, orientation, and velocity" },
  { id: "tf", label: "Transforms", source: "stream", description: "Robot coordinate frames" },
  { id: "map", label: "Occupancy map", source: "stream", description: "SLAM map grid" },
  { id: "diagnostics", label: "Diagnostics", source: "stream", description: "Robot health and system status" },
  { id: "path", label: "Path", source: "stream", description: "Navigation path poses" },
  { id: "imu", label: "IMU", source: "http", description: "Orientation, acceleration, and angular velocity" },
  { id: "battery_state", label: "Battery", source: "http", description: "Charge, voltage, and temperature" },
  { id: "point_cloud", label: "Point cloud", source: "http", description: "3D lidar returns" },
  { id: "image_compressed", label: "Camera image", source: "http", description: "Compressed camera frame" },
  { id: "depth_image_compressed", label: "Depth image", source: "http", description: "Compressed depth-camera frame" },
  { id: "left_wheel_encoder", label: "Left wheel encoder", source: "http", description: "Left wheel tick count" },
  { id: "right_wheel_encoder", label: "Right wheel encoder", source: "http", description: "Right wheel tick count" },
] as const;

type TelemetryTopic = (typeof topicDefinitions)[number];
type TelemetryState = "receiving" | "connecting" | "unavailable" | "error";

const streamTopics: readonly RobotStreamTopic[] = [
  "odom",
  "tf",
  "map",
  "diagnostics",
  "path",
];

function getStreamValue(
  topic: RobotStreamTopic,
  message: RobotStreamMessage | null,
): unknown {
  if (!message) return null;
  return message[topic] ?? null;
}

function formatPayload(value: unknown): string {
  const formatted = JSON.stringify(
    value,
    (_key, item: unknown) =>
      Array.isArray(item) && item.length > 80
        ? `[${item.length} values] ${JSON.stringify(item.slice(0, 12))} …`
        : item,
    2,
  );
  return (formatted ?? "No data").slice(0, 12000);
}

function useImageSource(
  data: unknown,
  format: string | undefined,
): string | null {
  return useMemo(() => {
    if (typeof data === "string") {
      return data.startsWith("data:")
        ? data
        : `data:image/${format === "jpeg" ? "jpeg" : "png"};base64,${data}`;
    }
    if (!Array.isArray(data) || data.some((byte) => typeof byte !== "number")) {
      return null;
    }

    let binary = "";
    const chunkSize = 8192;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      binary += String.fromCharCode(...data.slice(offset, offset + chunkSize));
    }
    return `data:image/${format === "jpeg" ? "jpeg" : "png"};base64,${btoa(binary)}`;
  }, [data, format]);
}

function TopicStatus({ state }: { state: TelemetryState }) {
  const statusStyles: Record<TelemetryState, string> = {
    receiving: "bg-emerald-50 text-emerald-700",
    connecting: "bg-amber-50 text-amber-700",
    unavailable: "bg-slate-100 text-slate-500",
    error: "bg-red-50 text-red-700",
  };
  const label: Record<TelemetryState, string> = {
    receiving: "Receiving",
    connecting: "Connecting",
    unavailable: "No data",
    error: "Error",
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusStyles[state]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "receiving"
            ? "bg-emerald-500"
            : state === "error"
              ? "bg-red-500"
              : state === "connecting"
                ? "bg-amber-500"
                : "bg-slate-400"
        }`}
      />
      {label[state]}
    </span>
  );
}

function readRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(
  record: Record<string, unknown> | null,
  key: string,
  fallback = 0,
): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ImuVisualization({ value }: { value: unknown }) {
  const imu = readRecord(value);
  const orientation = readRecord(imu?.orientation);
  const acceleration = readRecord(imu?.linear_acceleration);
  const angularVelocity = readRecord(imu?.angular_velocity);
  const qx = readNumber(orientation, "x");
  const qy = readNumber(orientation, "y");
  const qz = readNumber(orientation, "z");
  const qw = readNumber(orientation, "w", 1);
  const roll =
    Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)) *
    (180 / Math.PI);
  const pitchRadians = Math.asin(
    Math.max(-1, Math.min(1, 2 * (qw * qy - qz * qx))),
  );
  const pitch = pitchRadians * (180 / Math.PI);
  const pitchOffset = Math.max(-32, Math.min(32, pitch * 0.7));
  const rotation = Math.max(-70, Math.min(70, roll));

  const metrics = [
    {
      label: "Linear acceleration",
      units: "m/s²",
      values: acceleration,
      range: 20,
      color: "bg-cyan-500",
    },
    {
      label: "Angular velocity",
      units: "rad/s",
      values: angularVelocity,
      range: 3,
      color: "bg-violet-500",
    },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">IMU visualization</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Attitude and motion values from the live sensor message
        </p>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <div className="mx-auto w-full max-w-[220px]">
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={`IMU attitude: roll ${roll.toFixed(1)} degrees, pitch ${pitch.toFixed(1)} degrees`}
            className="w-full"
          >
            <defs>
              <clipPath id="imu-horizon-clip">
                <circle cx="100" cy="100" r="76" />
              </clipPath>
            </defs>
            <g clipPath="url(#imu-horizon-clip)">
              <g
                transform={`translate(0 ${pitchOffset}) rotate(${-rotation} 100 100)`}
              >
                <rect x="-20" y="-30" width="240" height="130" fill="#38bdf8" />
                <rect x="-20" y="100" width="240" height="130" fill="#d97706" />
                <line
                  x1="-20"
                  y1="100"
                  x2="220"
                  y2="100"
                  stroke="white"
                  strokeWidth="3"
                />
                <line x1="68" y1="70" x2="88" y2="70" stroke="white" />
                <line x1="112" y1="70" x2="132" y2="70" stroke="white" />
                <line x1="58" y1="84" x2="88" y2="84" stroke="white" />
                <line x1="112" y1="84" x2="142" y2="84" stroke="white" />
                <line x1="68" y1="130" x2="88" y2="130" stroke="white" />
                <line x1="112" y1="130" x2="132" y2="130" stroke="white" />
              </g>
            </g>
            <circle
              cx="100"
              cy="100"
              r="76"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-slate-500"
            />
            <path
              d="M 84 98 L 96 98 L 100 103 L 104 98 L 116 98"
              fill="none"
              stroke="#facc15"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M 100 21 L 95 31 L 105 31 Z" fill="#facc15" />
          </svg>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-muted/60 px-2 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Roll
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {roll.toFixed(1)}°
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-2 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Pitch
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {pitch.toFixed(1)}°
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">{metric.label}</h4>
                <span className="text-xs text-muted-foreground">
                  {metric.units}
                </span>
              </div>
              <div className="space-y-3">
                {(["x", "y", "z"] as const).map((axis) => {
                  const reading = readNumber(metric.values, axis);
                  const width = Math.min(
                    100,
                    (Math.abs(reading) / metric.range) * 100,
                  );
                  return (
                    <div
                      key={axis}
                      className="grid grid-cols-[18px_minmax(0,1fr)_72px] items-center gap-2"
                    >
                      <span className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                        {axis}
                      </span>
                      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                        <span className="absolute bottom-0 left-1/2 top-0 w-px bg-slate-400/70" />
                        <span
                          className={`absolute top-0 h-full rounded-full ${metric.color}`}
                          style={{
                            width: `${width / 2}%`,
                            left: reading >= 0 ? "50%" : `calc(50% - ${width / 2}%)`,
                          }}
                        />
                      </div>
                      <span className="text-right font-mono text-xs tabular-nums">
                        {reading.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Horizon rotates with roll and shifts with pitch. Bars are scaled for
            readability; the numeric values are the sensor readings.
          </p>
        </div>
      </div>
    </section>
  );
}

function OdomVisualization({ value }: { value: OdomMessage }) {
  const position = value.pose.pose.position;
  const orientation = value.pose.pose.orientation;
  const twist = value.twist.twist;
  const yaw = Math.atan2(
    2 * (orientation.w * orientation.z + orientation.x * orientation.y),
    1 - 2 * (orientation.y ** 2 + orientation.z ** 2),
  );
  const speed = Math.hypot(twist.linear.x, twist.linear.y);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Robot pose & motion</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Live state from the odometry stream
        </p>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
        <div className="flex flex-col items-center rounded-xl bg-slate-950 p-4 text-white">
          <svg viewBox="0 0 120 120" className="w-36" role="img" aria-label={`Heading ${(yaw * 180 / Math.PI).toFixed(0)} degrees`}>
            <circle cx="60" cy="60" r="48" fill="#111827" stroke="#475569" strokeWidth="2" />
            <path d="M60 20 L69 65 L60 58 L51 65 Z" fill="#22d3ee" transform={`rotate(${yaw * 180 / Math.PI} 60 60)`} />
            <circle cx="60" cy="60" r="4" fill="white" />
            <text x="60" y="14" textAnchor="middle" fill="#94a3b8" fontSize="9">N</text>
          </svg>
          <span className="font-mono text-sm">{(yaw * 180 / Math.PI).toFixed(1)}° heading</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[
            ["Position X", `${position.x.toFixed(2)} m`],
            ["Position Y", `${position.y.toFixed(2)} m`],
            ["Height Z", `${position.z.toFixed(2)} m`],
            ["Linear speed", `${speed.toFixed(2)} m/s`],
            ["Angular Z", `${twist.angular.z.toFixed(2)} rad/s`],
            ["Frame", value.child_frame_id || "—"],
          ].map(([label, reading]) => (
            <div key={label} className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 truncate font-mono text-sm font-semibold">{reading}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PathVisualization({ value }: { value: PathMessage }) {
  const poses = value.poses ?? [];
  const points = poses.map(({ pose }) => ({
    x: pose.position.x,
    y: pose.position.y,
  }));
  const minX = Math.min(...points.map((point) => point.x), 0);
  const maxX = Math.max(...points.map((point) => point.x), 0);
  const minY = Math.min(...points.map((point) => point.y), 0);
  const maxY = Math.max(...points.map((point) => point.y), 0);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const coordinates = points.map((point) => ({
    x: 24 + ((point.x - minX) / spanX) * 552,
    y: 196 - ((point.y - minY) / spanY) * 172,
  }));
  const polyline = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const first = coordinates[0];
  const last = coordinates.at(-1);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Navigation path</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Backend path in the {value.header.frame_id || "map"} frame
          </p>
        </div>
        <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-800">
          {poses.length} poses
        </span>
      </div>
      <div className="p-3">
        {poses.length === 0 ? (
          <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Backend reports no active path.
          </div>
        ) : (
          <svg viewBox="0 0 600 220" className="h-56 w-full rounded-lg bg-slate-950">
            <defs>
              <pattern id="path-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#334155" strokeWidth="0.7" />
              </pattern>
            </defs>
            <rect width="600" height="220" fill="url(#path-grid)" />
            <line x1="24" y1="110" x2="576" y2="110" stroke="#475569" strokeDasharray="3 5" />
            <line x1="300" y1="20" x2="300" y2="196" stroke="#475569" strokeDasharray="3 5" />
            {polyline && (
              <polyline
                points={polyline}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {first && <circle cx={first.x} cy={first.y} r="6" fill="#34d399" />}
            {last && <circle cx={last.x} cy={last.y} r="7" fill="#fb923c" stroke="white" strokeWidth="2" />}
            <text x="16" y="214" fill="#94a3b8" fontSize="10">START</text>
            <text x="540" y="214" fill="#94a3b8" fontSize="10">GOAL</text>
          </svg>
        )}
      </div>
    </section>
  );
}

function DiagnosticsVisualization({ value }: { value: DiagnosticsMessage }) {
  const levelStyles = [
    { name: "OK", color: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
    { name: "Warning", color: "border-amber-200 bg-amber-50 text-amber-900", dot: "bg-amber-500" },
    { name: "Error", color: "border-red-200 bg-red-50 text-red-800", dot: "bg-red-500" },
    { name: "Stale", color: "border-slate-300 bg-slate-100 text-slate-700", dot: "bg-slate-500" },
  ];
  const entries = value.status ?? [];
  const errorCount = entries.filter((entry) => entry.level === 2).length;
  const warningCount = entries.filter((entry) => entry.level === 1).length;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">System health</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Diagnostic status reported by the robot
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{errorCount} errors</span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{warningCount} warnings</span>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No diagnostic entries were reported.</div>
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {entries.map((entry) => {
            const level = levelStyles[entry.level] ?? levelStyles[3];
            return (
              <article key={`${entry.name}-${entry.hardware_id}`} className={`rounded-xl border p-4 ${level.color}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">{entry.name}</h4>
                    <p className="mt-1 text-xs opacity-80">{entry.hardware_id || "No hardware id"}</p>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-[11px] font-medium">
                    <span className={`h-1.5 w-1.5 rounded-full ${level.dot}`} />
                    {level.name}
                  </span>
                </div>
                <p className="mt-3 text-sm">{entry.message}</p>
                {entry.values.length > 0 && (
                  <dl className="mt-3 space-y-1 border-t border-current/10 pt-3">
                    {entry.values.map((item) => (
                      <div key={item.key} className="flex justify-between gap-3 text-xs">
                        <dt className="opacity-70">{item.key}</dt>
                        <dd className="text-right font-medium">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function Telemetry() {
  const { robots, selectedRobotId, selectRobot } = useFleet();
  const storedRobotId = useRobotStore((state) => state.selectedRobotId);
  const robotId = selectedRobotId ?? storedRobotId;
  const [activeTopicId, setActiveTopicId] =
    useState<TelemetryTopic["id"]>("odom");
  const [httpTelemetry, setHttpTelemetry] =
    useState<TelemetryTopicsResponse | null>(null);
  const [httpError, setHttpError] = useState<string | null>(null);
  const [httpUnavailable, setHttpUnavailable] = useState(false);
  const [httpLoading, setHttpLoading] = useState(false);
  const [httpUpdatedAt, setHttpUpdatedAt] = useState<number | null>(null);
  const [individualTopic, setIndividualTopic] = useState("imu");
  const [individualTopicData, setIndividualTopicData] = useState<unknown>(null);
  const [individualTopicError, setIndividualTopicError] = useState<string | null>(null);
  const [individualTopicLoading, setIndividualTopicLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const robotIdRef = useRef(robotId);
  robotIdRef.current = robotId;

  const odom = useRobotStream({ robotId, topic: "odom" });
  const tf = useRobotStream({ robotId, topic: "tf" });
  const map = useRobotStream({ robotId, topic: "map" });
  const diagnostics = useRobotStream({ robotId, topic: "diagnostics" });
  const path = useRobotStream({ robotId, topic: "path" });

  const streamResults = { odom, tf, map, diagnostics, path };
  const selectedTopic =
    topicDefinitions.find((topic) => topic.id === activeTopicId) ??
    topicDefinitions[0];

  const loadHttpTelemetry = useCallback(async () => {
    if (!robotId) return;
    setHttpLoading(true);
    try {
      const result = await getTelemetry(robotId);
      if (robotIdRef.current !== robotId) return;

      setHttpTelemetry(result);
      setHttpUnavailable(result === null);
      setHttpError(null);
      if (result) setHttpUpdatedAt(Date.now());
    } catch (error) {
      if (robotIdRef.current !== robotId) return;
      setHttpError(apiErrorMessage(error));
    } finally {
      if (robotIdRef.current === robotId) setHttpLoading(false);
    }
  }, [robotId]);
  const refreshHttpTelemetry = usePolling(loadHttpTelemetry, {
    intervalMs: 2000,
    enabled: Boolean(robotId),
    key: robotId ?? "no-robot",
  });

  const queryIndividualTopic = async () => {
    if (!robotId || !individualTopic.trim()) return;
    setIndividualTopicLoading(true);
    setIndividualTopicError(null);
    setIndividualTopicData(null);
    try {
      const data = await getSimRobotTelemetryTopic(
        robotId,
        individualTopic.trim(),
      );
      if (data === null) {
        setIndividualTopicError(
          `Topic "${individualTopic.trim()}" is unavailable for ${robotId}.`,
        );
      } else {
        setIndividualTopicData(data);
      }
    } catch (error) {
      setIndividualTopicError(apiErrorMessage(error));
    } finally {
      setIndividualTopicLoading(false);
    }
  };

  useEffect(() => {
    setHttpTelemetry(null);
    setHttpError(null);
    setHttpUnavailable(false);
    setHttpUpdatedAt(null);
  }, [robotId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const streamStatus = Object.fromEntries(
    streamTopics.map((topic) => {
      const result = streamResults[topic];
      const data = getStreamValue(topic, result.data);
      const state: TelemetryState = result.error
        ? "error"
        : data !== null
          ? "receiving"
          : result.lastMessageAt !== null
            ? "unavailable"
            : "connecting";
      return [
        topic,
        {
          state,
          data,
          error: result.error,
          updatedAt: result.lastMessageAt,
        },
      ];
    }),
  ) as Record<
    RobotStreamTopic,
    {
      state: TelemetryState;
      data: unknown;
      error: string | null;
      updatedAt: number | null;
    }
  >;

  const activeStream = streamTopics.includes(
    selectedTopic.id as RobotStreamTopic,
  )
    ? streamStatus[selectedTopic.id as RobotStreamTopic]
    : null;
  const activeHttpData = httpTelemetry?.topics?.[selectedTopic.id] ?? null;
  const activeData = selectedTopic.source === "stream"
    ? activeStream?.data ?? null
    : activeHttpData;
  const activeError = selectedTopic.source === "stream"
    ? activeStream?.error ?? null
    : httpError;
  const activeState: TelemetryState = selectedTopic.source === "stream"
    ? activeStream?.state ?? "connecting"
    : httpError
      ? "error"
      : httpUnavailable
        ? "unavailable"
        : activeHttpData !== null
          ? "receiving"
          : httpTelemetry
            ? "unavailable"
            : "connecting";
  const activeUpdatedAt =
    selectedTopic.source === "stream"
      ? activeStream?.updatedAt ?? null
      : httpUpdatedAt;
  const activePayload = useMemo(
    () => (activeData === null || activeData === undefined ? "" : formatPayload(activeData)),
    [activeData],
  );

  const imageData =
    activeData && typeof activeData === "object" && "data" in activeData
      ? (activeData as { data: unknown }).data
      : null;
  const imageFormat =
    activeData && typeof activeData === "object" && "format" in activeData
      ? String((activeData as { format: unknown }).format)
      : undefined;
  const imageSource = useImageSource(
    selectedTopic.id === "image_compressed" ||
      selectedTopic.id === "depth_image_compressed"
      ? imageData
      : null,
    imageFormat,
  );

  const lastUpdatedLabel = activeUpdatedAt
    ? `${Math.max(0, Math.floor((now - activeUpdatedAt) / 1000))}s ago`
    : "Waiting for first message";

  return (
    <div className="space-y-6 p-6 pb-28">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-700">
            <Activity className="h-4 w-4" />
            Backend telemetry
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Telemetry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live sensor and robot data from the selected robot. Select a topic
            to inspect its payload and verify the frontend connection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="telemetry-robot" className="sr-only">
            Select robot
          </label>
          <select
            id="telemetry-robot"
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
            onClick={() => {
              void refreshHttpTelemetry();
              setNow(Date.now());
            }}
            disabled={!robotId || httpLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${httpLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </header>

      {!robotId && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="h-5 w-5 shrink-0" />
          No robot is available yet. Check the backend connection and refresh
          the fleet list.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold">Available topics</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {topicDefinitions.length} telemetry streams · live connection status
            </p>
          </div>
          <div className="max-h-[680px] overflow-y-auto p-2">
            {topicDefinitions.map((topic) => {
              const isStream = topic.source === "stream";
              const status = isStream
                ? streamStatus[topic.id as RobotStreamTopic].state
                : httpError
                  ? "error"
                  : httpUnavailable
                    ? "unavailable"
                    : httpTelemetry?.topics?.[topic.id] != null
                      ? "receiving"
                      : httpTelemetry
                        ? "unavailable"
                        : "connecting";
              const active = activeTopicId === topic.id;

              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => setActiveTopicId(topic.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    active
                      ? "bg-cyan-50 text-cyan-950 ring-1 ring-cyan-100"
                      : "text-foreground hover:bg-muted/70"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      active
                        ? "bg-white text-cyan-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status === "receiving" ? (
                      <Wifi className="h-4 w-4" />
                    ) : status === "error" ? (
                      <WifiOff className="h-4 w-4" />
                    ) : (
                      <Activity className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {topic.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {topic.id}
                    </span>
                  </span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      status === "receiving"
                        ? "bg-emerald-500"
                        : status === "error"
                          ? "bg-red-500"
                          : status === "unavailable"
                            ? "bg-slate-300"
                            : "animate-pulse bg-amber-400"
                    }`}
                    aria-label={status}
                  />
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {selectedTopic.source === "stream"
                  ? "WebSocket stream"
                  : "Telemetry API"}
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {selectedTopic.label}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedTopic.description}
              </p>
            </div>
            <TopicStatus state={activeState} />
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Robot</p>
                <p className="mt-1 text-sm font-medium">
                  {robotId ?? "Not selected"}
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Data transport</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  {activeState === "receiving" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  )}
                  {selectedTopic.source === "stream" ? "WebSocket" : "HTTP polling"}
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Last message</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  {lastUpdatedLabel}
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Robot connection</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  {httpTelemetry?.connected ? (
                    <Wifi className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  {httpTelemetry
                    ? httpTelemetry.connected
                      ? "Connected"
                      : "Offline"
                    : "Unknown"}
                </p>
              </div>
            </div>

            {activeError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{activeError}</span>
              </div>
            )}
            {httpUnavailable && selectedTopic.source === "http" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                This backend does not expose the fake-backend telemetry endpoint
                for this topic.
              </div>
            )}

            {selectedTopic.id === "point_cloud" && activeData ? (
              <div className="h-[380px] overflow-hidden rounded-xl bg-slate-950">
                <PointCloudViewer
                  msg={activeData as PointCloud2Msg}
                  pointSize={0.05}
                />
              </div>
            ) : selectedTopic.id === "imu" && activeData ? (
              <ImuVisualization value={activeData} />
            ) : selectedTopic.id === "odom" && activeData ? (
              <OdomVisualization value={activeData as OdomMessage} />
            ) : selectedTopic.id === "path" && activeData ? (
              <PathVisualization value={activeData as PathMessage} />
            ) : selectedTopic.id === "diagnostics" && activeData ? (
              <DiagnosticsVisualization
                value={activeData as DiagnosticsMessage}
              />
            ) : selectedTopic.id === "map" && activeData ? (
              <section className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">Occupancy grid</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {((activeData as OccupancyGridMessage).info.width)} ×{" "}
                    {(activeData as OccupancyGridMessage).info.height} cells ·{" "}
                    {(activeData as OccupancyGridMessage).info.resolution} m/cell
                  </p>
                </div>
                <div className="flex justify-center bg-slate-950 p-3">
                  <OccupancyGridViewer
                    map={activeData as OccupancyGridMessage}
                    width={760}
                    height={420}
                  />
                </div>
              </section>
            ) : selectedTopic.id === "tf" && activeData ? (
              <div className="h-[380px] overflow-hidden rounded-xl bg-slate-950">
                <TFViewer tf={activeData as TfMessage} axisSize={0.25} />
              </div>
            ) : (selectedTopic.id === "image_compressed" ||
                  selectedTopic.id === "depth_image_compressed") &&
              imageSource ? (
              <div className="overflow-hidden rounded-xl border border-border bg-slate-950 p-2">
                <img
                  src={imageSource}
                  alt={selectedTopic.label}
                  className="mx-auto max-h-[420px] max-w-full object-contain"
                />
              </div>
            ) : null}

            {activeData !== null && activeData !== undefined ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Backend payload</h3>
                  <span className="text-xs text-muted-foreground">
                    Refreshed automatically every 2 seconds
                  </span>
                </div>
                <pre className="max-h-[420px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                  <code>{activePayload}</code>
                </pre>
                {activePayload.length >= 12000 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Payload preview is abbreviated to keep the page responsive.
                  </p>
                )}
              </div>
            ) : (
              !activeError &&
              !httpUnavailable && (
                <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                  Waiting for telemetry from the backend…
                </div>
              )
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4">
          <h2 className="font-semibold">Query an individual topic</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Call the simulator&apos;s{" "}
            <code>GET /sim/robots/{"{id}"}/telemetry/{"{topic}"}</code> endpoint
            directly, including topics outside the standard list.
          </p>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void queryIndividualTopic();
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor="individual-telemetry-topic" className="mb-2 block text-sm font-medium">
              Topic name
            </label>
            <input
              id="individual-telemetry-topic"
              value={individualTopic}
              onChange={(event) => setIndividualTopic(event.target.value)}
              placeholder="battery_state"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" disabled={!robotId || individualTopicLoading}>
            {individualTopicLoading ? "Querying…" : "Query topic"}
          </Button>
        </form>
        {individualTopicError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {individualTopicError}
          </p>
        )}
        {individualTopicData !== null && (
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-muted/60 p-4 text-xs">
            {formatPayload(individualTopicData)}
          </pre>
        )}
      </section>
    </div>
  );
}
