/**
 * Regression: pages that do NOT opt into `showLivePose` must keep MapPanel's
 * original map-oriented empty state, and must not error.
 *
 *     node dev/_mappanel_pages_check.mjs
 */
import { chromium } from "playwright-core";

const UI = "http://localhost:5173";
const API = "http://localhost:8000";
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -- ${detail}` : ""}`);
};

const token = await fetch(`${API}/user/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ user_name: "admin", password: "admin123" }),
}).then((r) => r.json()).then((b) => b.access_token);

await fetch(`${API}/connection/amr_1/connect`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ host: "192.168.1.219", port: 9090 }),
});
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
await context.addInitScript((v) => window.sessionStorage.setItem("auth-storage", v),
  JSON.stringify({ state: { token }, version: 0 }));

// Pages that mount a MapPanel and did NOT opt into the live-pose view.
// (The Dashboard is not one of them — it draws no map.)
const pages = [
  { path: "/mapping", name: "Mapping" },
  { path: "/navigation", name: "Navigation" },
  { path: "/mission-control", name: "Mission Control" },
];

for (const target of pages) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon") && !m.text().includes("DevTools")) {
      errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${UI}${target.path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    let painted = 0;
    let colours = 0;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        if (data[i + 3] !== 0) painted += 1;
      }
      colours = seen.size;
    }
    return {
      hasCanvas: Boolean(canvas),
      painted,
      colours,
      // The original empty state must still be shown on these pages, since none
      // of them opts into the live-pose view.
      showsWaitingForMap: document.body.innerText.includes("Waiting for the first map frame"),
    };
  });

  check(errors.length === 0, `${target.name}: renders without console errors`, errors.slice(0, 2).join(" | "));
  check(
    info.showsWaitingForMap,
    `${target.name}: MapPanel keeps its map-oriented empty state (no live-pose opt-in)`,
    `waiting-for-map=${info.showsWaitingForMap} colours=${info.colours}`,
  );

  await page.close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} MapPanel page checks passed`);
process.exit(passed === results.length ? 0 : 1);
