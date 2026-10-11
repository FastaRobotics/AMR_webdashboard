/**
 * Verifies that Manual Control's <FoxgloveViewer /> (a MapPanel) actually draws
 * live telemetry, and that the drawing is geometrically correct.
 *
 * The bug this guards against: the `map` topic only carries an OccupancyGrid
 * while mapping/exploring/navigation runs, so a merely-connected robot used to
 * render a completely blank canvas with "Waiting for the first map frame…".
 *
 *     node dev/_foxglove_viewer_check.mjs
 */

import { chromium } from "playwright-core";
import { WebSocket } from "ws";

const UI = "http://localhost:5173";
const API = "http://localhost:8000";
const WS = "ws://localhost:8000";
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -- ${detail}` : ""}`);
  return ok;
}
function section(title) {
  console.log(`\n=== ${title} ${"=".repeat(Math.max(0, 58 - title.length))}`);
}

/**
 * Read the canvas, detect the active theme, and locate the robot marker.
 *
 * MapPanel has two themes (`LIGHT_THEME` / `DARK_THEME`) selected from
 * `<html class="dark">`, and they differ in both the background and `robotFill`,
 * so the colours cannot be hardcoded. The theme is identified by the modal
 * background colour first.
 */
const READ_CANVAS = () => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return { found: false };

  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;

  const THEMES = {
    light: { background: [248, 250, 252], robot: [249, 115, 22] }, // #f8fafc / #f97316
    dark: { background: [11, 18, 32], robot: [251, 146, 60] }, // #0b1220 / #fb923c
  };

  // Tally the two candidate backgrounds to decide the theme.
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let themeName = "light";
  let bestBackground = -1;
  for (const [name, theme] of Object.entries(THEMES)) {
    const key = theme.background.join(",");
    const n = counts.get(key) ?? 0;
    if (n > bestBackground) {
      bestBackground = n;
      themeName = name;
    }
  }

  const theme = THEMES[themeName];
  let robotX = 0;
  let robotY = 0;
  let robotN = 0;
  let backgroundN = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (Math.abs(r - theme.background[0]) <= 1 && Math.abs(g - theme.background[1]) <= 1 && Math.abs(b - theme.background[2]) <= 1) {
        backgroundN += 1;
      } else if (Math.abs(r - theme.robot[0]) <= 2 && Math.abs(g - theme.robot[1]) <= 2 && Math.abs(b - theme.robot[2]) <= 2) {
        robotX += x;
        robotY += y;
        robotN += 1;
      }
    }
  }

  return {
    found: true,
    theme: themeName,
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    width,
    height,
    distinctColours: counts.size,
    // Everything that is not the plain background: grid, axes, marker, scale bar.
    paintedFraction: 1 - backgroundN / (width * height),
    robot: robotN > 0 ? { x: robotX / robotN, y: robotY / robotN, pixels: robotN } : null,
  };
};

async function main() {
  const login = await fetch(`${API}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_name: "admin", password: "admin123" }),
  }).then((r) => r.json());
  const token = login.access_token;

  await fetch(`${API}/connection/amr_1/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host: "192.168.1.219", port: 9090 }),
  });
  // Park the robot at its spawn pose so the expected geometry is deterministic.
  await fetch(`${API}/sim/engine/reset?robot_id=amr_1`, { method: "POST" });
  await new Promise((r) => setTimeout(r, 1000));

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await context.addInitScript((value) => {
    window.sessionStorage.setItem("auth-storage", value);
  }, JSON.stringify({ state: { token }, version: 0 }));

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  /**
   * Drive the robot to a distinctive pose BEFORE loading the page.
   *
   * The live-pose view is centred on the robot at mount, and the assertion below
   * compares the marker's canvas position with the pose the backend reports at
   * the same instant. Doing this while the robot is parked makes that comparison
   * exact instead of racy.
   */
  const drive = new WebSocket(`${WS}/control_socket/robots/amr_1/ws/publish/twist`);
  await new Promise((resolve, reject) => {
    drive.on("open", resolve);
    drive.on("error", reject);
  });

  // A short arc so the robot leaves its spawn pose and is still turning when we
  // release — the robot is parked again before the page loads.
  const driveUntil = Date.now() + 4000;
  while (Date.now() < driveUntil) {
    drive.send(JSON.stringify({ type: "twist", data: { linear: 0.4, angular: 0.7 } }));
    await new Promise((r) => setTimeout(r, 60));
  }
  drive.close();
  await new Promise((r) => setTimeout(r, 1200));

  section("FoxgloveViewer renders without a map");

  await page.goto(`${UI}/manual-control`, { waitUntil: "domcontentloaded" });

  /**
   * Wait until the panel has drawn its robot marker.
   *
   * The first odometry frame arrives a moment after the socket opens (the
   * backend no longer sends a null placeholder frame), so the live-pose view
   * cannot exist on the very first paint. Poll rather than sleep a fixed time.
   */
  // The page's own telemetry must be live before the canvas can be judged: the
  // Vite dev server occasionally reloads modules (HMR) right after load, which
  // tears the sockets down and re-opens them. Wait for the destination, not for
  // a fixed delay.
  const subsDeadline = Date.now() + 25000;
  let subs = {};
  while (Date.now() < subsDeadline) {
    subs = await fetch(`${API}/sim/health`).then((r) => r.json()).then((h) => h.subscribers ?? {});
    if (subs["amr_1/odom"] && subs["amr_1/map"] && subs["amr_1/path"]) break;
    await page.waitForTimeout(400);
  }

  check(
    Boolean(subs["amr_1/odom"]),
    "the page's odom subscription is live on the backend (precondition)",
    JSON.stringify(subs),
  );

  const parked = await fetch(`${API}/sim/robots/amr_1`).then((r) => r.json());
  let canvas = null;
  const readyDeadline = Date.now() + 20000;
  while (Date.now() < readyDeadline) {
    canvas = await page.evaluate(READ_CANVAS);
    if (canvas.robot !== null) break;
    await page.waitForTimeout(300);
  }

  check(
    parked.map.topic_available === true && parked.map.active === false,
    "the backend offers a map topic but is publishing no grid (so a blank panel would be the UI's fault)",
    `topic_available=${parked.map.topic_available} active=${parked.map.active}`,
  );

  check(canvas.found === true, "the panel mounted a <canvas>");
  check(
    canvas.paintedFraction > 0.02,
    "the canvas is actually painted (was 0% before the live-pose view)",
    `${(canvas.paintedFraction * 100).toFixed(2)}% of pixels drawn, ${canvas.distinctColours} colours, ${canvas.theme} theme`,
  );
  check(
    canvas.robot !== null && canvas.robot.pixels > 30,
    "the robot marker is drawn on the canvas",
    canvas.robot ? `${canvas.robot.pixels} px at (${canvas.robot.x.toFixed(1)}, ${canvas.robot.y.toFixed(1)})` : "not found",
  );

  section("geometry is correct, not decorative");

  // The component's contract: scale = min(w,h)/16 and the robot centred, so a
  // marker anywhere else means the transform is not the one documented.
  const span = 16;
  const scale = Math.min(canvas.cssWidth, canvas.cssHeight) / span;
  const expectedRobotX = canvas.cssWidth / 2;
  const expectedRobotY = canvas.cssHeight / 2;
  const pose = parked.pose;

  console.log(
    `    canvas ${canvas.cssWidth}x${canvas.cssHeight} css, scale ${scale.toFixed(2)} px/m, robot pose (${pose.x}, ${pose.y})`,
  );

  const markerTolerance = 3;
  check(
    canvas.robot !== null && Math.abs(canvas.robot.x - expectedRobotX) <= markerTolerance,
    "the robot marker is horizontally centred in the live-pose view",
    `measured ${canvas.robot?.x.toFixed(1)}, expected ${expectedRobotX.toFixed(1)}`,
  );
  check(
    canvas.robot !== null && Math.abs(canvas.robot.y - expectedRobotY) <= markerTolerance,
    "the robot marker is vertically centred in the live-pose view",
    `measured ${canvas.robot?.y.toFixed(1)}, expected ${expectedRobotY.toFixed(1)}`,
  );

  // The marker's own size is a sanity check that it is the 11 px arrow from
  // `drawRobot` and not some other orange element.
  check(
    canvas.robot !== null && canvas.robot.pixels >= 30 && canvas.robot.pixels <= 200,
    "the marker is the size of the drawn robot arrow",
    `${canvas.robot?.pixels} px`,
  );

  const stripText = await page.locator("body").innerText();
  const region = stripText.split("3D Viewer & Camera Feed")[1]?.split("Control Interface")[0] ?? "";
  check(
    /trail\s+[\d.]+\s*m\s*\/\s*\d+\s*pts/.test(region),
    "the status strip reports the live trail distance and sample count",
    (region.match(/trail[^\n]*/) ?? ["not found"])[0],
  );

  section("the view is live: it follows the robot");

  // Baseline the trail while the robot is still parked.
  const parkedRegion = (await page.locator("body").innerText())
    .split("3D Viewer & Camera Feed")[1]
    ?.split("Control Interface")[0] ?? "";
  const parkedTrail = Number((parkedRegion.match(/trail\s+([\d.]+)\s*m/) ?? [0, "0"])[1]);

  // Drive with the teleoperation socket, exactly as the joystick does.
  const socket = new WebSocket(`${WS}/control_socket/robots/amr_1/ws/publish/twist`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    socket.send(JSON.stringify({ type: "twist", data: { linear: 0.45, angular: 0.6 } }));
    await new Promise((r) => setTimeout(r, 60));
  }
  socket.close();
  await page.waitForTimeout(1500);

  const canvasAfter = await page.evaluate(READ_CANVAS);
  const stateAfter = await fetch(`${API}/sim/robots/amr_1`).then((r) => r.json());

  check(
    Math.hypot(stateAfter.pose.x - pose.x, stateAfter.pose.y - pose.y) > 0.5,
    "the twist commands actually moved the simulated robot",
    `(${pose.x}, ${pose.y}) -> (${stateAfter.pose.x}, ${stateAfter.pose.y})`,
  );

  const afterRegion = (await page.locator("body").innerText())
    .split("3D Viewer & Camera Feed")[1]
    ?.split("Control Interface")[0] ?? "";
  const trailMatch = afterRegion.match(/trail\s+([\d.]+)\s*m\s*\/\s*(\d+)\s*pts/);
  const drivenTrail = Number(trailMatch?.[1] ?? 0);
  const drivenPoints = Number(trailMatch?.[2] ?? 0);

  check(
    trailMatch !== null && drivenTrail > parkedTrail + 0.3 && drivenPoints > 3,
    "the trail grows as the robot drives",
    `${parkedTrail.toFixed(1)} m -> ${drivenTrail.toFixed(1)} m over ${drivenPoints} points`,
  );
  check(
    /pose\s+-?[\d.]+,\s*-?[\d.]+/.test(afterRegion),
    "the status strip shows the robot's live pose",
    (afterRegion.match(/pose[^\n]*/) ?? ["not found"])[0],
  );
  check(
    canvasAfter.robot !== null && canvasAfter.paintedFraction > 0.02,
    "the marker is still drawn and the canvas still painted after driving",
    `marker ${canvasAfter.robot?.pixels ?? 0} px, ${(canvasAfter.paintedFraction * 100).toFixed(1)}% painted`,
  );

  await page.screenshot({ path: "dev/_shots/manual_control_foxglove.png", fullPage: true });

  section("hygiene");
  const real = consoleErrors.filter((t) => !t.includes("favicon") && !t.includes("DevTools"));
  check(real.length === 0, "no console errors", real.slice(0, 2).join(" | "));

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + "=" * 70);
  console.log(`${passed}/${results.length} FoxgloveViewer checks passed`);
  console.log("=" * 70);
  for (const r of results.filter((r) => !r.ok)) console.log(`  FAILED: ${r.label}  -- ${r.detail}`);
  return passed === results.length ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("check crashed:", error);
    process.exit(2);
  });
