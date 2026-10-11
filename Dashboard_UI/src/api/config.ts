/**
 * Central connection configuration for the Fasta dashboard.
 *
 * Every network call in the UI — REST and WebSocket — must resolve its
 * origin from this module. Nothing else should read `import.meta.env`
 * for a backend address, and nothing should hardcode a host or port.
 *
 * Environment variables (see .env):
 *   VITE_BACKEND_URL    REST origin, e.g. http://localhost:8000. The streaming
 *                       and control WebSockets are derived from it, so one
 *                       variable points the whole dashboard at a robot backend.
 */

const DEFAULT_BACKEND_URL = "http://localhost:8000";

/** Strip any scheme and trailing slashes, leaving `host:port[/path]`. */
function stripScheme(value: string): string {
  return value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
}

/**
 * True when the page is being served from the Vite dev server. Read from the
 * location rather than `import.meta.env.DEV` so the check behaves identically
 * when this module is imported by a build tool that does not define it.
 */
export const IN_DEV_SERVER =
  typeof window !== "undefined" && window.location.port === "5173";

/**
 * Absolute HTTP origin of the backend API. Always includes a scheme so it can
 * be handed to axios or `new URL()`.
 */
export const API_BASE_URL: string = (() => {
  const raw =
    (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() ||
    DEFAULT_BACKEND_URL;

  return raw.replace(/\/+$/, "");
})();

/**
 * The API origin without a scheme, e.g. `localhost:8000`.
 * Kept for callers that build their own `ws://`/`wss://` prefixes.
 */
export const API_HOST: string = stripScheme(API_BASE_URL);

/**
 * Warn loudly when credentials would travel in cleartext to a non-local host:
 * the login request sends a password and every later request sends the JWT.
 */
if (
  typeof window !== "undefined" &&
  API_BASE_URL.startsWith("http://") &&
  !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(API_BASE_URL)
) {
  console.warn(
    `[config] VITE_BACKEND_URL is plain HTTP (${API_BASE_URL}). ` +
      "Credentials and tokens will be sent unencrypted. Use https:// for any non-local backend.",
  );
}

/**
 * Build an absolute WebSocket URL for the backend.
 *
 * `ws:`/`wss:` is derived from the REST origin's scheme, so switching
 * VITE_BACKEND_URL to an https origin automatically upgrades the sockets to
 * wss — which is what a browser requires from an https page.
 *
 * @param path Path starting with `/`, e.g. `/streaming_socket/amr_1/...`
 */
export function socketUrl(path: string): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  const origin = API_BASE_URL.replace(/^http:/i, "ws:").replace(
    /^https:/i,
    "wss:",
  );
  return `${origin}${normalised}`;
}

/**
 * The backend's connection-status endpoint returns only a display string:
 * `"Connection status for amr_1: Connected"`.
 *
 * The trailing `\b` matters — without it, "Disconnected" also matches
 * "Connected" and every offline robot would read as online.
 */
export function parseConnectionMessage(
  message: string | undefined | null,
): boolean {
  return /:\s*Connected\b/i.test(message ?? "");
}

/**
 * Endpoints the backend actually exposes. Grouped so a route rename is a
 * one-line change here rather than a search across pages.
 */
export const ENDPOINTS = {
  login: "/user/login",
  createUser: "/user/create",
  robotList: "/connection/robot_list",
  robotStatus: (robotId: string) => `/connection/${robotId}/status`,
  robotConnection: (robotId: string, type: "connect" | "disconnect") =>
    `/connection/${robotId}/${type}`,

  mapping: {
    start: (robotId: string) => `/mapping/${robotId}/start`,
    stop: (robotId: string) => `/mapping/${robotId}/stop`,
    saveLocation: (robotId: string) => `/mapping/${robotId}/save_location`,
    delete: (robotId: string) => `/mapping/${robotId}/delete`,
  },

  navigation: {
    start: (robotId: string) => `/navigation/${robotId}/start`,
    startWithMap: (robotId: string) => `/navigation/${robotId}/start_with_map`,
    stop: (robotId: string) => `/navigation/${robotId}/stop`,
    exploringStart: (robotId: string) =>
      `/navigation/${robotId}/exploring/start`,
    exploringStop: (robotId: string) => `/navigation/${robotId}/exploring/stop`,
    emergencyStop: (robotId: string, state: "activate" | "deactivate") =>
      `/navigation/${robotId}/emergency_stop/${state}`,
  },

  recording: {
    start: (robotId: string) => `/recording/${robotId}/start`,
    stop: (robotId: string) => `/recording/${robotId}/stop`,
    status: (robotId: string) => `/recording/${robotId}/status`,
    remove: (robotId: string, rosbagName: string) =>
      `/recording/${robotId}/${encodeURIComponent(rosbagName)}`,
  },

  streaming: {
    offerClient: "/streaming/offer/client",
    offerBrowser: "/streaming/offer/browser",
    status: "/streaming/status",
    viewer: "/streaming/viewer",
  },

  /**
   * Fake-backend helper endpoints. Read helpers may be absent on the production
   * backend; callers should handle 404s as "not available" where appropriate.
   */
  sim: {
    /** Fake-backend simulation engine and fleet health snapshot. */
    health: "/sim/health",
    /** Effective runtime configuration with secrets omitted. */
    config: "/sim/config",
    /** Current state snapshots for all simulated robots. */
    robots: "/sim/robots",
    /** Full simulated state: pose, task, goal, plan, battery, map, rosbags. */
    robot: (robotId: string) => `/sim/robots/${encodeURIComponent(robotId)}`,
    /** Publish on a topic the robot's own enum allows (goal_pose, initialpose). */
    publish: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/publish`,
    /** Materialise the whole world into the SLAM map. */
    revealMap: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/map/reveal_all`,
    world: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/world`,
    mapImage: (robotId: string, source: "slam" | "world", downsample = 1) =>
      `/sim/robots/${encodeURIComponent(robotId)}/map.png?source=${source}&downsample=${downsample}`,
    goal: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/goal`,
    battery: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/battery`,
    fault: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/fault`,
    unreachableHosts: "/sim/faults/unreachable_hosts",
    teleport: (robotId: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/teleport`,
    /** Reset the simulation for one robot (pose, map, plan, rosbags, battery). */
    reset: "/sim/engine/reset",
    /** Named waypoints (GET list, POST upsert, DELETE by name). */
    waypoints: "/sim/waypoints",
    waypoint: (name: string) => `/sim/waypoints/${encodeURIComponent(name)}`,
    /** Read-only access to topics the streaming sockets do not carry. */
    telemetry: (robotId: string) => `/telemetry/${encodeURIComponent(robotId)}`,
    telemetryTopic: (robotId: string, topic: string) =>
      `/telemetry/${encodeURIComponent(robotId)}/${encodeURIComponent(topic)}`,
    robotTelemetryTopic: (robotId: string, topic: string) =>
      `/sim/robots/${encodeURIComponent(robotId)}/telemetry/${encodeURIComponent(topic)}`,
  },

  /** Telemetry read stream: ws(s)://host/streaming_socket/{robot}/ws/subscribe/{topic} */
  subscribeSocket: (robotId: string, topic: string) =>
    `/streaming_socket/${encodeURIComponent(robotId)}/ws/subscribe/${topic}`,

  /** Teleoperation command socket: ws(s)://host/control_socket/robots/{robot}/ws/publish/twist */
  twistSocket: (robotId: string) =>
    `/control_socket/robots/${encodeURIComponent(robotId)}/ws/publish/twist`,
} as const;
