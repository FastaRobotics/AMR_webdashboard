/**
 * Types mirroring the FastAPI backend contract in `backend/`.
 *
 * These describe what the backend ACTUALLY returns, not what the UI wishes it
 * returned. Where the backend has no endpoint for something, no type exists
 * here — see the notes in `routes.ts`.
 */

// ─── Robots ──────────────────────────────────────────────────────────────────

/**
 * Robot ids are validated server-side by the `Robots` enum in
 * backend/routers/connection.py. The backend currently defines `amr_1` and
 * `go2_1`; treat the list from `getRobotList()` as the source of truth rather
 * than hardcoding either value.
 */
export type RobotId = string;

/** backend: `list[{"id": str, "type": class name}]` */
export interface RobotSummary {
  id: RobotId;
  /** Python class name of the robot implementation, e.g. "AMR" / "Go2". */
  type: string;
}

/** backend: RobotStatus in backend/robot.py */
export type RobotStatus = "offline" | "idle" | "run_task";

/**
 * backend: `GET /connection/{robot_id}/status` returns
 * `{"message": "Connection status for amr_1: Connected"}` — a human string,
 * not a boolean. The boolean is only available over the streaming WebSocket.
 */
export interface RobotConnectionStatusResponse {
  message: string;
}

/** Strict variant used by pages that need an unambiguous boolean. */
export interface RobotConnectionStatus {
  robotId: RobotId;
  connected: boolean;
  message: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  user_name: string;
  password: string;
}

export interface CreateUserRequest {
  first_name: string;
  last_name: string;
  email: string;
  user_name: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

// ─── ROS message payloads (streamed over WebSocket) ──────────────────────────

export interface RosTime {
  secs: number;
  nsecs: number;
}

export interface RosHeader {
  seq?: number;
  stamp: RosTime;
  frame_id: string;
}

export interface RosVector3 {
  x: number;
  y: number;
  z: number;
}

export interface RosQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface RosPoint {
  x: number;
  y: number;
  z: number;
}

export interface RosPose {
  position: RosPoint;
  orientation: RosQuaternion;
}

/** ROS: nav_msgs/msg/Odometry */
export interface OdomMessage {
  header: RosHeader;
  child_frame_id: string;
  pose: { pose: RosPose; covariance: number[] };
  twist: {
    twist: { linear: RosVector3; angular: RosVector3 };
    covariance: number[];
  };
}

/** ROS: nav_msgs/msg/OccupancyGrid */
export interface OccupancyGridMessage {
  header: RosHeader;
  info: {
    map_load_time: RosTime;
    resolution: number;
    width: number;
    height: number;
    origin: RosPose;
  };
  /** -1 unknown, 0 free, 100 occupied. Length is width * height. */
  data: number[];
}

export interface TransformStamped {
  header: RosHeader;
  child_frame_id: string;
  transform: { translation: RosVector3; rotation: RosQuaternion };
}

/** ROS: tf2_msgs/msg/TFMessage */
export interface TfMessage {
  transforms: TransformStamped[];
}

/** ROS: diagnostic_msgs/msg/DiagnosticArray */
export type DiagnosticLevel = 0 | 1 | 2 | 3;

export interface DiagnosticKeyValue {
  key: string;
  value: string;
}

export interface DiagnosticStatus {
  level: DiagnosticLevel;
  name: string;
  message: string;
  hardware_id: string;
  values: DiagnosticKeyValue[];
}

export interface DiagnosticsMessage {
  header: RosHeader;
  status: DiagnosticStatus[];
}

export interface PoseStamped {
  header: RosHeader;
  pose: RosPose;
}

/** ROS: nav_msgs/msg/Path */
export interface PathMessage {
  header: RosHeader;
  poses: PoseStamped[];
}

// ─── Streaming WebSocket envelope ────────────────────────────────────────────

/** Topics the backend actually exposes in backend/routers/streaming_ws.py. */
export type RobotStreamTopic = "map" | "odom" | "tf" | "diagnostics" | "path";

export interface RobotStreamMessage {
  robot_id: RobotId;
  /** From RobotStatus in backend/robot.py. */
  status: RobotStatus;
  /** All payload fields are optional; null until ROS delivers the first message. */
  map?: OccupancyGridMessage | null;
  odom?: OdomMessage | null;
  tf?: TfMessage | null;
  diagnostics?: DiagnosticsMessage | null;
  path?: PathMessage | null;
}

/** The backend sends `{"error": "..."}` then closes when the robot is offline. */
export interface RobotStreamError {
  error: string;
}

export type RobotStreamPayload = RobotStreamMessage | RobotStreamError;

export function isStreamError(payload: unknown): payload is RobotStreamError {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRobotStreamMessage(
  payload: unknown,
  topic: RobotStreamTopic,
): payload is RobotStreamMessage {
  if (!isObject(payload)) return false;
  if (
    typeof payload.robot_id !== "string" ||
    !["offline", "idle", "run_task"].includes(String(payload.status))
  ) {
    return false;
  }

  if (!(topic in payload)) return false;
  const message = payload[topic];
  if (message === null) return true;
  if (!isObject(message)) return false;

  if (topic === "map") {
    return (
      isObject(message.info) &&
      Array.isArray(message.data) &&
      typeof message.info.width === "number" &&
      typeof message.info.height === "number"
    );
  }
  if (topic === "odom") {
    return isObject(message.pose) && isObject(message.twist);
  }
  if (topic === "tf") return Array.isArray(message.transforms);
  if (topic === "path") return Array.isArray(message.poses);
  return Array.isArray(message.status);
}

// ─── Control WebSocket ───────────────────────────────────────────────────────

/** Matches the parsing in backend/routers/control.py. */
export interface TwistCommand {
  linear: number;
  angular: number;
}

export interface TwistSocketMessage {
  type: "twist";
  data: TwistCommand;
}

export interface TwistSocketAck {
  status: "ok";
  type: string;
}

export interface TwistSocketError {
  error: string;
}

// ─── Recording ───────────────────────────────────────────────────────────────

/**
 * backend: `Robot.recording_status()` returns the raw service response
 * (std_srvs/srv/Trigger shaped: success/message). The backend then rewrites
 * `message` with `.split(" ")[0]`, so most of the payload is best treated as
 * unknown. `RecordingStatusResponse` below models the fields the dashboard
 * actually reads.
 */
export type RecordingServiceResponse = Record<string, unknown>;

export interface TriggerResponse {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
}

// ─── Streaming / WebRTC ──────────────────────────────────────────────────────

export interface OfferRequest {
  sdp: string;
  type: string;
}

export interface OfferResponse {
  sdp: string;
  type: string;
  track_count?: number;
}

export interface StreamStatusResponse {
  client_connected: boolean;
  source_tracks: number;
  total_pcs: number;
}

// ─── Extra read-only routes (fake backend only) ──────────────────────────────
//
// The production robot backend exposes no telemetry or waypoint endpoint, so
// these types describe the fake backend's helper surface. Callers must tolerate
// a 404 (endpoint absent) and fall back to derived values.

/** `GET /sim/robots/{robot_id}` — the full simulated robot state. */
export interface SimRobotState {
  robot_id: RobotId;
  kind: string;
  status: RobotStatus;
  /** "mapping" | "exploring" | "navigation" | null */
  task: string | null;
  pose: { x: number; y: number; yaw: number };
  velocity: { linear_x: number; angular_z: number };
  goal: [number, number, number] | null;
  goal_text: string;
  distance_remaining_m: number;
  plan_points: number;
  plan_index: number;
  /** Planned path in world metres, `[x, y]` pairs. */
  plan: [number, number][];
  exploring_complete: boolean;
  last_navigation_result: string;
  emergency_stopped: boolean;
  battery: {
    percentage: number;
    voltage: number;
    current: number;
    temperature: number;
  };
  map: {
    active: boolean;
    topic_available: boolean;
    loaded_map: string | null;
    revision: number;
    mapped_ratio: number;
    loop_closures: number;
    size: [number, number];
    resolution: number;
  };
  recording: {
    active: boolean;
    rosbag_name: string | null;
    rosbags: string[];
  };
  saved_maps: string[];
  capabilities: {
    mapping: boolean;
    map_topic: boolean;
    path_topic: boolean;
    diagnostics_topic: boolean;
  };
  hardware: {
    cpu_load: number;
    cpu_temperature: number;
    motor_temperature: number;
    left_encoder: number;
    right_encoder: number;
    webrtc_peers: number;
  };
  sim_time: number;
  /** Only present on `GET /sim/robots/{robot_id}` (not on `/sim/health`). */
  connected?: boolean;
  /** `{host, port}` the robot is connected through, when connected. */
  connection_address?: { host: string; port: number } | null;
  subscriptions?: number;
}

/** `GET /sim/health` — simulation engine health plus each robot snapshot. */
export interface SimHealthResponse {
  running: boolean;
  ticks: number;
  tick_hz: number;
  uptime_s: number;
  connected: RobotId[];
  robots: Record<RobotId, SimRobotState>;
  world: {
    width: number;
    height: number;
    resolution: number;
    origin: [number, number];
  };
  stream_topics: Record<string, number>;
  on_demand_topics: string[];
  subscribers: Record<string, number>;
  webrtc_available: boolean;
}

/** `GET /sim/robots/{robot_id}/world` — ground-truth occupancy grid. */
export interface SimWorldResponse {
  resolution: number;
  width: number;
  height: number;
  origin: [number, number];
  cells: number[];
  waypoints: Record<string, [number, number, number]>;
}

/** Public, non-secret fields from `GET /sim/config`. */
export interface SimConfigResponse {
  host: string;
  port: number;
  token_expire_minutes: number;
  db_path: string;
  robots: Record<string, { kind: string; host: string; port: number }>;
  connect_latency_ms: number;
  service_latency_ms: number;
  unreachable_hosts: string[];
  tick_hz: number;
  map_resolution: number;
  world_width_m: number;
  world_height_m: number;
  sensor_range_m: number;
  lidar_rays: number;
  frontier_min_leg_m: number;
  cmd_vel_timeout_s: number;
  battery_start: number;
  battery_drain_per_min: number;
  max_linear_speed: number;
  max_angular_speed: number;
  start_pose: [number, number, number];
  default_goal_name: string;
  enable_sim_api: boolean;
  seed_users: string[];
}

/** One named waypoint from `GET /sim/waypoints`. */
export interface Waypoint {
  name: string;
  x: number;
  y: number;
  yaw: number;
  /** "world" for the layout's own waypoints, "dashboard" for saved ones. */
  source: string;
  saved_at?: number;
}

export interface SaveWaypointRequest {
  name: string;
  x: number;
  y: number;
  yaw?: number;
}

/** One rosbag entry from `POST /recording/{robot_id}/status`. */
export interface RosbagInfo {
  name: string;
  size_bytes: number;
  duration_s: number;
  created_at?: number;
}

/**
 * The fake backend answers `/recording/{robot_id}/status` with the service
 * message plus structured fields; the production backend truncates the message
 * to one word and adds nothing. Both are handled by treating every extra field
 * as optional.
 */
export interface RecordingStatusResponse {
  success?: boolean;
  message?: string;
  recording?: boolean;
  rosbag_name?: string | null;
  duration_s?: number;
  rosbags?: RosbagInfo[];
}

/** One topic from `GET /telemetry/{robot_id}`. */
export interface BatteryStateMessage {
  voltage: number;
  temperature: number;
  current: number;
  charge: number;
  capacity: number;
  percentage: number;
  power_supply_status: number;
  power_supply_health: number;
  present: boolean;
  cell_voltage: number[];
  cell_temperature: number[];
  location: string;
  serial_number: string;
}

export interface TelemetryTopicsResponse {
  robot_id: RobotId;
  generated_at: number;
  connected: boolean;
  status: string;
  topics: Record<string, unknown>;
}
