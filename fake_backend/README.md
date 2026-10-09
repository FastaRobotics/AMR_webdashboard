# Fake backend — the Fasta dashboard API with simulated robots

A drop-in replacement for `backend/` that answers **exactly the same API** as the
real FastAPI backend, but with a robot simulation behind it instead of
rosbridge/ROS. Nothing else is needed to exercise `Dashboard_UI`: no ROS, no
robots, no network.

```
Dashboard_UI  ──HTTP/WS──►  fake_backend  ──►  simulation  (warehouse, SLAM, nav2, sensors)
```

* Every REST path, WebSocket path, request body, status code and response shape
  the dashboard uses is reproduced — including the quirks (see
  [Fidelity](#fidelity-what-is-reproduced-and-how)).
* `amr_1` and `go2_1` are simulated with the real per-robot topic/service enums,
  so capability differences (`go2_1` has no SLAM map) behave the same way.
* Robots publish real ROS-shaped payloads: `nav_msgs/Odometry`,
  `tf2_msgs/TFMessage`, `nav_msgs/OccupancyGrid`, `diagnostic_msgs/DiagnosticArray`,
  `nav_msgs/Path`, `sensor_msgs/Imu|BatteryState|PointCloud2|CompressedImage`.
* The synthetic robot really moves: SLAM builds the map from a simulated lidar,
  frontier exploration drives itself around the warehouse, navigation plans with
  A* and follows the path, and `/cmd_vel` from the joystick drives the base.

---

## Quick start

```powershell
# Windows
pwsh -File fake_backend/run.ps1              # port 8000, creates .venv on first run
```

```bash
# Linux / macOS
./fake_backend/run.sh
```

Then start the dashboard (its `.env` already points at `http://localhost:8000`):

```bash
cd Dashboard_UI
npm install     # once
npm run dev     # http://localhost:5173
```

Keep the backend in a terminal you leave open: it runs in the foreground and stops
with Ctrl+C. If uvicorn is started from another tool or session that exits, the
process goes away with it — the dashboard then reports "Cannot reach the backend".

Log in with a seeded account (printed in the startup banner):

| user | password |
| --- | --- |
| `admin` | `admin123` |
| `operator` | `operator123` |
| `demo` | `demo123` |

Suggested first run: **Robot Connection** → *Connect* `amr_1` → **Mapping** →
*Start Mapping*, drive with the joystick on **Manual Control**, then *Stop
Mapping* to save the map, then **Navigation** with `map_name = latest`.

### Running by hand

```bash
cd fake_backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt          # or bin/python
.venv/Scripts/python.exe -m pip install -r requirements-webrtc.txt   # optional: aiortc
.venv/Scripts/python.exe -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

`aiortc` is optional: without it `/streaming/offer/*` answers 501 and everything
else (including every WebSocket the dashboard uses) works normally.

### Swagger UI and the API docs

FastAPI generates the docs for free — same URLs as the real backend:

| URL | What it is |
| --- | --- |
| <http://127.0.0.1:8000/docs> | Swagger UI: browse and *Try it out* every endpoint |
| <http://127.0.0.1:8000/redoc> | ReDoc: read-only, nicer for printing/searching |
| <http://127.0.0.1:8000/openapi.json> | the raw OpenAPI 3.1 schema (39 paths) |

To call the locked endpoints from Swagger:

1. **Authorize** (top right) → user name `admin`, password `admin123` → *Authorize* → *Close*.
   Swagger posts those to `/user/login` as OAuth2 password-flow form data; this
   backend accepts that *and* the JSON body the dashboard sends. (The real
   backend only accepts JSON there, which is why its Authorize button fails.)
2. Every padlock is now unlocked — e.g. `GET /connection/robot_list`.

Endpoints that need no token at all, for quick poking: `POST /connection/{robot_id}/{connect|disconnect}`,
`POST /navigation/{robot_id}/emergency_stop/{state}`, everything under `/sim`, and `GET /docs` itself.

Swagger UI loads its JavaScript from `cdn.jsdelivr.net`; if the page renders
blank, the CDN is blocked on your network — use `/redoc` or `/openapi.json`
instead (both are self-contained enough to work offline), or fetch a token with
`curl` and drive the API directly:

```bash
TOKEN=$(curl -s -X POST localhost:8000/user/login -H 'content-type: application/json' \
        -d '{"user_name":"admin","password":"admin123"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s localhost:8000/connection/robot_list -H "Authorization: Bearer $TOKEN"
```

---

## What is simulated

### The world (`simulation/world.py`)

A 16 × 10 m warehouse at 0.05 m/cell (320 × 200 cells), deterministic layout:
outer walls, four storage racks with 1.2 m aisles, a store room with a 1 m
doorway, three pillars and a charging dock. It deliberately contains the four
waypoints the Navigation page lists (`charging_station` (2.5, 1.2),
`loading_dock`, `storage_area_a`, `inspection_point`).

`GET /sim/robots/amr_1/map.png?source=world` renders it as a PNG, which is handy
as ground truth to compare the dashboard's SLAM view against.

### The robots (`simulation/state.py`)

| Behaviour | How it works |
| --- | --- |
| Motion | unicycle model with a first-order velocity ramp, collision-checked against the world (blocked motion slides, it never clips through a wall) |
| `cmd_vel` | operator commands win over autonomous tasks, with a 0.5 s deadman switch (`FAKE_CMD_VEL_TIMEOUT_S`): when it fires the base stops immediately, the way a real controller commands zero |
| SLAM | 72-ray lidar sweep (6 m range, 10 Hz) fused into an `OccupancyGrid` kept in ROS row-major order; `-1` unknown, `0` free, `100` occupied |
| Mapping | while `task == "mapping"` the robot only scans — it moves when the joystick moves it, exactly like a real SLAM session |
| Exploring | frontier exploration: BFS over the mapped cells picks a reachable frontier at least 1.5 m away, A* plans to it, the robot drives and re-plans; targets that turn out to be unreachable are remembered and avoided |
| Navigation | A* over the loaded map, pure-pursuit following, final heading alignment, arrival within ~0.15 m |
| Maps | stopping mapping saves the current map under `map_name`; `latest` plus the three names the Mapping page shows are pre-seeded so `start_with_map` works immediately |
| Diagnostics | 11 services with real levels (0 OK / 1 WARN / 2 ERROR / 3 STALE) that follow the simulation: battery warnings, "emergency stop ENGAGED", nav/mapping/rosbag stale-when-idle |
| Battery | drains at `FAKE_BATTERY_DRAIN_PER_MIN` (0.4 %/min by default) with voltage sag, current and temperature that follow the load |
| Recording | rosbag registry with duration/size, duplicate-start rejection, delete |
| Go2 | quadruped body height/bob reflected in odom z, tf and imu; no map, no `diagnostics`/`path` topic, no `start_navigation_with_map`, no recording services (mirrors its real enums) |
| WebRTC | `aiortc` signalling with a synthetic animated camera track as the relay source, plus a working viewer page at `/streaming/viewer` |

### Telemetry rates

| Topic | Robot publishes | WS pushes |
| --- | --- | --- |
| `odom`, `tf` | 20 Hz | 10 Hz |
| `diagnostics`, `path` | 2 Hz | 2 Hz |
| `map` | 5 Hz | 2 Hz |
| `imu`, `battery_state`, `point_cloud`, compressed images | on demand (`/sim/.../telemetry/{topic}`) | not exposed by the real API either |

The map frame is a full 320 × 200 grid (~250 KB of JSON), so its WebSocket
stream is deliberately limited to 2 Hz. Odom and transforms stay at 10 Hz for
responsive robot movement. Every other topic is a few kB.

---

## Fidelity: what is reproduced, and how

Endpoint-by-endpoint parity is enforced by `tools/smoke_test.py`, which replays
the exact calls in `Dashboard_UI/src/api/routes.ts` (same bodies, same headers,
same token handling) and asserts the shapes declared in
`Dashboard_UI/src/api/types.ts`.

| Real backend file | Fake backend file | Notes |
| --- | --- | --- |
| `api.py` | `api.py` | same title/description/version, same CORS, same router set and order |
| `robot.py`, `amr_robot.py`, `go2_robot.py` | same names | same class surface; `Ros` is `sim_roslibpy.Ros` |
| `ros_bridge/publisher.py`, `subscriber.py`, `service_client.py` | same names | one import line differs (`sim_roslibpy`) |
| `ros_bridge/AMR/*`, `ros_bridge/go2/*` | same names | verbatim copies, including the typos in the real enums |
| `ros_bridge/connection/ConnectRequest.py` | same | verbatim |
| `routers/users.py`, `connection.py`, `mapping.py`, `navigation.py`, `record.py`, `control.py`, `streaming_ws.py`, `streaming.py` | same names | same routes, bodies, status codes |
| `routers/dashboard.py` | *not mounted* | the real `api.py` never mounts it either (it 404s in both) |
| `routers/auth.py` | `routers/auth.py` | same JWT claims/secret; crypto is stdlib PBKDF2 + HS256 instead of passlib + python-jose |
| `ros_bridge/msgs/*`, `ros_bridge/srv/*` | *omitted* | unused pydantic DTOs in the real backend, with broken imports there |

Wire-level details that are preserved because the UI depends on them:

* `GET /connection/{robot_id}/status` returns a **human string**, not a boolean —
  `"Connection status for amr_1: Connected"` / `"…: Disconnected"`, which the UI
  parses with `/:\s*Connected\b/i`.
* A `Robots` path enum, so an unknown robot id is a **422**, not a 404.
* `POST /recording/{robot_id}/start` takes a **bare JSON string** body
  (`JSON.stringify(rosbagName)` from the UI).
* `POST /mapping/{robot_id}/stop` and `/navigation/{robot_id}/start_with_map`
  take an embedded object body; `/connection/{robot_id}/{connect|disconnect}`
  takes `{host, port}`.
* A disconnected robot answers service endpoints with **500** and reason
  `"[amr_1] Cannot call service: Not connected."`, and streaming sockets with
  `{"error": "robot not connected"}` followed by a close.
* `/connection/{robot_id}/connect`, `/connection/{robot_id}/disconnect` and
  `/navigation/{robot_id}/emergency_stop/{state}` are **unauthenticated**, as in
  the real backend (its `Depends(get_current_user)` is commented out there).
* `map`/`odom`/`tf`/`diagnostics`/`path` sockets use the real envelope
  `{"robot_id", "status", "…"}` and the real sleep values (0.1 s / 0.5 s).

### Deviations from the real backend

The real backend has several latent bugs. The fake backend keeps the *contract*
identical but fixes the behaviour, so the dashboard is tested against a backend
that works. Each fix is noted in the source next to the code it replaces.

| # | Real behaviour | Fake behaviour |
| --- | --- | --- |
| 1 | `GET /connection/{id}/status` calls `self.ros.is_connected()` although roslibpy defines it as a **property** → `TypeError` → HTTP 500 for any robot that has ever connected, so the fleet list can never show "Connected" | returns the correct `Connected`/`Disconnected` message |
| 2 | `map`/`diagnostics`/`path` sockets on `go2_1` raise `AttributeError` (its `SubscribableTopics` has no such member) → the browser sees an abnormal 1006 close and retries five times | `{"error": "topic 'map' is not available on robot 'go2_1'"}` then a clean close |
| 3 | Go2 services that do not exist (`start_navigation_with_map`, recording) raise `AttributeError` → 500 with a Python traceback string | 500 with `"[go2_1] service 'start_recording' is not available on this robot"` |
| 4 | `Robot.__init__(robot_id, port, host)` is called positionally as `super().__init__(robot_id, host, port)`, so `self.host` holds the port number and `self.port` the host string; hidden only because the UI always sends both | forwarded by keyword, so the configured address is correct when the client omits one |
| 5 | a scalar `/cmd_vel` payload (`{"linear": 0.4}` — what the UI sends) is published as a malformed Twist | both scalars and ROS vectors are accepted and drive the base |
| 6 | `start_navigation` marks the robot **idle** while navigating | reports `run_task` |
| 7 | `recording_status` truncates the service message with `.split(" ")[0]` | returns the message plus structured `recording`/`rosbag_name`/`duration_s`/`rosbags` fields |
| 8 | `DELETE /mapping/{id}/delete` and `POST /mapping/{id}/save_location` return a hardcoded message and do nothing | they call the delete service and report the saved pose (superset response) |
| 9 | `GET /streaming/viewer` opens `routers/viewer.html`, which is not in the repository → always 500 | ships `static/viewer.html`, a working WebRTC viewer |
| 10 | status flips to `run_task`/`idle` even when a service reports `success: false`; a self-finishing task leaves the status stuck at `run_task` | status follows the service result and returns to `idle` when a goal is reached or exploration ends |
| 11 | `str(Robots.AMR_1)` leaks into the status message as `"Robots.AMR_1"` | the message and socket errors use `amr_1` |
| 12 | `database/users.db` is resolved against the process working directory | resolved next to the code |
| 13 | no CORS/auth changes | identical |
| 14 | `POST /user/login` only accepts a JSON body, so the API docs' *Authorize* button (OAuth2 password flow, form-encoded) cannot work | also accepts form-encoded `username`/`password`; JSON behaviour and all status codes are unchanged |
| 15 | **crash:** `get_current_user` is a plain `def`, so FastAPI runs it in a worker thread, and every request shares one module-level sqlite cursor → `sqlite3.ProgrammingError: Recursive use of cursors not allowed` for the dashboard's parallel fleet poll, then a native access violation (`0xC0000005`) that kills the server process | the dependency is `async` (event loop) and `database.py` gives each thread its own connection, so parallel polling is safe; `tools/smoke_test.py` replays 120 parallel authenticated requests as a regression check |
| 16 | the streaming sockets send `subscribe()`'s return value unconditionally, so the **first frame on every socket** is `{"robot_id": …, "status": …, "odom": null}` — the envelope advertises the topic but carries no message, because the ROS subscription has no latched message yet | the frame is skipped until the topic actually has a message; `path`/`map` simply stay silent until a plan or a map exists, exactly as a real robot behaves. `tools/ws_webrtc_check.py` asserts no null-payload frame on any topic |
| 17 | `RTCPeerConnection()` is constructed with aiortc's defaults, which include a public STUN server and mDNS resolution of the browser's `…local` host candidates. Every `POST /streaming/offer/browser` then blocked for **~5 s** inside `setLocalDescription()` before the answer was returned | peer connections are built with an explicit empty `iceServers` list (`routers/streaming.py::_new_peer_connection`), so the signalling round trip is **~20 ms** and the media path is unchanged. Measured effect in a real browser: first decoded frame **7.5 s → 2.2 s** after clicking Start Stream |

Nothing that the dashboard relies on was changed: only behaviour *behind* the
documented contract. The streaming sockets also release their subscription when
the last client for a topic disconnects, so opening and closing dashboard pages
does not accumulate subscribers (the real backend keeps one subscription per
topic per robot forever).

---

## Helper API (`/sim`) — not part of the real backend

Enabled by default (set `FAKE_ENABLE_SIM_API=0` to switch it off).
Unauthenticated, local test tooling under a prefix the real backend does not use:

| Endpoint | Purpose |
| --- | --- |
| `GET /sim/health` | engine ticks, connected robots, world size, subscriber counts |
| `GET /sim/config` | effective configuration |
| `GET /sim/waypoints` | the waypoints (and the matching Navigation-page names) |
| `POST /sim/waypoints` | save/overwrite a named waypoint (`{name,x,y,yaw}`) |
| `DELETE /sim/waypoints/{name}` | delete a saved waypoint |
| `GET /sim/robots`, `/sim/robots/{id}` | full simulated state: pose, velocity, task, battery, map stats, plan, saved maps, rosbags |
| `GET /sim/robots/{id}/world` | ground-truth occupancy grid |
| `GET /sim/robots/{id}/map.png?source=slam\|world` | render the map as a PNG (cached per map revision; row 0 is the bottom of the map) |
| `GET /sim/robots/{id}/telemetry/{topic}` | any topic, including `imu`, `battery_state`, `point_cloud`, `image_compressed`, `depth_image_compressed`, wheel encoders |
| `POST /sim/robots/{id}/goal` | send a navigation goal (same effect as publishing `goal_pose`) |
| `POST /sim/robots/{id}/teleport` | move the robot instantly |
| `POST /sim/robots/{id}/battery` | set state of charge (e.g. 0.22 → battery warning diagnostic) |
| `POST /sim/robots/{id}/map/reveal_all` | materialise a complete map |
| `POST /sim/robots/{id}/publish` | publish on any topic the robot's enum allows (`goal_pose`, `initialpose`, …) |
| `POST /sim/robots/{id}/fault` | `disconnect` (offline robot), `estop`, `clear` |
| `POST /sim/faults/unreachable_hosts` | make chosen hosts refuse to connect, to test the UI's error paths |
| `POST /sim/engine/reset` | reset one robot or all of them |

### Read-only telemetry (`/telemetry`) — also not part of the real backend

The five streaming sockets only carry `map`/`odom`/`tf`/`diagnostics`/`path`. The
real backend subscribes to `battery_state`, `imu`, `point_cloud` and the
compressed images server-side but never exposes them, so a dashboard has no way
to read a real battery level. This router closes that gap:

| Endpoint | Purpose |
| --- | --- |
| `GET /telemetry/{robot_id}` | every on-demand topic in one response, plus `status`/`connected` |
| `GET /telemetry/{robot_id}/{topic}` | one topic, in an envelope with `generated_at` and `connected` |

Both are authenticated like the rest of the dashboard API. The envelope's
`message` is exactly the ROS message the robot publishes, so it is the same
shape a `roslibpy` subscriber would receive. Nothing the dashboard already used
changed paths.


Examples:

```bash
curl -X POST localhost:8000/sim/engine/reset?robot_id=amr_1
curl -X POST localhost:8000/sim/robots/amr_1/goal -H 'content-type: application/json' \
     -d '{"x": 4.2, "y": -2.1, "yaw": 3.14}'
curl -X POST localhost:8000/sim/robots/amr_1/battery -H 'content-type: application/json' \
     -d '{"percentage": 0.22}'
curl -o world.png 'localhost:8000/sim/robots/amr_1/map.png?source=world'
```

---

## Configuration

Everything is environment-driven (`config.py`), with the real deployment's values
as defaults. The useful ones:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FAKE_PORT` | `8000` | HTTP port the dashboard expects |
| `FAKE_HOST` | `0.0.0.0` | bind address |
| `SECRET_KEY` | `CHANGE_ME` | JWT secret (same default as the real backend, so tokens interoperate) |
| `FAKE_SEED_USERS` | `admin:admin123,operator:operator123,demo:demo123` | seeded accounts |
| `FAKE_DB_PATH` | `fake_backend/database/users.db` | sqlite file |
| `FAKE_AMR_HOST` / `FAKE_AMR_PORT` | `192.168.1.219` / `9090` | robot addresses (mirror `ROBOTS` in the real `connection.py`) |
| `FAKE_GO2_HOST` / `FAKE_GO2_PORT` | `192.168.1.220` / `7070` | |
| `FAKE_UNREACHABLE_HOSTS` | *(empty)* | hosts that fail to connect → 500 |
| `FAKE_CONNECT_LATENCY_MS` | `150` | simulated rosbridge handshake |
| `FAKE_SERVICE_LATENCY_MS` | `40` | simulated ROS service round trip |
| `FAKE_CMD_VEL_TIMEOUT_S` | `0.5` | deadman switch |
| `FAKE_TICK_HZ` | `50` | simulation loop rate |
| `FAKE_MAP_RESOLUTION` | `0.05` | metres per cell |
| `FAKE_WORLD_WIDTH_M` / `FAKE_WORLD_HEIGHT_M` | `16` / `10` | warehouse size |
| `FAKE_SENSOR_RANGE_M` / `FAKE_LIDAR_RAYS` | `6` / `72` | simulated lidar |
| `FAKE_FRONTIER_MIN_LEG_M` | `1.5` | shortest exploration leg |
| `FAKE_BATTERY_START` / `FAKE_BATTERY_DRAIN_PER_MIN` | `0.87` / `0.4` | state of charge |
| `FAKE_MAX_LINEAR_SPEED` / `FAKE_MAX_ANGULAR_SPEED` | `0.6` / `1.2` | base limits |
| `FAKE_START_X/Y/YAW` | `-6.2` / `-3.2` / `0` | spawn pose |
| `FAKE_DEFAULT_GOAL` | `charging_station` | goal used when navigation starts |
| `FAKE_SYNTHETIC_CAMERA` / `FAKE_CAMERA_FPS` | `1` / `12` | WebRTC test pattern |
| `FAKE_ENABLE_SIM_API` | `1` | mount `/sim` |
| `FAKE_VERBOSE` | `0` | echo the mirrored modules' per-command logs (the real backend always prints them; at joystick rates they flood the console) |

---

## Tools

```bash
cd fake_backend

# 123-check contract test that mirrors the dashboard's own calls
.venv/Scripts/python.exe tools/smoke_test.py
.venv/Scripts/python.exe tools/smoke_test.py --base http://127.0.0.1:8001

# end-to-end scenario: manual teleop mapping -> exploring -> save -> navigate
.venv/Scripts/python.exe tools/demo_scenario.py --seconds 20

# does the backend survive the dashboard's parallel polling? (see deviation 15)
.venv/Scripts/python.exe tools/concurrency_check.py
.venv/Scripts/python.exe tools/concurrency_check.py --base http://192.168.1.50:8000

# WebSocket + WebRTC integration: every telemetry socket, the twist socket, and
# a real second peer that completes ICE/DTLS and decodes video frames
.venv/Scripts/python.exe tools/ws_webrtc_check.py
```

Both write pictures to `tools/_artifacts/`:

| File | Contents |
| --- | --- |
| `world_map.png` / `slam_map.png` | ground truth vs. the robot's SLAM map |
| `demo_map_after_exploring.png` | map after exploring, with the odometry trail |
| `demo_map.png` | navigation result: map, remaining plan (blue), trail (red), goal (green), robot (yellow) |

Expected output of `demo_scenario.py` (20–30 s of exploring):

```
  mapped 46.6% of the world in 30s of exploring; trail 272 samples, 14.36 m
  result: goal reached  status=idle  distance to goal=0.15 m
```

`tools/smoke_test.py` runs 131 checks covering: auth (401/422 paths, JSON and
form login), the fleet list, offline and online behaviour, all five telemetry
sockets and their payload shapes, mapping, teleop (both twist spellings +
deadman), emergency stop, navigation, exploring, recording (bare-string body),
Go2 capability differences, WebRTC negotiation with `aiortc` (a real video track
is delivered), the `/sim` API, CORS headers for the browser origin, 120 parallel
authenticated requests (the load that used to crash the process), and the
OpenAPI path list against the endpoints `routes.ts` declares.

`tools/ws_webrtc_check.py` is the focused companion for the realtime surface,
because a negotiated track is not the same as flowing media. It runs 43 checks:
the five telemetry sockets (envelope, `robot_id` wire value, cadence within
tolerance, and **no null-payload frame**), the `go2_1` unsupported-topic and
offline error-then-clean-close branches, the twist ack and the resulting motion,
and a second `RTCPeerConnection` that gathers its own candidates, completes the
ICE + DTLS handshake against the backend and asserts decoded 320×180 yuv420p
frames arrive at ~12 fps.

The browser half of the same surface is exercised by
`Dashboard_UI/dev/_ws_webrtc_browser_check.mjs` (22 checks) and timed by
`Dashboard_UI/dev/_webrtc_timing.mjs`; see `Dashboard_UI/dev/README.md`.

---

## Layout

```
fake_backend/
├── api.py                  # FastAPI app (mirror of backend/api.py)
├── robot.py                # Robot base class (mirror, wired to the simulation)
├── amr_robot.py            # AMR     (mirror)
├── go2_robot.py            # Go2     (mirror)
├── sim_roslibpy.py         # Ros/Topic/Message/Service/ServiceRequest over the simulation
├── config.py               # every setting, one place
├── database.py             # sqlite users + seeding
├── routers/                # auth, users, connection, mapping, navigation, record, control,
│                           # streaming, streaming_ws  (+ sim.py, the helper API)
├── ros_bridge/             # AMR/ go2/ connection/ publisher subscriber service_client
│                           # (verbatim mirrors of the real per-robot enums)
├── simulation/
│   ├── world.py            # warehouse, ray casting
│   ├── kinematics.py       # unicycle model, quaternion helpers
│   ├── planning.py         # A*, frontier selection
│   ├── telemetry.py        # ROS message builders
│   ├── imaging.py          # PNG encoder + synthetic camera/depth frames
│   ├── state.py            # per-robot state, tasks, services, payloads
│   └── engine.py           # the tick loop + simulated rosbridge pub/sub
├── static/viewer.html      # /streaming/viewer page
├── tools/                  # smoke_test.py, demo_scenario.py, concurrency_check.py
├── requirements.txt        # fastapi, uvicorn, websockets, pydantic
├── requirements-webrtc.txt # aiortc (optional)
├── run.ps1 / run.sh        # one-command launcher
└── database/users.db       # created on first run
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Dashboard shows "Cannot reach the backend at http://localhost:8000" | the fake backend is not running, or is on another port (update `Dashboard_UI/.env`) |
| The server dies by itself after a few seconds of dashboard polling (no traceback, exit code `-1073741819` on Windows) | fixed here (deviation 15): a shared sqlite cursor across FastAPI's threadpool threads. If the *real* backend shows the same symptom, it needs the same fix — make `get_current_user` `async` and stop sharing one cursor between threads |
| 401 on every page after login | `SECRET_KEY` changed between runs while a token from the old secret is still in `sessionStorage`; log in again |
| Fleet rows read "Offline" although you connected | the UI's status poll needs a token; check `/connection/amr_1/status` with `Authorization: Bearer …` |
| `/streaming/offer/*` answers 501 | `aiortc` is not installed (`pip install -r requirements-webrtc.txt`) |
| Map socket returns `null` | nothing has mapped yet: SLAM only publishes once mapping/exploring/navigation has run (or use `POST /sim/robots/amr_1/map/reveal_all`) |
| `go2_1` map/diagnostics/path sockets close with an error frame | correct: the Go2 topic enum has no such topics |
| Port 8000 already in use | stop the other backend, or run `run.ps1 -Port 8001` and point `VITE_BACKEND_URL` at it |
| pip cannot write its cache/temp directory | the run scripts already point pip's scratch space at `fake_backend/.piptmp`; if you install by hand, set `TMPDIR`/`TEMP` to a writable path and add `--no-cache-dir` |

## Known notes for testers

* The dashboard's `OccupancyGridViewer` draws ROS grid rows top-down, while
  `nav_msgs/OccupancyGrid` row 0 is the *bottom* of the map, so the map appears
  vertically mirrored on screen. Compare against
  `/sim/robots/amr_1/map.png?source=world` (same orientation as the UI) to see it.
* `POST /dashboard/{robot_id}/start` 404s: the real backend never mounts that
  router, and neither does this one.
* The `/map` stream sends a full grid at 2 Hz to keep browser parsing and
  rendering responsive. Lower `FAKE_MAP_RESOLUTION` or shrink `FAKE_WORLD_*`
  for slower machines.
