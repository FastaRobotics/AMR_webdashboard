/**
 * Fake robot + fake backend for end-to-end UI verification.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 * ─────────────────────────────────────────────────────────────────────────────
 * A single Node script that impersonates BOTH halves of the real system:
 *
 *   1. the FastAPI backend (REST routes + the two WebSocket routers), and
 *   2. the robot behind it (odometry that moves, diagnostics, service replies).
 *
 * The React app is unchanged and unaware: it talks to http://localhost:8000 and
 * ws://localhost:8000 exactly as it would in production. That means this
 * exercises the real frontend code paths — the axios client, the auth
 * interceptor, both WebSocket hooks, the shared robot store, and the retry /
 * error branches — without needing ROS, rosbridge, or a working Python backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USE
 * ─────────────────────────────────────────────────────────────────────────────
 *   node dev/fake-robot.mjs                 # start on :8000
 *   node dev/fake-robot.mjs --port 8001     # different port
 *
 * Then, in another terminal, run the UI (npm run dev) and log in with any user
 * in FAKE_USERS below. Point the UI at this server via VITE_BACKEND_URL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAULT INJECTION — this is the part that makes it a real test
 * ─────────────────────────────────────────────────────────────────────────────
 *   curl -X POST localhost:8000/__sim/robot/amr_1/offline
 *   curl -X POST localhost:8000/__sim/robot/amr_1/online
 *   curl -X POST localhost:8000/__sim/fleet/empty          # robot_list -> empty
 *   curl -X POST localhost:8000/__sim/fleet/restore
 *   curl -X POST localhost:8000/__sim/connect-fails        # connect -> 500
 *   curl -X POST localhost:8000/__sim/clear-faults
 *   curl       localhost:8000/__sim/state                  # inspect current state
 *   curl -X POST localhost:8000/__sim/tokens/clear         # force 401s everywhere
 *
 * These let you prove the UI degrades correctly, which the happy path alone
 * cannot show.
 *
 * NOTE: this file is development tooling. Do not ship it, and do not commit it
 * to the repository that deploys the dashboard.
 */

import http from "node:http";
import { WebSocketServer } from "ws";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = portArg !== -1 ? Number(args[portArg + 1]) : 8000;

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Accepted logins. `password` is what the UI must send.
 *
 * NOTE: the real backend uses passlib bcrypt. The mock compares plain strings so
 * that it has no crypto dependency. It deliberately does NOT reproduce the real
 * backend's bug where legacy plaintext rows in users.db make passlib throw.
 */
const FAKE_USERS = {
  savitar: "Erfan25",
  erfan: "erfan123",
  safar: "safar123",
};

/**
 * Robot definitions. `initialConnected` is the power-on state, kept separate so
 * /__sim/reset can restore it.
 */
const ROBOT_DEFS = [
  {
    id: "amr_1",
    type: "AMR",
    host: "192.168.1.219",
    port: 9090,
    /** Start connected so the happy path is immediately visible. */
    initialConnected: true,
  },
  {
    id: "go2_1",
    type: "Go2",
    host: "192.168.1.220",
    port: 7070,
    initialConnected: false,
  },
];

/** Mirrors RobotStatus in backend/robot.py. */
const STATUS = { OFFLINE: "offline", IDLE: "idle", RUN_TASK: "run_task" };

const makeRobots = () =>
  ROBOT_DEFS.map((def) => {
    const { initialConnected, ...rest } = def;
    return {
      ...rest,
      connected: initialConnected,
      status: initialConnected ? STATUS.IDLE : STATUS.OFFLINE,
    };
  });

/** Runtime state, mutated by both the API and the fault-injection routes. */
const sim = {
  robots: makeRobots(),
  fleetEmpty: false,
  connectFails: false,
  validTokens: new Set(),
  /** Per-robot flight recorder, purely for console visibility. */
  commands: [],
};

/** Simulated clock and motion state per robot. */
const motion = new Map();
for (const robot of sim.robots) {
  motion.set(robot.id, { x: 0, y: 0, theta: 0, linear: 0, angular: 0, seq: 0 });
}

const getRobot = (id) => sim.robots.find((r) => r.id === id);
const isConnected = (id) => Boolean(getRobot(id)?.connected);

// ─── HTTP helpers ────────────────────────────────────────────────────────────

/**
 * Mirror of FastAPI's JSONResponse for these routes.
 *
 * Deliberately reproduces one real quirk: when the fleet list is empty the real
 * backend returns `JSONResponse(content=[])`, i.e. a 200 with an EMPTY BODY
 * rather than "[]". The UI guards against this, and that guard is worth testing.
 */
function sendJson(res, status, body, { emptyBody = false } = {}) {
  if (emptyBody) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end();
    return;
  }
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendDetail(res, status, detail) {
  sendJson(res, status, { detail });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // The backend declares several bodies as bare JSON strings (e.g. the
    // rosbag name), so a failed parse is returned raw.
    return raw;
  }
}

/** Requests with a Bearer token that the mock has not issued. */
function isAuthorised(req) {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && sim.validTokens.has(match[1]));
}

let tokenCounter = 0;
const issueToken = () => `fake.${Date.now()}.${++tokenCounter}`;

/**
 * FastAPI's OAuth2PasswordBearer answers a missing/invalid bearer token with
 * 401 + WWW-Authenticate. The UI's axios interceptor logs out and redirects.
 */
function requireAuth(req, res) {
  if (isAuthorised(req)) return true;
  res.setHeader("WWW-Authenticate", "Bearer");
  sendDetail(res, 401, "Not authenticated");
  return false;
}

// ─── Robot simulation ────────────────────────────────────────────────────────

/** Integrate a simple unicycle model so odometry actually changes over time. */
function stepMotion(dtSeconds) {
  for (const robot of sim.robots) {
    const m = motion.get(robot.id);
    m.seq += 1;

    if (!robot.connected || robot.status === STATUS.OFFLINE) {
      m.linear = 0;
      m.angular = 0;
      continue;
    }

    // Idle robots coast to a stop; task robots hold a gentle patrol pattern.
    if (robot.status === STATUS.RUN_TASK) {
      if (m.linear === 0 && m.angular === 0) {
        m.linear = 0.25;
        m.angular = 0.15;
      }
    } else {
      m.linear += (0 - m.linear) * Math.min(1, dtSeconds * 2);
      m.angular += (0 - m.angular) * Math.min(1, dtSeconds * 2);
      if (Math.abs(m.linear) < 1e-4) m.linear = 0;
      if (Math.abs(m.angular) < 1e-4) m.angular = 0;
    }

    m.theta += m.angular * dtSeconds;
    m.x += m.linear * Math.cos(m.theta) * dtSeconds;
    m.y += m.linear * Math.sin(m.theta) * dtSeconds;
  }
}

/** ROS time as {secs, nsecs}, matching roslibpy's decoding of a ROS header. */
function rosTime() {
  const ms = Date.now();
  return { secs: Math.floor(ms / 1000), nsecs: (ms % 1000) * 1e6 };
}

function quaternionFromYaw(yaw) {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

const header = (frameId) => ({ stamp: rosTime(), frame_id: frameId });

/** ROS: nav_msgs/msg/Odometry */
function odomMessage(robotId) {
  const m = motion.get(robotId);
  return {
    header: header("odom"),
    child_frame_id: `${robotId}/base_link`,
    pose: {
      pose: { position: { x: m.x, y: m.y, z: 0 }, orientation: quaternionFromYaw(m.theta) },
      // Row-major 6x6, as ROS serialises it. Values are plausible, not physical.
      covariance: [0.01, 0, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0.05],
    },
    twist: {
      twist: {
        linear: { x: m.linear, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: m.angular },
      },
      covariance: [0.01, 0, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0.05],
    },
  };
}

/** ROS: nav_msgs/msg/OccupancyGrid — a static room with a couple of obstacles. */
const MAP_W = 96;
const MAP_H = 64;
const MAP_RESOLUTION = 0.05;

function buildMapData() {
  const data = new Array(MAP_W * MAP_H).fill(0);
  const set = (x, y, v) => {
    if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H) data[y * MAP_W + x] = v;
  };

  // Unknown border, then an occupied wall inset by one cell.
  for (let x = 0; x < MAP_W; x++) {
    set(x, 0, -1);
    set(x, MAP_H - 1, -1);
  }
  for (let y = 0; y < MAP_H; y++) {
    set(0, y, -1);
    set(MAP_W - 1, y, -1);
  }
  for (let x = 2; x < MAP_W - 2; x++) {
    set(x, 2, 100);
    set(x, MAP_H - 3, 100);
  }
  for (let y = 2; y < MAP_H - 2; y++) {
    set(2, y, 100);
    set(MAP_W - 3, y, 100);
  }

  // Two interior obstacles.
  for (let x = 24; x < 32; x++) for (let y = 20; y < 28; y++) set(x, y, 100);
  for (let x = 60; x < 66; x++) for (let y = 36; y < 44; y++) set(x, y, 100);

  return data;
}

const MAP_DATA = buildMapData();

function mapMessage() {
  return {
    header: header("map"),
    info: {
      map_load_time: rosTime(),
      resolution: MAP_RESOLUTION,
      width: MAP_W,
      height: MAP_H,
      origin: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data: MAP_DATA,
  };
}

/** ROS: tf2_msgs/msg/TFMessage */
function tfMessage(robotId) {
  const m = motion.get(robotId);
  const yaw = m.theta;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  // base_link -> laser is a fixed offset in the robot frame, rotated by yaw.
  const laserOffset = { x: 0.15, y: 0 };
  const laserX = m.x + laserOffset.x * cos - laserOffset.y * sin;
  const laserY = m.y + laserOffset.x * sin + laserOffset.y * cos;

  return {
    transforms: [
      {
        header: header("map"),
        child_frame_id: `${robotId}/base_link`,
        transform: {
          translation: { x: m.x, y: m.y, z: 0 },
          rotation: quaternionFromYaw(yaw),
        },
      },
      {
        header: header(`${robotId}/base_link`),
        child_frame_id: `${robotId}/laser`,
        transform: {
          translation: { x: laserX, y: laserY, z: 0.2 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ],
  };
}

/** ROS: nav_msgs/msg/Path — a short list of poses ahead of the robot. */
function pathMessage(robotId) {
  const m = motion.get(robotId);
  const poses = [];
  for (let i = 0; i < 12; i++) {
    const yaw = m.theta + i * 0.05;
    poses.push({
      header: header("map"),
      pose: {
        position: {
          x: m.x + Math.cos(yaw) * (i + 1) * 0.25,
          y: m.y + Math.sin(yaw) * (i + 1) * 0.25,
          z: 0,
        },
        orientation: quaternionFromYaw(yaw),
      },
    });
  }
  return { header: header("map"), poses };
}

/**
 * ROS: diagnostic_msgs/msg/DiagnosticArray
 *
 * The backend subscribes to this topic as
 * "diagnostic_msgs/msg/DiagnosticArray" and the UI renders `status[]`.
 * One service is intentionally WARN so the UI's level handling is visible; it
 * flips to ERROR while a robot is running a task.
 */
function diagnosticsMessage(robotId) {
  const robot = getRobot(robotId);
  const running = robot?.status === STATUS.RUN_TASK;

  return {
    header: header("diagnostics"),
    status: [
      { level: 0, name: "camera_driver", message: "Operational", hardware_id: `${robotId}/zed`, values: [] },
      { level: 0, name: "imu_driver", message: "Operational", hardware_id: `${robotId}/imu`, values: [] },
      { level: 0, name: "motor_driver", message: "Operational", hardware_id: `${robotId}/motors`, values: [] },
      { level: 0, name: "ultrasonic_driver", message: "Operational", hardware_id: `${robotId}/ultrasonic`, values: [] },
      {
        level: running ? 2 : 1,
        name: "battery_monitor",
        message: running ? "Discharging quickly under load" : "Discharging",
        hardware_id: `${robotId}/battery`,
        values: [
          { key: "percentage", value: running ? "0.62" : "0.87" },
          { key: "voltage", value: "24.6" },
        ],
      },
      {
        level: 0,
        name: "slam",
        message: running ? "Mapping active" : "Idle",
        hardware_id: `${robotId}/slam`,
        values: [],
      },
    ],
  };
}

/** Payload builder per topic, matching the UI's RobotStreamTopic union. */
const TOPIC_BUILDERS = {
  map: (id) => ({ map: mapMessage() }),
  odom: (id) => ({ odom: odomMessage(id) }),
  tf: (id) => ({ tf: tfMessage(id) }),
  diagnostics: (id) => ({ diagnostics: diagnosticsMessage(id) }),
  path: (id) => ({ path: pathMessage(id) }),
};

/** Push cadence per topic, chosen to match the real backend's sleep intervals. */
const TOPIC_INTERVAL_MS = {
  map: 100,
  odom: 100,
  tf: 100,
  diagnostics: 500,
  path: 500,
};

/** ROS services, mirroring ros_bridge/AMR/service_client_available.py. */
const SERVICE_RESPONSES = {
  "/mapping_service_node/start_mapping": { success: true, message: "mapping started" },
  "/mapping_service_node/stop_mapping": { success: true, message: "map saved as latest" },
  "/mapping_service_node/start_exploring": { success: true, message: "exploring started" },
  "/mapping_service_node/stop_exploring": { success: true, message: "exploring stopped" },
  "/start/navigation": { success: true, message: "navigation started" },
  "/start/navigation_with_map": { success: true, message: "map loaded" },
  "/stop/navigation": { success: true, message: "navigation stopped" },
  "/start/recording": { success: true, message: "recording started" },
  "/stop/recording": { success: true, message: "recording stopped" },
  "/status/recording": { success: true, message: "recording idle" },
  "/delete/recording": { success: true, message: "rosbag deleted" },
};

// ─── REST routes ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route table. `pattern` is matched against the pathname; `:name` captures a
 * segment. Order matters — the first match wins.
 */
const ROUTES = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    method: "POST",
    pattern: "/user/login",
    handler: async (req, res) => {
      const body = await readBody(req);
      const user = body?.user_name;
      const pass = body?.password;

      if (!user || !pass || FAKE_USERS[user] !== pass) {
        // The real backend returns exactly this for bad credentials.
        return sendDetail(res, 401, "Invalid credentials");
      }

      const token = issueToken();
      sim.validTokens.add(token);
      return sendJson(res, 200, { access_token: token, token_type: "bearer" });
    },
  },
  {
    method: "POST",
    pattern: "/user/create",
    handler: async (req, res) => {
      const body = await readBody(req);
      if (!body?.user_name) return sendDetail(res, 422, "user_name required");
      if (FAKE_USERS[body.user_name]) return sendDetail(res, 400, "User exists");
      FAKE_USERS[body.user_name] = body.password;
      return sendJson(res, 200, { message: "user created" });
    },
  },

  // ── Fleet ─────────────────────────────────────────────────────────────────
  {
    method: "GET",
    pattern: "/connection/robot_list",
    auth: true,
    handler: (req, res) => {
      // Reproduces the real backend's empty-fleet quirk: a 200 with no body.
      if (sim.fleetEmpty) return sendJson(res, 200, null, { emptyBody: true });
      return sendJson(
        res,
        200,
        sim.robots.map((r) => ({ id: r.id, type: r.type })),
      );
    },
  },
  {
    method: "GET",
    pattern: "/connection/:robotId/status",
    auth: true,
    handler: (req, res, params) => {
      const robot = getRobot(params.robotId);
      if (!robot) return sendDetail(res, 422, "Invalid robot id");
      // The real backend returns only this display string, never a boolean.
      return sendJson(res, 200, {
        message: `Connection status for ${robot.id}: ${
          robot.connected ? "Connected" : "Disconnected"
        }`,
      });
    },
  },
  {
    method: "POST",
    pattern: "/connection/:robotId/:type",
    // Deliberately unauthenticated: the real backend has this dependency
    // commented out at routers/connection.py:39.
    handler: async (req, res, params) => {
      const { robotId, type } = params;
      const robot = getRobot(robotId);
      if (!robot) return sendDetail(res, 422, "Invalid robot id");
      if (type !== "connect" && type !== "disconnect") {
        return sendDetail(res, 422, "Invalid connection type");
      }

      if (type === "connect") {
        if (sim.connectFails) {
          // Mirrors the backend wrapping an unreachable rosbridge in a 500.
          return sendDetail(
            res,
            500,
            `[${robotId}] Failed to connect to ROS at ${robot.host}:${robot.port}`,
          );
        }
        const body = await readBody(req);
        // Record the address the UI sent. Omitting it is a real bug in the UI,
        // because FastAPI would then substitute its 0.0.0.0 default.
        if (!body?.host) {
          console.warn(
            `[fake-robot] WARNING: connect sent no host; the real backend would use 0.0.0.0`,
          );
        }
        robot.connected = true;
        robot.status = STATUS.IDLE;
        console.log(`[fake-robot] ${robotId} CONNECTED (${body?.host ?? "-"}:${body?.port ?? "-"})`);
        return sendJson(res, 200, { message: `Robot '${robotId}' connected` });
      }

      robot.connected = false;
      robot.status = STATUS.OFFLINE;
      console.log(`[fake-robot] ${robotId} DISCONNECTED`);
      return sendJson(res, 200, { message: `Robot '${robotId}' disconnected` });
    },
  },

  // ── Mapping ───────────────────────────────────────────────────────────────
  {
    method: "POST",
    pattern: "/mapping/:robotId/start",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.RUN_TASK;
      return sendJson(res, 200, {
        status: "map started",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/mapping_service_node/start_mapping"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/mapping/:robotId/stop",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.IDLE;
      return sendJson(res, 200, {
        status: "map stopped",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/mapping_service_node/stop_mapping"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/mapping/:robotId/save_location",
    auth: true,
    // Reproduces the real stub, which returns success without doing anything.
    handler: (req, res) => sendJson(res, 200, { message: "location saved" }),
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  {
    method: "POST",
    pattern: "/navigation/:robotId/start",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.IDLE;
      return sendJson(res, 200, {
        status: "navigation started",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/start/navigation"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/navigation/:robotId/start_with_map",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.RUN_TASK;
      return sendJson(res, 200, {
        status: "navigation started",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/start/navigation_with_map"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/navigation/:robotId/stop",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.IDLE;
      return sendJson(res, 200, {
        status: "navigation stopped",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/stop/navigation"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/navigation/:robotId/exploring/start",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.RUN_TASK;
      return sendJson(res, 200, {
        status: "exploring started",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/mapping_service_node/start_exploring"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/navigation/:robotId/exploring/stop",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      getRobot(params.robotId).status = STATUS.IDLE;
      return sendJson(res, 200, {
        status: "exploring stopped",
        robot_id: params.robotId,
        response: SERVICE_RESPONSES["/mapping_service_node/stop_exploring"],
      });
    },
  },
  {
    method: "POST",
    pattern: "/navigation/:robotId/emergency_stop/:state",
    // Unauthenticated, matching the commented-out dependency in navigation.py.
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      const { state, robotId } = params;
      if (state !== "activate" && state !== "deactivate") {
        return sendDetail(res, 422, "Invalid state");
      }

      const robot = getRobot(robotId);
      if (state === "activate") robot.status = STATUS.OFFLINE;
      else if (robot.connected) robot.status = STATUS.IDLE;

      console.log(`[fake-robot] ${robotId} EMERGENCY STOP ${state.toUpperCase()}`);
      return sendJson(res, 200, {
        status: "emergency stop activated",
        robot_id: robotId,
        response: { status: "published", topic: "emergency_stop", message: state === "activate" },
      });
    },
  },

  // ── Recording ─────────────────────────────────────────────────────────────
  {
    method: "POST",
    pattern: "/recording/:robotId/start",
    auth: true,
    handler: async (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      const body = await readBody(req);
      // The backend declares this body as a bare JSON string.
      if (typeof body !== "string") {
        console.warn(
          `[fake-robot] WARNING: recording start body was ${JSON.stringify(body)}, expected a JSON string`,
        );
      }
      return sendJson(res, 200, {
        ...SERVICE_RESPONSES["/start/recording"],
        log_file_name: body,
      });
    },
  },
  {
    method: "POST",
    pattern: "/recording/:robotId/stop",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      return sendJson(res, 200, SERVICE_RESPONSES["/stop/recording"]);
    },
  },
  {
    method: "POST",
    pattern: "/recording/:robotId/status",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      return sendJson(res, 200, SERVICE_RESPONSES["/status/recording"]);
    },
  },
  {
    method: "DELETE",
    pattern: "/recording/:robotId/:rosbagName",
    auth: true,
    handler: (req, res, params) => {
      const error = guardRobot(res, params.robotId);
      if (error) return error;
      return sendJson(res, 200, SERVICE_RESPONSES["/delete/recording"]);
    },
  },

  // ── Streaming / WebRTC signalling ─────────────────────────────────────────
  {
    method: "GET",
    pattern: "/streaming/status",
    auth: true,
    handler: (req, res) =>
      sendJson(res, 200, { client_connected: false, source_tracks: 0, total_pcs: 0 }),
  },
  {
    method: "POST",
    pattern: "/streaming/offer/:kind",
    auth: true,
    handler: (req, res) =>
      sendJson(res, 200, { sdp: "v=0\r\n", type: "answer", track_count: 0 }),
  },

  // ── Fault injection ───────────────────────────────────────────────────────
  {
    method: "GET",
    pattern: "/__sim/state",
    handler: (req, res) =>
      sendJson(res, 200, {
        fleetEmpty: sim.fleetEmpty,
        connectFails: sim.connectFails,
        validTokens: sim.validTokens.size,
        robots: sim.robots.map((r) => ({
          id: r.id,
          type: r.type,
          host: r.host,
          port: r.port,
          connected: r.connected,
          status: r.status,
        })),
        recentCommands: sim.commands.slice(-10),
      }),
  },
  {
    method: "POST",
    pattern: "/__sim/robot/:robotId/:action",
    handler: (req, res, params) => {
      const robot = getRobot(params.robotId);
      if (!robot) return sendDetail(res, 404, "Unknown robot");

      if (params.action === "online") {
        robot.connected = true;
        robot.status = STATUS.IDLE;
      } else if (params.action === "offline") {
        robot.connected = false;
        robot.status = STATUS.OFFLINE;
        // Drop live sockets so the UI sees the offline branch, not just a
        // silent stream that keeps repeating the last frame.
        closeRobotSockets(params.robotId, "robot offline");
      } else {
        return sendDetail(res, 404, "Unknown action");
      }

      console.log(`[fake-robot] ${params.robotId} -> ${params.action}`);
      return sendJson(res, 200, { id: robot.id, connected: robot.connected, status: robot.status });
    },
  },
  {
    method: "POST",
    pattern: "/__sim/fleet/empty",
    handler: (req, res) => {
      sim.fleetEmpty = true;
      return sendJson(res, 200, { fleetEmpty: true });
    },
  },
  {
    method: "POST",
    pattern: "/__sim/fleet/restore",
    handler: (req, res) => {
      sim.fleetEmpty = false;
      return sendJson(res, 200, { fleetEmpty: false });
    },
  },
  {
    method: "POST",
    pattern: "/__sim/connect-fails",
    handler: (req, res) => {
      sim.connectFails = true;
      return sendJson(res, 200, { connectFails: true });
    },
  },
  {
    method: "POST",
    pattern: "/__sim/clear-faults",
    handler: (req, res) => {
      sim.fleetEmpty = false;
      sim.connectFails = false;
      for (const robot of sim.robots) {
        robot.connected = true;
        robot.status = STATUS.IDLE;
      }
      return sendJson(res, 200, { cleared: true });
    },
  },
  {
    method: "POST",
    pattern: "/__sim/reset",
    handler: (req, res) => {
      // Restore power-on state: robots, motion, faults and tokens. Handy both
      // for repeatable tests and for resetting a manual session.
      sim.robots = makeRobots();
      sim.fleetEmpty = false;
      sim.connectFails = false;
      sim.commands = [];
      sim.validTokens.clear();

      for (const robot of sim.robots) {
        motion.set(robot.id, { x: 0, y: 0, theta: 0, linear: 0, angular: 0, seq: 0 });
      }

      return sendJson(res, 200, {
        reset: true,
        robots: sim.robots.map((r) => ({ id: r.id, connected: r.connected, status: r.status })),
      });
    },
  },
  {
    method: "POST",
    pattern: "/__sim/tokens/clear",
    handler: (req, res) => {
      sim.validTokens.clear();
      return sendJson(res, 200, { validTokens: 0 });
    },
  },
];

/** Shared guard: unknown robot (422, as the enum would produce) or offline. */
function guardRobot(res, robotId) {
  const robot = getRobot(robotId);
  if (!robot) return sendDetail(res, 422, "Invalid robot id");
  if (!robot.connected) {
    return sendDetail(res, 500, `[${robotId}] Cannot call service: Not connected.`);
  }
  return null;
}

function matchRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;

    const routeParts = route.pattern.split("/");
    const pathParts = pathname.split("/");
    if (routeParts.length !== pathParts.length) continue;

    const params = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i++) {
      const rp = routeParts[i];
      if (rp.startsWith(":")) {
        // %2F-encoded ids arrive decoded here; the real backend rejects them via
        // its enum, so an unknown value simply fails getRobot later.
        params[rp.slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (rp !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  // CORS: mirrors allow_origins=["*"] in backend/api.py. Safe here because the
  // UI's axios instance does not set withCredentials.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const match = matchRoute(req.method, url.pathname);

  if (!match) {
    console.log(`[fake-robot] 404 ${req.method} ${url.pathname}`);
    return sendDetail(res, 404, "Not Found");
  }

  if (match.route.auth && !requireAuth(req, res)) {
    console.log(`[fake-robot] 401 ${req.method} ${url.pathname}`);
    return;
  }

  try {
    await match.route.handler(req, res, match.params);
    if (!res.writableEnded) {
      console.log(`[fake-robot] ${req.method} ${url.pathname}`);
    } else {
      console.log(`[fake-robot] ${req.method} ${url.pathname}`);
    }
  } catch (err) {
    console.error(`[fake-robot] handler error on ${url.pathname}:`, err);
    if (!res.writableEnded) sendDetail(res, 500, String(err));
  }
});

// ─── WebSockets ──────────────────────────────────────────────────────────────

/**
 * Both routers live on the same HTTP server; routes are distinguished by path,
 * exactly as they are in the real app:
 *   /streaming_socket/{robotId}/ws/subscribe/{topic}
 *   /control_socket/robots/{robotId}/ws/publish/twist
 */
const wss = new WebSocketServer({ noServer: true });

/** robotId -> Set<WebSocket>, so fault injection can drop live streams. */
const socketsByRobot = new Map();

function trackSocket(robotId, ws) {
  if (!socketsByRobot.has(robotId)) socketsByRobot.set(robotId, new Set());
  socketsByRobot.get(robotId).add(ws);
  ws.on("close", () => socketsByRobot.get(robotId)?.delete(ws));
}

function closeRobotSockets(robotId, reason) {
  const sockets = socketsByRobot.get(robotId);
  if (!sockets) return;
  for (const ws of [...sockets]) {
    try {
      if (ws.readyState === ws.OPEN) {
        // The real backend sends this payload then closes.
        ws.send(JSON.stringify({ error: reason }));
        ws.close(1000, reason);
      }
    } catch {
      /* ignore */
    }
  }
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  const streamMatch = /^\/streaming_socket\/([^/]+)\/ws\/subscribe\/([^/]+)$/.exec(path);
  const twistMatch = /^\/control_socket\/robots\/([^/]+)\/ws\/publish\/twist$/.exec(path);

  if (!streamMatch && !twistMatch) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (streamMatch) {
      handleStreamSocket(ws, decodeURIComponent(streamMatch[1]), decodeURIComponent(streamMatch[2]));
    } else {
      handleTwistSocket(ws, decodeURIComponent(twistMatch[1]));
    }
  });
});

/** Mirrors streaming_ws.py: push a topic at a fixed rate, or close if offline. */
function handleStreamSocket(ws, robotId, topic) {
  const robot = getRobot(robotId);

  if (!robot) {
    ws.send(JSON.stringify({ error: `Robot '${robotId}' not found` }));
    ws.close(1008, "unknown robot");
    console.log(`[fake-robot] WS ${robotId}/${topic} REJECTED (unknown robot)`);
    return;
  }

  if (!robot.connected) {
    ws.send(JSON.stringify({ error: "robot not connected" }));
    ws.close(1000, "robot not connected");
    console.log(`[fake-robot] WS ${robotId}/${topic} REJECTED (offline)`);
    return;
  }

  const build = TOPIC_BUILDERS[topic];
  if (!build) {
    ws.send(JSON.stringify({ error: `Unknown topic '${topic}'` }));
    ws.close(1008, "unknown topic");
    return;
  }

  trackSocket(robotId, ws);
  console.log(`[fake-robot] WS ${robotId}/${topic} streaming`);

  const push = () => {
    if (ws.readyState !== ws.OPEN) return;

    // A robot can go offline mid-stream; the real backend would keep sending
    // stale data, but closing is the more useful behaviour to test against.
    if (!robot.connected) {
      ws.send(JSON.stringify({ error: "robot not connected" }));
      ws.close(1000, "robot offline");
      return;
    }

    ws.send(
      JSON.stringify({
        robot_id: robotId,
        status: robot.status,
        ...build(robotId),
      }),
    );
  };

  // Send immediately so the UI does not wait a full interval for first paint.
  push();
  const timer = setInterval(push, TOPIC_INTERVAL_MS[topic] ?? 200);

  ws.on("close", () => clearInterval(timer));
  ws.on("error", () => clearInterval(timer));
}

/** Mirrors control.py: accept {"type":"twist","data":{linear,angular}}. */
function handleTwistSocket(ws, robotId) {
  const robot = getRobot(robotId);

  if (!robot) {
    ws.send(JSON.stringify({ error: `Robot '${robotId}' not found` }));
    ws.close(1008, "unknown robot");
    return;
  }

  if (!robot.connected) {
    ws.send(JSON.stringify({ error: "robot not connected" }));
    ws.close(1000, "robot not connected");
    console.log(`[fake-robot] WS twist ${robotId} REJECTED (offline)`);
    return;
  }

  trackSocket(robotId, ws);
  console.log(`[fake-robot] WS twist ${robotId} open`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    if (msg?.type !== "twist") {
      ws.send(JSON.stringify({ error: `Unknown command type ${msg?.type}` }));
      return;
    }

    const linear = Number(msg?.data?.linear);
    const angular = Number(msg?.data?.angular);

    if (!Number.isFinite(linear) || !Number.isFinite(angular)) {
      ws.send(JSON.stringify({ error: "linear and angular must be numbers" }));
      return;
    }

    // Drive the simulation from the command so the UI's odometry reacts to the
    // joystick — this is what makes the loop feel real.
    const m = motion.get(robotId);
    m.linear = linear;
    m.angular = angular;
    if (robot.status !== STATUS.RUN_TASK) {
      robot.status = linear === 0 && angular === 0 ? STATUS.IDLE : STATUS.RUN_TASK;
    }

    sim.commands.push({ robotId, linear, angular, at: new Date().toISOString() });
    if (sim.commands.length > 200) sim.commands.shift();

    ws.send(JSON.stringify({ status: "ok", type: "twist" }));
  });
}

// ─── Simulation loop ─────────────────────────────────────────────────────────

const TICK_MS = 50;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.5);
  lastTick = now;
  stepMotion(dt);
}, TICK_MS);

// ─── Boot ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  const line = "─".repeat(66);
  console.log(line);
  console.log(`  fake robot + fake backend listening on http://localhost:${PORT}`);
  console.log(line);
  console.log(`  robots:`);
  for (const r of sim.robots) {
    console.log(
      `    ${r.id.padEnd(7)} ${r.type.padEnd(5)} ${r.host}:${r.port}  ` +
        `${r.connected ? "CONNECTED" : "offline"}`,
    );
  }
  console.log(`\n  log in with:  ${Object.keys(FAKE_USERS).join(" / ")}`);
  console.log(
    `  set VITE_BACKEND_URL=http://localhost:${PORT} in Dashboard_UI/.env`,
  );
  console.log(`\n  fault injection (see header of this file for the full list):`);
  console.log(`    curl -X POST localhost:${PORT}/__sim/robot/amr_1/offline`);
  console.log(`    curl -X POST localhost:${PORT}/__sim/fleet/empty`);
  console.log(`    curl       localhost:${PORT}/__sim/state`);
  console.log(line);
});
