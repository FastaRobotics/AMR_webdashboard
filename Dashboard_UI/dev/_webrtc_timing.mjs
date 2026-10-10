/**
 * Phase-by-phase timing of the Live Camera WebRTC handshake, measured inside
 * the real dashboard. Answers "where do the seconds go?" without guessing:
 * hook start -> offer POST -> answer -> ICE connected -> first frame.
 *
 *     node dev/_webrtc_timing.mjs
 */

import { chromium } from "playwright-core";

const UI = "http://localhost:5173";
const API = "http://localhost:8000";
const CHROME =
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const loginResponse = await fetch(`${API}/user/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ user_name: "admin", password: "admin123" }),
});
const { access_token: token } = await loginResponse.json();

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

await context.addInitScript((value) => {
  window.sessionStorage.setItem("auth-storage", value);
}, JSON.stringify({ state: { token }, version: 0 }));

// Wrap RTCPeerConnection so the handshake phases can be timed from outside the
// hook, without editing the hook.
await context.addInitScript(() => {
  window.__phases = [];
  const mark = (name) => window.__phases.push([name, performance.now()]);

  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = function TimedPC(...args) {
    const pc = new Original(...args);
    mark("pc.created");

    const originalSetLocal = pc.setLocalDescription.bind(pc);
    pc.setLocalDescription = async (...a) => {
      const result = await originalSetLocal(...a);
      mark(`setLocalDescription(${a[0]?.type ?? "?"})`);
      return result;
    };

    const originalSetRemote = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = async (...a) => {
      const result = await originalSetRemote(...a);
      mark(`setRemoteDescription(${a[0]?.type ?? "?"})`);
      return result;
    };

    pc.addEventListener("icegatheringstatechange", () => {
      mark(`iceGathering=${pc.iceGatheringState}`);
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      mark(`iceConnection=${pc.iceConnectionState}`);
    });
    pc.addEventListener("connectionstatechange", () => {
      mark(`connection=${pc.connectionState}`);
    });
    pc.addEventListener("track", () => mark("track"));

    return pc;
  };
  window.RTCPeerConnection.prototype = Original.prototype;

  // Time the signalling POST.
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function TimedXHR() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    let isOffer = false;
    xhr.open = function (method, url, ...rest) {
      isOffer = String(url).includes("/streaming/offer/browser");
      return originalOpen.call(xhr, method, url, ...rest);
    };
    xhr.send = function (body) {
      if (isOffer) {
        mark("offer.POST.start");
        xhr.addEventListener("load", () => mark("offer.POST.done"));
      }
      return originalSend.call(xhr, body);
    };
    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  // Time the first decoded frame actually painted.
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    mark("video.play");
    return originalPlay.apply(this, a);
  };
});

const page = await context.newPage();
await page.goto(`${UI}/live-camera`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  window.__phases = [];
  window.__t0 = performance.now();
});

const start = page.getByRole("button", { name: /Start Stream/i }).first();
await start.click();

// Wait for the first frame to be decoded.
const deadline = Date.now() + 40000;
let firstFrameAt = null;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const video = document.querySelector("video");
    return { t: performance.now(), w: video?.videoWidth ?? 0, ct: video?.currentTime ?? 0 };
  });
  if (state.w > 0 && state.ct > 0) {
    firstFrameAt = state.t;
    break;
  }
  await page.waitForTimeout(50);
}

const phases = await page.evaluate(() => window.__phases);
const t0 = await page.evaluate(() => window.__t0);

console.log("\nLive Camera WebRTC handshake phases (ms from Start Stream click):\n");
let last = t0;
for (const [name, at] of phases) {
  const rel = at - t0;
  const delta = at - last;
  console.log(`  ${rel.toFixed(0).padStart(6)} ms  (+${delta.toFixed(0).padStart(5)} ms)  ${name}`);
  last = at;
}
if (firstFrameAt) {
  console.log(
    `  ${(firstFrameAt - t0).toFixed(0).padStart(6)} ms  (+${(firstFrameAt - last).toFixed(0).padStart(5)} ms)  FIRST DECODED FRAME`,
  );
} else {
  console.log("  no decoded frame within 40s");
}

await browser.close();
