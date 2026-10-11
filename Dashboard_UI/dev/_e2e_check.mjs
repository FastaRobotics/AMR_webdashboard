/**
 * Temporary end-to-end check of dev/fake-robot.mjs.
 * Exercises the exact contract the React app depends on, then verifies the
 * frontend's own parsing rules (e.g. the ": Connected" regex) hold.
 */

const BASE = "http://localhost:8000";
const WS = "ws://localhost:8000";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  -> ${detail}` : ""}`);
  }
}

async function req(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

/**
 * Import the REAL status parser from src/api/config.ts rather than mirroring it.
 *
 * config.ts is TypeScript and reads import.meta.env, which plain Node cannot
 * load — so Node 24's type-stripping is not enough on its own. We therefore
 * extract and evaluate just the pure function under test, which is still the
 * shipped source text (not a hand-written copy that could drift).
 */
import { readFileSync } from "node:fs";

function loadParseConnectionMessage() {
  const source = readFileSync(new URL("../src/api/config.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function parseConnectionMessage");
  if (start === -1) throw new Error("parseConnectionMessage not found in src/api/config.ts");

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  const fnSource = source.slice(source.indexOf("function", start), end);

  /**
   * Strip the one type annotation and return type so `new Function` can parse
   * it. Anchored narrowly so it fails loudly (rather than silently mangling the
   * body) if the signature in config.ts ever changes shape.
   */
  const jsSource = fnSource
    .replace(
      /function\s+parseConnectionMessage\s*\(\s*message\s*:\s*string\s*\|\s*undefined\s*\|\s*null\s*\)\s*:\s*boolean\s*\{/,
      "function parseConnectionMessage(message) {",
    );

  if (jsSource === fnSource) {
    throw new Error(
      "Could not strip types from parseConnectionMessage — its signature changed. " +
        "Update the extraction regex in dev/_e2e_check.mjs.",
    );
  }

  return new Function(`${jsSource}; return parseConnectionMessage;`)();
}

const parseConnected = loadParseConnectionMessage();

/**
 * Preflight: prove the extracted function is really the shipped logic. Without
 * this, a broken extraction could make every status assertion below vacuously
 * pass or fail for the wrong reason.
 */
{
  const sanityCases = [
    ["Connection status for amr_1: Connected", true],
    ["Connection status for amr_1: Disconnected", false],
    ["", false],
    [undefined, false],
  ];
  for (const [input, expected] of sanityCases) {
    if (parseConnected(input) !== expected) {
      throw new Error(
        `parser preflight failed for ${JSON.stringify(input)}: expected ${expected}`,
      );
    }
  }
  console.log("PASS  extracted parseConnectionMessage from src/api/config.ts and it behaves correctly");
}

// ─── Auth ────────────────────────────────────────────────────────────────────

// Start from a known state so the suite is repeatable.
const reset = await req("POST", "/__sim/reset");
check("reset restores power-on state", reset.status === 200 && reset.json?.reset === true);

console.log("\n--- auth ---");
const bad = await req("POST", "/user/login", {
  body: { user_name: "savitar", password: "wrong" },
});
check("bad password -> 401", bad.status === 401, `got ${bad.status}`);
check(
  "401 body carries FastAPI 'detail'",
  typeof bad.json?.detail === "string",
  JSON.stringify(bad.json),
);

const unauth = await req("GET", "/connection/robot_list");
check("robot_list without token -> 401", unauth.status === 401, `got ${unauth.status}`);

const login = await req("POST", "/user/login", {
  body: { user_name: "savitar", password: "Erfan25" },
});
check("good login -> 200", login.status === 200, `got ${login.status}`);
check(
  "login returns access_token",
  typeof login.json?.access_token === "string" && login.json.access_token.length > 0,
);
const token = login.json?.access_token;

// ─── Fleet ───────────────────────────────────────────────────────────────────

console.log("\n--- fleet ---");
const list = await req("GET", "/connection/robot_list", { token });
check("robot_list -> 200 array", Array.isArray(list.json), JSON.stringify(list.json));
check(
  "robot ids match the backend enum",
  JSON.stringify(list.json?.map((r) => r.id)) === JSON.stringify(["amr_1", "go2_1"]),
  JSON.stringify(list.json),
);
check(
  "each robot has id + type (what the UI reads)",
  list.json?.every((r) => typeof r.id === "string" && typeof r.type === "string"),
);

const stConnected = await req("GET", "/connection/amr_1/status", { token });
check(
  "connected status message parses as connected",
  parseConnected(stConnected.json?.message),
  stConnected.json?.message,
);

const stOffline = await req("GET", "/connection/go2_1/status", { token });
check(
  "disconnected status message does NOT parse as connected",
  parseConnected(stOffline.json?.message) === false,
  stOffline.json?.message,
);

const badId = await req("GET", "/connection/does_not_exist/status", { token });
check("unknown robot -> 422", badId.status === 422, `got ${badId.status}`);

// ─── Connect / disconnect ────────────────────────────────────────────────────

console.log("\n--- connect / disconnect ---");
const conn = await req("POST", "/connection/go2_1/connect", {
  body: { host: "192.168.1.220", port: 7070 },
});
check("connect -> 200", conn.status === 200, `got ${conn.status}`);
const after = await req("GET", "/connection/go2_1/status", { token });
check("go2_1 now reports connected", parseConnected(after.json?.message), after.json?.message);

const disc = await req("POST", "/connection/go2_1/disconnect", { body: {} });
check("disconnect -> 200", disc.status === 200, `got ${disc.status}`);
const afterDisc = await req("GET", "/connection/go2_1/status", { token });
check("go2_1 now reports disconnected", !parseConnected(afterDisc.json?.message));

// ─── Service routes on an offline robot ──────────────────────────────────────

console.log("\n--- offline behaviour ---");
const offMap = await req("POST", "/mapping/go2_1/start", { token, body: {} });
check("mapping start on offline robot -> 500", offMap.status === 500, `got ${offMap.status}`);
check(
  "500 uses the backend's 'Not connected' wording",
  String(offMap.json?.detail ?? "").includes("Not connected."),
  offMap.json?.detail,
);

const onMap = await req("POST", "/mapping/amr_1/start", { token, body: {} });
check("mapping start on connected robot -> 200", onMap.status === 200, `got ${onMap.status}`);

const stopMap = await req("POST", "/mapping/amr_1/stop", {
  token,
  body: { map_name: "latest", save_visual_slam_map: true, overwrite_visual_slam_map_folder: true },
});
check("mapping stop -> 200", stopMap.status === 200, `got ${stopMap.status}`);

// ─── Recording: the body must be a bare JSON string ──────────────────────────

console.log("\n--- recording ---");
const recStart = await req("POST", "/recording/amr_1/start", {
  token,
  body: JSON.stringify("camera_front_camera"),
  raw: true,
});
check("recording start -> 200", recStart.status === 200, `got ${recStart.status}`);
check(
  "recording start echoes the rosbag name",
  recStart.json?.log_file_name === "camera_front_camera",
  JSON.stringify(recStart.json),
);
const recStop = await req("POST", "/recording/amr_1/stop", { token, body: {} });
check("recording stop -> 200", recStop.status === 200, `got ${recStop.status}`);

// ─── Emergency stop ──────────────────────────────────────────────────────────

console.log("\n--- emergency stop ---");
const estop = await req("POST", "/navigation/amr_1/emergency_stop/activate", { body: {} });
check("emergency stop -> 200 (unauthenticated, as in the real backend)",
  estop.status === 200, `got ${estop.status}`);
const estopState = await req("GET", "/__sim/state");
check(
  "emergency stop set status offline",
  estopState.json?.robots.find((r) => r.id === "amr_1")?.status === "offline",
  JSON.stringify(estopState.json?.robots),
);
const release = await req("POST", "/navigation/amr_1/emergency_stop/deactivate", { body: {} });
check("emergency stop release -> 200", release.status === 200);
const releaseState = await req("GET", "/__sim/state");
check(
  "release restored idle",
  releaseState.json?.robots.find((r) => r.id === "amr_1")?.status === "idle",
);

// ─── WebSocket: streaming topics ─────────────────────────────────────────────

console.log("\n--- websocket: streaming ---");

function collect(url, count, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const messages = [];
    const errors = [];
    let ws;
    const done = () => {
      try { ws?.close(); } catch {}
      resolve({ messages, errors });
    };
    const timer = setTimeout(done, timeoutMs);
    ws = new WebSocket(url);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) errors.push(data.error);
      messages.push(data);
      if (messages.length >= count) {
        clearTimeout(timer);
        done();
      }
    };
    ws.onerror = () => { clearTimeout(timer); done(); };
    ws.onclose = () => clearTimeout(timer);
  });
}

const odom = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/odom`, 3);
check("odom stream delivered 3 messages", odom.messages.length === 3, `got ${odom.messages.length}`);
const o0 = odom.messages[0]?.odom;
check("odom envelope has robot_id + status", odom.messages[0]?.robot_id === "amr_1" && !!odom.messages[0]?.status);
check(
  "odom payload has pose.position with numeric x/y",
  typeof o0?.pose?.pose?.position?.x === "number" &&
    typeof o0?.pose?.pose?.position?.y === "number",
  JSON.stringify(o0?.pose?.pose?.position),
);
check(
  "odom payload has orientation quaternion",
  ["x", "y", "z", "w"].every((k) => typeof o0?.pose?.pose?.orientation?.[k] === "number"),
);
check(
  "odom payload has twist.linear/angular",
  typeof o0?.twist?.twist?.linear?.x === "number" &&
    typeof o0?.twist?.twist?.angular?.z === "number",
);

/**
 * Odometry only advances while a velocity is commanded, so drive the robot over
 * the twist socket first — this also proves the two sockets share one
 * simulation, which is the behaviour that makes the UI's joystick feel live.
 */
const driver = new WebSocket(`${WS}/control_socket/robots/amr_1/ws/publish/twist`);
await new Promise((resolve) => {
  driver.onopen = () => {
    driver.send(JSON.stringify({ type: "twist", data: { linear: 0.4, angular: 0.2 } }));
    setTimeout(resolve, 50);
  };
  driver.onerror = resolve;
});

const moving = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/odom`, 6);
const firstX = moving.messages[0]?.odom?.pose?.pose?.position?.x;
const lastX = moving.messages.at(-1)?.odom?.pose?.pose?.position?.x;
check(
  "odometry advances while a twist is commanded",
  typeof firstX === "number" && firstX !== lastX,
  `x went ${firstX} -> ${lastX}`,
);
check(
  "commanded linear velocity is reflected in odom twist",
  Math.abs(moving.messages.at(-1)?.odom?.twist?.twist?.linear?.x - 0.4) < 1e-6,
  JSON.stringify(moving.messages.at(-1)?.odom?.twist?.twist?.linear),
);

// Stop the robot again so later assertions see a stationary, idle robot.
driver.send(JSON.stringify({ type: "twist", data: { linear: 0, angular: 0 } }));
await new Promise((r) => setTimeout(r, 80));
driver.close();

const diag = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/diagnostics`, 1);
const statuses = diag.messages[0]?.diagnostics?.status;
check("diagnostics has a status array", Array.isArray(statuses), JSON.stringify(diag.messages[0]));
check(
  "each diagnostic has the fields the UI renders",
  Array.isArray(statuses) &&
    statuses.every(
      (s) =>
        typeof s.level === "number" &&
        typeof s.name === "string" &&
        typeof s.message === "string" &&
        typeof s.hardware_id === "string",
    ),
  JSON.stringify(statuses?.[0]),
);

const map = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/map`, 1);
const info = map.messages[0]?.map?.info;
const mapData = map.messages[0]?.map?.data;
check("map has info.width/height/resolution",
  typeof info?.width === "number" && typeof info?.height === "number" && typeof info?.resolution === "number");
check(
  "map.data length === width * height (OccupancyGridViewer depends on this)",
  Array.isArray(mapData) && mapData.length === info.width * info.height,
  `data=${mapData?.length} expected=${info?.width * info?.height}`,
);
check(
  "map uses -1/0/100 cell values",
  mapData.every((v) => v === -1 || v === 0 || v === 100),
);

const tf = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/tf`, 1);
check("tf has a transforms array with parent/child frames",
  Array.isArray(tf.messages[0]?.tf?.transforms) &&
    tf.messages[0].tf.transforms.length > 0 &&
    typeof tf.messages[0].tf.transforms[0].child_frame_id === "string",
  JSON.stringify(tf.messages[0]?.tf?.transforms?.[0]?.child_frame_id),
);

const path = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/path`, 1);
check("path has a non-empty poses array",
  Array.isArray(path.messages[0]?.path?.poses) && path.messages[0].path.poses.length > 0);

// ─── WebSocket: offline rejection and unknown topics ─────────────────────────

console.log("\n--- websocket: failure branches ---");
const offlineStream = await collect(`${WS}/streaming_socket/go2_1/ws/subscribe/odom`, 1);
check(
  "offline robot -> {error:'robot not connected'} (the UI surfaces this)",
  offlineStream.errors.includes("robot not connected"),
  JSON.stringify(offlineStream.errors),
);

const unknownTopic = await collect(`${WS}/streaming_socket/amr_1/ws/subscribe/nope`, 1);
check("unknown topic -> error, not a hang", unknownTopic.errors.length > 0, JSON.stringify(unknownTopic.errors));

const unknownRobot = await collect(`${WS}/streaming_socket/nope/ws/subscribe/odom`, 1);
check("unknown robot -> error", unknownRobot.errors.length > 0, JSON.stringify(unknownRobot.errors));

// ─── WebSocket: twist control ────────────────────────────────────────────────

console.log("\n--- websocket: twist control ---");

function twistSession(robotId, sends) {
  return new Promise((resolve) => {
    const acks = [];
    const errors = [];
    const ws = new WebSocket(`${WS}/control_socket/robots/${robotId}/ws/publish/twist`);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ acks, errors });
    }, 4000);

    ws.onopen = () => {
      for (const payload of sends) ws.send(JSON.stringify(payload));
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) errors.push(data.error);
      else acks.push(data);
      if (acks.length + errors.length >= sends.length) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve({ acks, errors });
      }
    };
    ws.onclose = () => { clearTimeout(timer); resolve({ acks, errors }); };
    ws.onerror = () => { clearTimeout(timer); resolve({ acks, errors }); };
  });
}

const twist = await twistSession("amr_1", [
  { type: "twist", data: { linear: 0.25, angular: 0.1 } },
  { type: "twist", data: { linear: 0, angular: 0 } },
]);
check("valid twists acked with {status:'ok', type:'twist'}",
  twist.acks.length === 2 && twist.acks.every((a) => a.status === "ok" && a.type === "twist"),
  JSON.stringify(twist.acks));

const badCmd = await twistSession("amr_1", [{ type: "nonsense", data: {} }]);
check("unknown command type -> error", badCmd.errors.length === 1, JSON.stringify(badCmd.errors));

const badNum = await twistSession("amr_1", [{ type: "twist", data: { linear: "abc", angular: 0 } }]);
check("non-numeric twist -> error", badNum.errors.length === 1, JSON.stringify(badNum.errors));

const offlineTwist = await twistSession("go2_1", [{ type: "twist", data: { linear: 0, angular: 0 } }]);
check("twist to offline robot -> 'robot not connected'",
  offlineTwist.errors.includes("robot not connected"), JSON.stringify(offlineTwist.errors));

// The zero-twist-on-stop behaviour the UI relies on: final command must be zero.
const state = await req("GET", "/__sim/state");
const amrCommands = state.json?.recentCommands.filter((c) => c.robotId === "amr_1") ?? [];
check("server recorded twist commands",
  amrCommands.length >= 2, JSON.stringify(amrCommands));
check("last amr_1 command was the zero twist (stop sent before close)",
  amrCommands.at(-1)?.linear === 0 && amrCommands.at(-1)?.angular === 0,
  JSON.stringify(amrCommands.at(-1)));

// ─── Fault injection ─────────────────────────────────────────────────────────

console.log("\n--- fault injection ---");
await req("POST", "/__sim/robot/amr_1/offline");
const afterOffline = await req("GET", "/connection/amr_1/status", { token });
check("fault injection flips status to disconnected",
  !parseConnected(afterOffline.json?.message), afterOffline.json?.message);

await req("POST", "/__sim/robot/amr_1/online");
const afterOnline = await req("GET", "/connection/amr_1/status", { token });
check("fault injection restores connected", parseConnected(afterOnline.json?.message));

await req("POST", "/__sim/fleet/empty");
const emptyFleet = await req("GET", "/connection/robot_list", { token });
check("empty fleet -> 200 with EMPTY BODY (the real backend quirk)",
  emptyFleet.status === 200 && emptyFleet.text === "",
  `status=${emptyFleet.status} text=${JSON.stringify(emptyFleet.text)}`);

await req("POST", "/__sim/fleet/restore");
const restored = await req("GET", "/connection/robot_list", { token });
check("fleet restore -> array again", Array.isArray(restored.json));

await req("POST", "/__sim/connect-fails");
const failConn = await req("POST", "/connection/amr_1/connect", { body: { host: "1.2.3.4", port: 9090 } });
check("connect-fails fault -> 500", failConn.status === 500, `got ${failConn.status}`);
await req("POST", "/__sim/clear-faults");
const afterClear = await req("POST", "/connection/amr_1/connect", { body: { host: "192.168.1.219", port: 9090 } });
check("clear-faults restores connect -> 200", afterClear.status === 200, `got ${afterClear.status}`);

await req("POST", "/__sim/tokens/clear");
const expired = await req("GET", "/connection/robot_list", { token });
check("token clear -> 401 everywhere (drives the UI logout path)", expired.status === 401, `got ${expired.status}`);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(50)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log("=".repeat(50));
process.exit(fail === 0 ? 0 : 1);
