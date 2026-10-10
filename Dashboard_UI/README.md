# Fasta AMR dashboard — frontend

React 19 + TypeScript + Vite + Tailwind UI for the Fasta robot backend. It talks
to `backend/` in production and to `fake_backend/` when you want to drive the
whole dashboard without ROS or hardware.

```bash
npm install
npm run dev      # http://localhost:5173
```

The backend address is configured in `.env`:

```
VITE_BACKEND_URL=http://localhost:8000
```

Everything derives from that one value — the REST calls, the telemetry and
control WebSockets (`ws://` is derived from the scheme, so an `https://` backend
automatically gets `wss://`) and the WebRTC signalling. Nothing else in the
source reads `import.meta.env` for an address, and no host or port is hardcoded
outside `src/api/config.ts`.

## How it is wired to the backend

| Concern | Where | Backend surface |
| --- | --- | --- |
| Auth | `store/authStore.ts` | `POST /user/login`; the JWT is kept in `sessionStorage` and attached to every request by an axios interceptor (`src/api/routes.ts`) |
| Fleet | `hooks/useFleet.ts` | `GET /connection/robot_list`, `GET /connection/{id}/status` |
| Connect / disconnect | `pages/RobotConnection.tsx` | `POST /connection/{id}/{connect,disconnect}` |
| Telemetry | `hooks/useRobotStream.ts`, `pages/Telemetry.tsx` | WebSockets for `map`, `odom`, `tf`, `diagnostics`, `path`; fake-backend `GET /telemetry/{id}` for IMU, battery, point cloud, images, and wheel encoders |
| Map rendering | `components/MapPanel.tsx` | the `map` socket (occupancy grid), `odom` for the robot pose, `path` for the plan |
| Teleop | `hooks/useRobotWebSocket.ts`, `pages/ManualControl.tsx` | `ws /control_socket/robots/{id}/ws/publish/twist` |
| Mapping | `pages/Mapping.tsx` | `POST /mapping/{id}/{start,stop,save_location}`, `DELETE /mapping/{id}/delete` |
| Navigation | `pages/Navigation.tsx` | `goal_pose` / `initialpose` publications, `POST /navigation/{id}/{start_with_map,stop,exploring/*}` |
| Missions | `pages/MissionControl.tsx` | a sequence of real goals; abort calls `POST /navigation/{id}/stop` |
| Emergency stop | `hooks/useEmergencyStop.ts` | `POST /navigation/{id}/emergency_stop/{activate,deactivate}` |
| Live video | `hooks/useWebRTCStream.ts` | `POST /streaming/offer/browser`, `GET /streaming/status` |
| Recording | `pages/LiveCamera.tsx` | `POST /recording/{id}/{start,stop,status}`, `DELETE /recording/{id}/{bag}` |
| Battery / task / plan | `hooks/useRobotState.ts` | `GET /sim/robots/{id}` (fake backend helper) |
| Waypoints | `hooks/useRobotState.ts` | `GET|POST /sim/waypoints`, `DELETE /sim/waypoints/{name}` (fake backend helper) |

The `/telemetry` page combines all 12 telemetry topics exposed by the fake
backend, shows the live payload and connection status, and renders point-cloud
and compressed-image previews. Its five streamed topics use the WebSocket
endpoint; its seven sensor topics use the fake-backend-only `GET
/telemetry/{id}` endpoint. That endpoint is not available on the production
robot backend, so those sensor topics report unavailable there. The simulated
robot state and waypoint helper routes also degrade when the production backend
returns 404.

The Simulation Test Bench covers the simulator helper endpoints for effective
configuration and robot/world snapshots, rendered SLAM and ground-truth map
images, direct goal injection, arbitrary supported topic publishing, and
unreachable-host fault injection. Its SLAM preview also provides connect,
start, auto-explore, and stop/save controls, and refreshes as map revisions
change. An inactive SLAM map is expected to appear gray until mapping starts.
The Mapping page also overlays the fake backend's ground-truth grid on live
SLAM data.

There is exactly **one fleet poller for the whole app** (`hooks/useFleet.ts`
keeps a module-level timer with a consumer count), so mounting the status bar on
every page does not multiply requests.

## Pages

| Route | What it does |
| --- | --- |
| `/login` | sign in or create an account; demo accounts are also available |
| `/` | fleet overview, live diagnostics, robot selection |
| `/robot-fleet` | per-robot status cards and hardware detail |
| `/robot-connection` | connect/disconnect with the rosbridge address, live service diagnostics |
| `/manual-control` | virtual joystick, live odometry, emergency stop |
| `/telemetry` | live data and connection status for every fake-backend telemetry topic |
| `/system-monitor` | fake simulation engine health, world configuration, subscriptions, and per-robot hardware metrics |
| `/robot-insights` | fake robot task/navigation state, mapping statistics, saved maps, and recording registry |
| `/simulation-test-bench` | fake-backend QA actions, simulator/world inspection, map images, direct goals, custom topic publishing, unreachable-host faults, and single/all-robot reset |
| `/live-camera` | real WebRTC video, camera status, rosbag recording and library |
| `/streaming-tools` | WebRTC producer-side offer, authenticated backend-hosted viewer, relay status, and FastAPI development docs |
| `/mapping` | SLAM viewer, start/stop mapping, auto mapping, saved-map load/delete |
| `/navigation` | click-to-goal map, goal form, localisation, waypoint store |
| `/mission-control` | multi-waypoint missions with a live event log |
| `/test-*` | component test benches for the individual viewers |

## Verification

`npm run build` (`tsc -b && vite build`) must pass. `npm run lint` runs ESLint.

For an end-to-end pass against a running backend there is a browser harness that
opens every page in real Chrome, records console errors and failed requests, and
exercises the write paths (connect, mapping, teleop, E-stop, a navigation goal, a
mission, recording, the WebRTC feed):

```bash
# in one terminal
pwsh -File ../fake_backend/run.ps1
# in another
npm run dev
node .tmp/e2e.mjs           # see .tmp/e2e-report.json and .tmp/shots/
```

`.tmp/` is gitignored scratch space.
