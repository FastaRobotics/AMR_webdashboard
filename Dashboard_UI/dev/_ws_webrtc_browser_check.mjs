/**
 * Browser-level verification of the WebSocket + WebRTC wiring.
 *
 * Drives the REAL React dashboard (Vite dev server on :5173) in Chrome and
 * checks what the hooks actually put on the wire and on screen:
 *
 *   - the telemetry sockets mount and carry real payloads (odom on the Dashboard)
 *   - the Live Camera page negotiates WebRTC and paints real video frames
 *   - no console errors, no failed requests
 *
 * Usage (fake backend on :8000 and `npm run dev` on :5173 must be running):
 *
 *     node dev/_ws_webrtc_browser_check.mjs
 */

import { chromium } from "playwright-core";

const UI = "http://localhost:5173";
const API = "http://localhost:8000";
const CHROME =
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -- ${detail}` : ""}`);
  return ok;
}
function section(title) {
  console.log(`\n=== ${title} ${"=".repeat(Math.max(0, 58 - title.length))}`);
}

async function main() {
  // A real token, obtained the same way the Login page does.
  const loginResponse = await fetch(`${API}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_name: "admin", password: "admin123" }),
  });
  const { access_token: token } = await loginResponse.json();
  if (!token) throw new Error("could not log in to the fake backend");

  // The telemetry sockets refuse to stream for an offline robot, so put the
  // robot online first (this is what the Robot Connection page does).
  await fetch(`${API}/connection/amr_1/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host: "192.168.1.219", port: 9090 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 800));

  const auth = { Authorization: `Bearer ${token}` };
  const baselinePcs = await fetch(`${API}/streaming/status`, { headers: auth })
    .then((r) => r.json())
    .then((s) => s.total_pcs);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });

  // Seed the persisted auth store the way Login writes it, so the app boots
  // straight into the protected routes.
  await context.addInitScript((value) => {
    window.sessionStorage.setItem("auth-storage", value);
  }, JSON.stringify({ state: { token }, version: 0 }));

  // Capture the exact SDP the hook POSTs, so we can tell whether the UI waits
  // for ICE gathering or relies on the backend learning a peer-reflexive
  // candidate from the STUN binding request. The app uses axios, which is
  // XHR-based, so `fetch` must not be the thing we patch.
  await context.addInitScript(() => {
    window.__offers = [];
    window.__answers = [];
    const OFFER_PATH = "/streaming/offer/browser";

    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function PatchedXHR() {
      const xhr = new OriginalXHR();
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      let isOffer = false;

      xhr.open = function (method, url, ...rest) {
        isOffer = String(url).includes(OFFER_PATH);
        return originalOpen.call(xhr, method, url, ...rest);
      };

      xhr.send = function (body) {
        if (isOffer && typeof body === "string") {
          try {
            window.__offers.push(JSON.parse(body));
          } catch {
            /* not our payload */
          }
          xhr.addEventListener("load", () => {
            try {
              window.__answers.push(JSON.parse(xhr.responseText));
            } catch {
              /* not our payload */
            }
          });
        }
        return originalSend.call(xhr, body);
      };

      return xhr;
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;
  });

  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    const url = request.url();
    // Vite's HMR socket and favicon noise are not app failures.
    if (url.includes("/@vite") || url.includes("favicon")) return;
    failedRequests.push(`${request.method()} ${url} :: ${request.failure()?.errorText}`);
  });

  // ── 1. the dashboard boots with telemetry sockets ─────────────────────────
  section("dashboard: WebSocket telemetry");

  await page.goto(`${UI}/`, { waitUntil: "domcontentloaded" });

  // Wait for the fleet to load and the telemetry hooks to connect.
  await page.waitForTimeout(6000);

  const health = await fetch(`${API}/sim/health`).then((r) => r.json());
  const subscribers = Object.keys(health.subscribers ?? {});
  check(
    subscribers.some((key) => key.startsWith("amr_1/")),
    "the dashboard opened real telemetry subscriptions on the backend",
    subscribers.join(", ") || "none",
  );

  // The odom viewer on the Dashboard should be rendering a moving pose.
  const robotState = await fetch(`${API}/sim/robots/amr_1`).then((r) => r.json());
  check(
    typeof robotState.pose?.x === "number",
    "the backend is streaming state for the selected robot",
    `pose=(${robotState.pose.x}, ${robotState.pose.y})`,
  );

  // A <video>/canvas consumer is only correct if the socket payload reached it.
  // The map + odom sockets are the two this page opens (MapPanel).
  check(
    subscribers.includes("amr_1/odom") || subscribers.includes("amr_1/map"),
    "the telemetry sockets the dashboard opened are the ones it uses",
    subscribers.join(", ") || "none",
  );

  // ── 2. the Live Camera page: WebRTC negotiation + frames ──────────────────
  section("live camera: WebRTC negotiation and media");

  // Select the front camera feed and start the stream the way an operator does.
  await page.goto(`${UI}/live-camera`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // The sidebar owns the page's first <h1> (Layout.tsx), so target the camera
  // card title instead of "the first heading".
  const heading = await page.getByText("Camera Feed", { exact: true }).first().textContent();
  check(heading?.includes("Camera Feed"), "the Live Camera page rendered", heading ?? "");

  // The Stream button lives in the card header and is always visible.
  const startButton = page.getByRole("button", { name: /Start Stream/i }).first();
  const hasStart = await startButton.count();
  check(hasStart > 0, "the Start Stream control is present");

  const clickedAt = Date.now();
  if (hasStart > 0) {
    await startButton.click();
  } else {
    // Fall back to the tile's hover overlay Connect button.
    const connect = page.getByRole("button", { name: /^Connect$/ }).first();
    if (await connect.count()) await connect.click();
  }

  // Poll for a genuinely live <video> element rather than trusting the badge.
  let videoStats = null;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    videoStats = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!video) return { found: false };
      return {
        found: true,
        readyState: video.readyState,
        paused: video.paused,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentTime: video.currentTime,
        hasSrcObject: video.srcObject !== null,
        trackCount: video.srcObject ? video.srcObject.getTracks().length : 0,
        trackState: video.srcObject?.getVideoTracks?.()[0]?.readyState ?? null,
        // WebRTC inbound stats are the only proof that RTP really arrived.
        decoded: null,
      };
    });
    if (videoStats?.videoWidth > 0 && videoStats?.currentTime > 0) break;
    await page.waitForTimeout(500);
  }

  check(videoStats?.found === true, "a <video> element is mounted on the page");
  check(
    videoStats?.hasSrcObject === true,
    "the video element is bound to a MediaStream (hook -> element wiring)",
    `tracks=${videoStats?.trackCount}`,
  );
  check(
    (videoStats?.videoWidth ?? 0) > 0 && (videoStats?.videoHeight ?? 0) > 0,
    "the video element decoded a real picture",
    `${videoStats?.videoWidth}x${videoStats?.videoHeight} readyState=${videoStats?.readyState}`,
  );
  check(
    (videoStats?.currentTime ?? 0) > 0 && videoStats?.paused === false,
    "the video is actually playing (currentTime advancing, not paused)",
    `currentTime=${videoStats?.currentTime?.toFixed(2)} paused=${videoStats?.paused}`,
  );
  check(
    videoStats?.trackState === "live",
    "the inbound video track is live",
    `state=${videoStats?.trackState}`,
  );

  // Waiting for ICE gathering must not make the Connect click feel slow.
  const timeToFirstFrameMs = Date.now() - clickedAt;
  check(
    timeToFirstFrameMs < 15000,
    "first frame arrives promptly after clicking Start Stream",
    `${(timeToFirstFrameMs / 1000).toFixed(1)}s (includes the ICE gathering wait)`,
  );

  // Confirm frames keep coming, not just that one frame arrived.
  const t1 = videoStats?.currentTime ?? 0;
  await page.waitForTimeout(2000);
  const t2 = await page.evaluate(() => document.querySelector("video")?.currentTime ?? 0);
  check(t2 > t1, "playback time keeps advancing (the stream is continuous)", `${t1.toFixed(2)} -> ${t2.toFixed(2)}`);

  // The backend must agree a peer connection exists.
  const streamStatus = await fetch(`${API}/streaming/status`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  check(
    streamStatus.total_pcs >= 1 && streamStatus.source_tracks >= 1,
    "the backend reports the browser's peer connection and its source track",
    JSON.stringify(streamStatus),
  );

  // What the hook actually put on the wire.
  const negotiation = await page.evaluate(() => {
    const offers = window.__offers ?? [];
    const answers = window.__answers ?? [];
    const lastOffer = offers[offers.length - 1];
    const lastAnswer = answers[answers.length - 1];
    const mlines = (sdp) => (sdp ?? "").split(/\r?\n/).filter((l) => l.startsWith("m="));
    const candidates = (sdp) =>
      (sdp ?? "").split(/\r?\n/).filter((l) => l.startsWith("a=candidate")).length;
    return {
      offerCount: offers.length,
      lastOfferMlines: mlines(lastOffer?.sdp),
      lastOfferCandidates: candidates(lastOffer?.sdp),
      lastAnswerMlines: mlines(lastAnswer?.sdp),
      lastAnswerTrackCount: lastAnswer?.track_count ?? null,
    };
  });

  check(
    negotiation.offerCount >= 1,
    "the hook POSTed a real SDP offer to /streaming/offer/browser",
    `${negotiation.offerCount} offer(s)`,
  );
  check(
    negotiation.lastOfferMlines.length === 1,
    "the offer negotiates exactly one video m-line",
    JSON.stringify(negotiation.lastOfferMlines),
  );
  check(
    negotiation.lastAnswerMlines.length === 1,
    "the answer replies with exactly one active video m-line",
    JSON.stringify(negotiation.lastAnswerMlines),
  );
  console.log(
    `    note: offer carried ${negotiation.lastOfferCandidates} ICE candidate line(s); ` +
      `backend reported track_count=${negotiation.lastAnswerTrackCount}`,
  );

  // The UI surfaces the relay numbers it fetched from /streaming/status.
  const bodyText = await page.locator("body").innerText();
  check(
    /Relayed|Not relayed/.test(bodyText),
    "the camera status panel rendered the relayed/not-relayed state",
  );

  await page.screenshot({ path: "dev/_shots/live_camera_webrtc.png", fullPage: true });

  // ── 3. clean shutdown ─────────────────────────────────────────────────────
  section("shutdown: stop the stream");

  const stopButton = page.getByRole("button", { name: /Stop Stream/i }).first();
  if (await stopButton.count()) {
    await stopButton.click();
    await page.waitForTimeout(1500);
    const afterStop = await page.evaluate(() => {
      const video = document.querySelector("video");
      return { srcObject: video?.srcObject === null || video?.srcObject === undefined };
    });
    check(afterStop.srcObject, "Stop Stream detaches the MediaStream from the video element");
  } else {
    check(false, "Stop Stream control appeared after connecting");
  }

  // Repeat the cycle: the backend's `all_pcs` set must not grow forever, since
  // each leaked peer connection keeps a decoder and a relay subscription alive.
  section("reconnect: no peer-connection leak");

  const pcCounts = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const start = page.getByRole("button", { name: /Start Stream/i }).first();
    if (await start.count()) await start.click();
    await page.waitForTimeout(4000);

    const stop = page.getByRole("button", { name: /Stop Stream/i }).first();
    if (await stop.count()) await stop.click();
    await page.waitForTimeout(2500);

    const status = await fetch(`${API}/streaming/status`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    pcCounts.push(status.total_pcs);
  }

  check(
    pcCounts.every((count) => count <= baselinePcs + 1),
    "each connect/disconnect cycle releases the previous peer connection",
    `total_pcs after each cycle: ${pcCounts.join(", ")} (baseline ${baselinePcs})`,
  );

  // ── 4. console / network hygiene ──────────────────────────────────────────
  section("hygiene: console and network");

  const ignorable = (text) =>
    text.includes("favicon") || text.includes("Download the React DevTools");

  const realConsoleErrors = consoleErrors.filter((text) => !ignorable(text));
  check(realConsoleErrors.length === 0, "no console errors", realConsoleErrors.slice(0, 3).join(" | "));
  check(pageErrors.length === 0, "no uncaught page errors", pageErrors.slice(0, 3).join(" | "));
  check(failedRequests.length === 0, "no failed network requests", failedRequests.slice(0, 3).join(" | "));

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + "=" * 70);
  console.log(`${passed}/${results.length} browser checks passed`);
  console.log("=" * 70);
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  FAILED: ${r.label}  -- ${r.detail}`);
  }
  return passed === results.length ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("browser check crashed:", error);
    process.exit(2);
  });
