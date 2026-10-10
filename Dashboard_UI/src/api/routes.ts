import axios, { AxiosError, type AxiosRequestConfig } from "axios";

import { API_BASE_URL, ENDPOINTS, parseConnectionMessage } from "./config";
import { decodeWaypoints } from "./decoders";
import { useAuthStore } from "../store/authStore";
import type {
  LoginRequest,
  LoginResponse,
  CreateUserRequest,
  OfferRequest,
  OfferResponse,
  RecordingStatusResponse,
  RobotConnectionStatus,
  RobotConnectionStatusResponse,
  RobotId,
  RobotSummary,
  SaveWaypointRequest,
  SimConfigResponse,
  SimRobotState,
  SimHealthResponse,
  SimWorldResponse,
  StreamStatusResponse,
  TelemetryTopicsResponse,
  TriggerResponse,
  Waypoint,
} from "./types";

/**
 * Shared axios instance.
 *
 * Response handling stays at the request boundary so Axios's generic response
 * type continues to describe the decoded payload accurately.
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;

  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  undefined,
  (error: AxiosError<{ detail?: string }>) => {
    const status = error.response?.status;

    console.error(
      "[api]",
      error.config?.method?.toUpperCase(),
      error.config?.url,
      status ?? error.message,
    );

    if (status === 401) {
      useAuthStore.getState().logout();

      // Guard against a redirect loop when the login page itself 401s.
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  },
);

/** Human-readable message from an axios failure, for display in the UI. */
export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData: unknown = error.response?.data;
    const detail =
      typeof responseData === "object" &&
      responseData !== null &&
      "detail" in responseData
        ? responseData.detail
        : undefined;

    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      // FastAPI validation errors: [{loc, msg, type}, ...]
      return detail
        .map((item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          "msg" in item &&
          typeof item.msg === "string"
            ? item.msg
            : "Invalid value",
        )
        .join("; ");
    }

    if (error.code === "ECONNABORTED") {
      return "The backend did not respond in time.";
    }
    if (!error.response) {
      return `Cannot reach the backend at ${API_BASE_URL}. Is it running?`;
    }
    return `Request failed with status ${error.response.status}.`;
  }

  return error instanceof Error ? error.message : "Unknown error";
}

function request<T>(config: AxiosRequestConfig): Promise<T> {
  return api.request<T>(config).then((response) => response.data);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export function login(credentials: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>({
    url: ENDPOINTS.login,
    method: "POST",
    data: credentials,
  });
}

export function createUser(
  user: CreateUserRequest,
): Promise<{ message: string }> {
  return request({
    url: ENDPOINTS.createUser,
    method: "POST",
    data: user,
  });
}

// ─── Fleet / connection ──────────────────────────────────────────────────────

export function getRobotList(): Promise<RobotSummary[]> {
  return request<RobotSummary[]>({ url: ENDPOINTS.robotList, method: "GET" });
}

/**
 * `GET /connection/{robot_id}/status` returns only a display string, so the
 * boolean is derived from it. The streaming WebSocket is the authoritative
 * source for live connection state; this is a cheap fallback for pages that
 * are not streaming.
 */
export async function getRobotConnectionStatus(
  robotId: RobotId,
): Promise<RobotConnectionStatus> {
  const data = await request<RobotConnectionStatusResponse>({
    url: ENDPOINTS.robotStatus(robotId),
    method: "GET",
  });

  const message = data?.message ?? "";

  return {
    robotId,
    connected: parseConnectionMessage(message),
    message,
  };
}

/**
 * Connect a robot over its rosbridge WebSocket.
 *
 * `host`/`port` are intentionally optional and omitted when not supplied: the
 * backend's `Robot.connect()` falls back to its own stored address, and sending
 * the endpoint's 0.0.0.0 default would override the robot's configured IP.
 */
export function connectRobot(
  robotId: RobotId,
  host?: string,
  port?: number,
): Promise<{ message: string }> {
  const data: { host?: string; port?: number } = {};
  if (host) data.host = host;
  if (port !== undefined) data.port = port;

  return request<{ message: string }>({
    url: ENDPOINTS.robotConnection(robotId, "connect"),
    method: "POST",
    data,
  });
}

export function disconnectRobot(
  robotId: RobotId,
): Promise<{ message: string }> {
  return request<{ message: string }>({
    url: ENDPOINTS.robotConnection(robotId, "disconnect"),
    method: "POST",
  });
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

export function startMapping(robotId: RobotId): Promise<TriggerResponse> {
  return request({ url: ENDPOINTS.mapping.start(robotId), method: "POST" });
}

export interface StopMappingOptions {
  map_name?: string;
  save_visual_slam_map?: boolean;
  overwrite_visual_slam_map_folder?: boolean;
}

export function stopMapping(
  robotId: RobotId,
  options: StopMappingOptions = {},
): Promise<TriggerResponse> {
  const {
    map_name = "latest",
    save_visual_slam_map = true,
    overwrite_visual_slam_map_folder = true,
  } = options;

  return request({
    url: ENDPOINTS.mapping.stop(robotId),
    method: "POST",
    data: { map_name, save_visual_slam_map, overwrite_visual_slam_map_folder },
  });
}

/**
 * NOTE: the backend currently returns a hardcoded `{"message": "mapping
 * deleted"}` without deleting anything (backend/routers/mapping.py). This
 * wrapper reflects the real endpoint; it is not a working delete.
 */
export function saveLocation(robotId: RobotId): Promise<TriggerResponse> {
  return request({
    url: ENDPOINTS.mapping.saveLocation(robotId),
    method: "POST",
  });
}

// ─── Navigation ──────────────────────────────────────────────────────────────

export function startNavigation(robotId: RobotId): Promise<TriggerResponse> {
  return request({ url: ENDPOINTS.navigation.start(robotId), method: "POST" });
}

export interface StartNavigationWithMapOptions {
  map_name?: string;
  localize_after_load?: boolean;
  localize_failure_is_fatal?: boolean;
  pose_hint_position_xyz?: [number, number, number];
  pose_hint_orientation_xyzw?: [number, number, number, number];
}

export function startNavigationWithMap(
  robotId: RobotId,
  options: StartNavigationWithMapOptions = {},
): Promise<TriggerResponse> {
  const {
    map_name = "latest",
    localize_after_load = true,
    localize_failure_is_fatal = true,
    pose_hint_position_xyz = [0, 0, 0],
    pose_hint_orientation_xyzw = [0, 0, 0, 1],
  } = options;

  return request({
    url: ENDPOINTS.navigation.startWithMap(robotId),
    method: "POST",
    data: {
      map_name,
      localize_after_load,
      localize_failure_is_fatal,
      pose_hint_position_xyz,
      pose_hint_orientation_xyzw,
    },
  });
}

export function stopNavigation(robotId: RobotId): Promise<TriggerResponse> {
  return request({ url: ENDPOINTS.navigation.stop(robotId), method: "POST" });
}

export function startExploring(robotId: RobotId): Promise<TriggerResponse> {
  return request({
    url: ENDPOINTS.navigation.exploringStart(robotId),
    method: "POST",
  });
}

export function stopExploring(robotId: RobotId): Promise<TriggerResponse> {
  return request({
    url: ENDPOINTS.navigation.exploringStop(robotId),
    method: "POST",
  });
}

/** Publishes a Bool on the emergency_stop topic. Unauthenticated server-side. */
export function emergencyStop(
  robotId: RobotId,
  state: "activate" | "deactivate",
): Promise<TriggerResponse> {
  return request({
    url: ENDPOINTS.navigation.emergencyStop(robotId, state),
    method: "POST",
  });
}

// ─── Recording ───────────────────────────────────────────────────────────────

/**
 * The backend declares `rosbag_name: str = Body(...)`, so the JSON body must be
 * a bare string — hence JSON.stringify rather than an object.
 */
export function startRecording(
  robotId: RobotId,
  rosbagName = "latest",
): Promise<TriggerResponse> {
  return request({
    url: ENDPOINTS.recording.start(robotId),
    method: "POST",
    data: JSON.stringify(rosbagName),
    headers: { "Content-Type": "application/json" },
  });
}

export function stopRecording(robotId: RobotId): Promise<TriggerResponse> {
  return request({ url: ENDPOINTS.recording.stop(robotId), method: "POST" });
}

export function recordingStatus(
  robotId: RobotId,
): Promise<RecordingStatusResponse> {
  return request({ url: ENDPOINTS.recording.status(robotId), method: "POST" });
}

export function deleteRecording(
  robotId: RobotId,
  rosbagName: string,
): Promise<TriggerResponse> {
  return request({
    url: ENDPOINTS.recording.remove(robotId, rosbagName),
    method: "DELETE",
  });
}

// ─── WebRTC signalling ───────────────────────────────────────────────────────

export function offerClient(offer: OfferRequest): Promise<OfferResponse> {
  return request({
    url: ENDPOINTS.streaming.offerClient,
    method: "POST",
    data: offer,
  });
}

export function offerBrowser(offer: OfferRequest): Promise<OfferResponse> {
  return request({
    url: ENDPOINTS.streaming.offerBrowser,
    method: "POST",
    data: offer,
  });
}

export function streamStatus(): Promise<StreamStatusResponse> {
  return request({ url: ENDPOINTS.streaming.status, method: "GET" });
}

/** Fetch the backend-hosted standalone WebRTC test viewer HTML. */
export function getStreamingViewerHtml(): Promise<string> {
  return request({
    url: ENDPOINTS.streaming.viewer,
    method: "GET",
    responseType: "text",
  });
}

// ─── Robot state / telemetry (fake backend helper API) ───────────────────────
//
// The production robot backend has no equivalent: it exposes no REST telemetry
// at all. Every helper below therefore treats a 404 as "this backend does not
// serve that" and returns null/[] instead of throwing, so a page still renders
// against the real backend — it just shows less.

function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/**
 * Full simulated state for one robot: pose, velocity, task, goal, remaining
 * distance, plan, battery, map stats and the rosbag registry.
 *
 * This is the only source of battery/plan/task data on the fake backend and the
 * cheapest way to poll it (one small request, ~5 kB).
 */
export async function getRobotState(
  robotId: RobotId,
): Promise<SimRobotState | null> {
  try {
    return await request<SimRobotState>({
      url: ENDPOINTS.sim.robot(robotId),
      method: "GET",
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Simulation engine health and a current snapshot of every simulated robot. */
export async function getSimHealth(): Promise<SimHealthResponse | null> {
  try {
    return await request<SimHealthResponse>({
      url: ENDPOINTS.sim.health,
      method: "GET",
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** All simulated robot snapshots from the simulator collection endpoint. */
export async function getSimRobots(): Promise<SimRobotState[] | null> {
  try {
    return await request<SimRobotState[]>({
      url: ENDPOINTS.sim.robots,
      method: "GET",
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Effective fake-backend runtime configuration (the endpoint omits secrets). */
export async function getSimConfig(): Promise<SimConfigResponse | null> {
  try {
    return await request<SimConfigResponse>({
      url: ENDPOINTS.sim.config,
      method: "GET",
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Ground-truth map and world waypoints for a simulated robot. */
export async function getSimWorld(
  robotId: RobotId,
  signal?: AbortSignal,
): Promise<SimWorldResponse | null> {
  try {
    return await request<SimWorldResponse>({
      url: ENDPOINTS.sim.world(robotId),
      method: "GET",
      signal,
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Named waypoints, or null when the backend does not expose this helper route. */
export async function getWaypoints(): Promise<Waypoint[] | null> {
  try {
    const data = await request<unknown>({
      url: ENDPOINTS.sim.waypoints,
      method: "GET",
    });
    return decodeWaypoints(data);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function saveWaypoint(
  waypoint: SaveWaypointRequest,
): Promise<Waypoint> {
  return request<Waypoint>({
    url: ENDPOINTS.sim.waypoints,
    method: "POST",
    data: { yaw: 0, ...waypoint },
  });
}

export async function deleteWaypoint(
  name: string,
): Promise<{ message: string }> {
  return request<{ message: string }>({
    url: ENDPOINTS.sim.waypoint(name),
    method: "DELETE",
  });
}

/**
 * Read-only access to a topic no WebSocket serves (battery_state, imu, …).
 * Returns null when the backend has no such route or the topic is unknown.
 */
export async function getTelemetryTopic(
  robotId: RobotId,
  topic: string,
): Promise<unknown | null> {
  try {
    const data = await request<{ message: unknown }>({
      url: ENDPOINTS.sim.telemetryTopic(robotId, topic),
      method: "GET",
    });
    return data?.message ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Read one topic through the simulator-specific telemetry helper endpoint. */
export async function getSimRobotTelemetryTopic(
  robotId: RobotId,
  topic: string,
): Promise<unknown | null> {
  try {
    const data = await request<{ message: unknown }>({
      url: ENDPOINTS.sim.robotTelemetryTopic(robotId, topic),
      method: "GET",
    });
    return data?.message ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Every on-demand topic for a robot in one request (battery, imu, …). */
export async function getTelemetry(
  robotId: RobotId,
): Promise<TelemetryTopicsResponse | null> {
  try {
    return await request<TelemetryTopicsResponse>({
      url: ENDPOINTS.sim.telemetry(robotId),
      method: "GET",
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

// ─── Goal / pose publishing ──────────────────────────────────────────────────

/** Quaternion for a rotation about Z, i.e. a planar yaw. */
function yawToQuaternion(yaw: number) {
  return {
    x: 0,
    y: 0,
    z: Math.sin(yaw / 2),
    w: Math.cos(yaw / 2),
  };
}

/**
 * Send a navigation goal.
 *
 * Navigation goals are not a REST resource on the backend: the robot listens on
 * the `goal_pose` topic (`geometry_msgs/PoseStamped`), which is in both robots'
 * publishable topic enums. Publishing it is what a real integration does, and
 * the fake backend routes it to the same `set_goal` the `/sim` shortcut uses.
 *
 * On a backend without the publish route this rejects; callers should surface
 * the error rather than pretend the goal was accepted.
 */
export function publishGoal(
  robotId: RobotId,
  x: number,
  y: number,
  yaw = 0,
): Promise<{ status?: string; topic?: string }> {
  return request({
    url: ENDPOINTS.sim.publish(robotId),
    method: "POST",
    data: {
      topic: "goal_pose",
      message: {
        header: { frame_id: "map", stamp: { secs: 0, nsecs: 0 } },
        pose: {
          position: { x, y, z: 0 },
          orientation: yawToQuaternion(yaw),
        },
      },
    },
  });
}

/**
 * Re-localise the robot: publishes `initialpose`
 * (`geometry_msgs/PoseWithCovarianceStamped`) on the robot's own topic, exactly
 * as RViz's "2D Pose Estimate" tool does.
 */
export function publishInitialPose(
  robotId: RobotId,
  x: number,
  y: number,
  yaw = 0,
): Promise<{ status?: string; topic?: string }> {
  const covariance = new Array<number>(36).fill(0);
  covariance[0] = 0.25;
  covariance[7] = 0.25;
  covariance[35] = 0.0685;

  return request({
    url: ENDPOINTS.sim.publish(robotId),
    method: "POST",
    data: {
      topic: "initialpose",
      message: {
        header: { frame_id: "map", stamp: { secs: 0, nsecs: 0 } },
        pose: {
          pose: {
            position: { x, y, z: 0 },
            orientation: yawToQuaternion(yaw),
          },
          covariance,
        },
      },
    },
  });
}

/** Materialise the whole world into the SLAM map (test/demo helper). */
export function revealMap(robotId: RobotId): Promise<{ mapped_ratio: number }> {
  return request({
    url: ENDPOINTS.sim.revealMap(robotId),
    method: "POST",
  });
}

/** Set a navigation goal through the simulator's direct helper endpoint. */
export function setSimGoal(
  robotId: RobotId,
  goal: { x: number; y: number; yaw: number },
): Promise<{
  message: string;
  robot_id: RobotId;
  goal: { x: number; y: number; yaw: number };
  connected: boolean;
}> {
  return request({
    url: ENDPOINTS.sim.goal(robotId),
    method: "POST",
    data: goal,
  });
}

/** Publish a custom message on a topic supported by the selected fake robot. */
export function publishSimMessage(
  robotId: RobotId,
  topic: string,
  message: Record<string, unknown>,
): Promise<unknown> {
  return request({
    url: ENDPOINTS.sim.publish(robotId),
    method: "POST",
    data: { topic, message },
  });
}

/** Configure simulated rosbridge hosts that should refuse connections. */
export function setUnreachableHosts(
  hosts: string[],
): Promise<{ unreachable_hosts: string[] }> {
  return request({
    url: ENDPOINTS.sim.unreachableHosts,
    method: "POST",
    data: { hosts },
  });
}

/** Set a fake robot battery percentage for low-battery UI testing. */
export function setSimBattery(
  robotId: RobotId,
  percentage: number,
): Promise<{ message: string; percentage: number }> {
  return request({
    url: ENDPOINTS.sim.battery(robotId),
    method: "POST",
    data: { percentage },
  });
}

/** Inject a fake-backend fault: disconnect, estop, or clear. */
export function setSimFault(
  robotId: RobotId,
  kind: "disconnect" | "estop" | "clear",
): Promise<{ message: string; status: string }> {
  return request({
    url: ENDPOINTS.sim.fault(robotId),
    method: "POST",
    data: { kind },
  });
}

/** Move the simulated robot to a chosen world pose. */
export function teleportSimRobot(
  robotId: RobotId,
  pose: { x: number; y: number; yaw: number },
): Promise<{ message: string; pose: { x: number; y: number; yaw: number } }> {
  return request({
    url: ENDPOINTS.sim.teleport(robotId),
    method: "POST",
    data: pose,
  });
}

/**
 * Reset the simulation for one robot (pose, map, plan, rosbags, battery).
 * Test/demo helper — the production backend has nothing like it.
 */
export function resetSimulation(
  robotId: RobotId | null,
): Promise<{ message: string; robot_id: string | null }> {
  return request({
    url: ENDPOINTS.sim.reset,
    method: "POST",
    ...(robotId ? { params: { robot_id: robotId } } : {}),
  });
}

/**
 * `DELETE /mapping/{robot_id}/delete` takes `map_name` as a **body** parameter,
 * which axios only sends for DELETE when it is passed as `data`.
 */
export function deleteMap(
  robotId: RobotId,
  mapName: string,
): Promise<{ message: string }> {
  return request({
    url: ENDPOINTS.mapping.delete(robotId),
    method: "DELETE",
    data: { map_name: mapName },
  });
}

/**
 * Stop mapping and save the current SLAM map under `mapName`. Returns the
 * service response so callers can report whether the map was really saved.
 */
export function saveMap(
  robotId: RobotId,
  mapName: string,
): Promise<TriggerResponse> {
  return stopMapping(robotId, { map_name: mapName });
}
