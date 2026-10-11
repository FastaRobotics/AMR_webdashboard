# dev/ — local verification harness

Development-only tooling. **Do not deploy or commit these files** to the
repository that ships the dashboard.

## Why this exists

The dashboard talks to a FastAPI backend that in turn talks to a robot over
rosbridge. To click through the UI you would otherwise need all three:

1. the Python backend running (it cannot start in this checkout — `jose`,
   `passlib`, `bcrypt`, `aiortc` and `uvicorn` are missing and PyPI is
   unreachable), and
2. a reachable rosbridge/ROS 2 robot, and
3. a browser.

`fake-robot.mjs` replaces (1) and (2) with one Node process, so only the browser
is needed. The React app is **unchanged and unaware** — it still talks to
`http://localhost:8000` and `ws://localhost:8000`, so this exercises the real
axios client, auth interceptor, both WebSocket hooks, the shared robot store and
all the retry/error branches.

## Run it

```bash
# terminal 1 — the fake robot + fake backend
node dev/fake-robot.mjs

# terminal 2 — the dashboard
npm run dev
```

`.env` already points `VITE_BACKEND_URL` at `http://localhost:8000`.

Log in with any of:

| user | password |
|---|---|
| `savitar` | `Erfan25` |
| `erfan` | `erfan123` |
| `safar` | `safar123` |

## What gets simulated

| Area | Behaviour |
|---|---|
| `amr_1` | starts **connected**, `idle`; odometry moves when commanded |
| `go2_1` | starts **offline**, so the disconnected branches are visible immediately |
| `/connection/robot_list` | real id/type pairs; empty-fleet quirk reproduced (200 with an empty body) |
| odom / tf / map / path / diagnostics | streamed at the real backend's cadences (10 Hz, 2 Hz) with ROS-shaped payloads |
| `twist` socket | commands drive the simulation, so the joystick visibly moves the odometry |
| services | mapping/navigation/recording return `{success, message}`; offline robots return the backend's "Not connected." 500 |
| auth | login issues a token; protected routes return FastAPI-shaped 401 `{detail}` |

## Fault injection

This is the part that makes it a real test — the happy path alone cannot prove
the UI degrades correctly.

```bash
curl -X POST localhost:8000/__sim/reset                  # back to power-on state
curl       localhost:8000/__sim/state                    # inspect current state

curl -X POST localhost:8000/__sim/robot/amr_1/offline     # robot goes away mid-session
curl -X POST localhost:8000/__sim/robot/amr_1/online

curl -X POST localhost:8000/__sim/fleet/empty             # no robots at all
curl -X POST localhost:8000/__sim/fleet/restore

curl -X POST localhost:8000/__sim/connect-fails           # connect -> 500
curl -X POST localhost:8000/__sim/clear-faults

curl -X POST localhost:8000/__sim/tokens/clear            # 401 everywhere -> logout path
```

`/__sim/robot/:id/offline` also drops any live WebSocket for that robot with
`{"error":"robot not connected"}` then closes it, so you can watch the streaming
hooks hit their error branch rather than quietly repeating the last frame.

## Regression check

```bash
# WebSocket + WebRTC against the REAL Python backend (recommended):
#   fake_backend:  .venv/Scripts/python.exe api.py
#   dashboard:     npm run dev
node dev/_ws_webrtc_browser_check.mjs     # 22 checks in real Chrome
node dev/_webrtc_timing.mjs               # phase-by-phase handshake timings
node dev/_foxglove_viewer_check.mjs       # 14 checks: the Manual Control 3D viewer

# REST/WS contract against the Node stand-in (no Python needed):
node dev/fake-robot.mjs &     # must be running first
node dev/_e2e_check.mjs
```

`_ws_webrtc_browser_check.mjs` drives the actual React app in Chrome and asserts
what the hooks put on the wire and on screen:

* the Dashboard's telemetry sockets open real backend subscriptions;
* **Live Camera** negotiates WebRTC and the `<video>` element reports
  `videoWidth > 0`, a `live` track and an advancing `currentTime` — i.e. decoded
  frames, not just a negotiated track;
* the SDP the hook POSTs has exactly one video m-line and (since the ICE
  gathering fix) carries real `a=candidate` lines;
* repeated Start/Stop cycles do not leak peer connections on the backend;
* no console errors and no failed requests.

`_foxglove_viewer_check.mjs` covers the Manual Control page's `<FoxgloveViewer />`
(a `MapPanel`). It drives the robot to a known pose over the twist socket, loads
the page, and reads the canvas pixel by pixel to prove the panel is not blank and
that the geometry is right: the robot marker is found by colour within 3 px of the
canvas centre, its size matches the 11 px arrow from `drawRobot`, and the trail
chip grows while the robot drives. It is theme-aware, because `MapPanel` picks
between `LIGHT_THEME` and `DARK_THEME` from `<html class="dark">` and the two use
different background *and* marker colours.

`_e2e_check.mjs` has 57 assertions covering auth, fleet, connect/disconnect,
offline 500s, the recording body shape, emergency stop, all five streaming
topics, every WebSocket failure branch, twist ack/reject behaviour, and each
fault-injection route.

It calls `/__sim/reset` first, so it is repeatable, and it imports the real
`parseConnectionMessage` from `src/api/config.ts` (with a preflight so a broken
extraction fails loudly instead of passing vacuously).

## Known limits

- **`dev/fake-robot.mjs` has no WebRTC**, so with the Node stand-in the camera
  page stays a local canvas placeholder. Against the Python `fake_backend` it is
  fully live — see the regression check above.
- **No real rosbridge protocol.** This simulates the backend's REST/WS surface
  rather than the rosbridge protocol behind it, so a bug in `roslibpy` usage or
  the `Robot` class would not be caught here. That would need a working Python
  environment and a real rosbridge.
- **Passwords are plain strings.** The real backend uses passlib bcrypt; this
  compares literals so it needs no crypto dependency.
