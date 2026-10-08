"""End-to-end contract test for the fake backend.

Runs the same calls the dashboard makes, in the same order, and checks the
shapes the frontend's TypeScript types declare:

    Dashboard_UI/src/api/routes.ts    (endpoints, bodies, headers)
    Dashboard_UI/src/api/types.ts     (response and payload shapes)
    Dashboard_UI/src/hooks/*          (WebSocket envelopes and rates)

Usage (with the fake backend already running):

    cd fake_backend
    .venv/Scripts/python.exe tools/smoke_test.py            # or python3 tools/smoke_test.py

Exit code is 0 when every check passes. ``--base http://127.0.0.1:8001`` points
it at another port.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
import urllib.error
import urllib.request

try:  # websockets is installed with uvicorn's extras / requirements.txt
    import websockets
except ImportError:  # pragma: no cover
    print("this test needs the 'websockets' package (pip install websockets)")
    raise

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription
    from aiortc.mediastreams import MediaStreamTrack
    AIORTC = True
except ImportError:  # pragma: no cover
    AIORTC = False


PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

results: list[tuple[bool, str, str]] = []


def check(condition: bool, label: str, detail: str = "") -> bool:
    results.append((bool(condition), label, detail))
    marker = PASS if condition else FAIL
    line = f"  [{marker}] {label}"
    if detail:
        line += f"  — {detail}"
    print(line, flush=True)
    return bool(condition)


def section(title: str) -> None:
    print(f"\n=== {title} " + "=" * max(0, 60 - len(title)), flush=True)


def _save(name: str, data: bytes) -> str:
    """Write an artifact next to this script so a human can look at it."""

    from pathlib import Path

    target_dir = Path(__file__).resolve().parent / "_artifacts"
    target_dir.mkdir(exist_ok=True)
    target = target_dir / name
    target.write_bytes(data)
    return str(target)


# ─── HTTP helper ──────────────────────────────────────────────────────────────


class Http:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        body=None,
        token: str | None = None,
        raw: bytes | None = None,
        content_type: str | None = None,
        binary: bool = False,
        timeout: float = 30.0,
    ):
        data = raw
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            content_type = content_type or "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        if token:
            headers["Authorization"] = f"Bearer {token}"

        request = urllib.request.Request(
            f"{self.base}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                if binary:
                    return response.status, payload
                return response.status, _decode(payload.decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            payload = error.read()
            if binary:
                return error.code, payload
            return error.code, _decode(payload.decode("utf-8", "replace"))


def _decode(payload: str):
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return payload


def detail_of(payload) -> str:
    if isinstance(payload, dict):
        return str(payload.get("detail", payload))
    return str(payload)


def check_shape(payload, required: dict[str, type], label: str) -> bool:
    """``required`` maps field name to allowed python type(s)."""

    if not isinstance(payload, dict):
        return check(False, label, f"expected object, got {type(payload).__name__}")
    problems = []
    for field, expected in required.items():
        if field not in payload:
            problems.append(f"missing '{field}'")
            continue
        if not isinstance(payload[field], expected):
            problems.append(
                f"'{field}' is {type(payload[field]).__name__}, expected {expected.__name__}"
            )
    return check(not problems, label, "; ".join(problems))


# ─── WebSocket helper ─────────────────────────────────────────────────────────


async def ws_collect(uri: str, count: int = 1, timeout: float = 10.0) -> list:
    """Read up to ``count`` frames, returning early when the socket closes."""

    frames: list = []
    try:
        async with websockets.connect(uri, open_timeout=timeout) as socket:
            deadline = time.time() + timeout
            while len(frames) < count and time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(socket.recv(), timeout=max(0.1, deadline - time.time()))
                except asyncio.TimeoutError:
                    break
                except websockets.ConnectionClosed:
                    break
                frames.append(_decode(raw))
    except Exception as error:  # connection failure is a result, not a crash
        frames.append({"__connect_error__": repr(error)})
    return frames


async def ws_wait_for(uri: str, predicate, timeout: float = 10.0):
    """Return the first frame matching ``predicate`` (or the last frame seen)."""

    last = None
    try:
        async with websockets.connect(uri, open_timeout=timeout) as socket:
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(socket.recv(), timeout=max(0.1, deadline - time.time()))
                except asyncio.TimeoutError:
                    break
                except websockets.ConnectionClosed:
                    break
                last = _decode(raw)
                if predicate(last):
                    return last
    except Exception as error:
        return {"__connect_error__": repr(error)}
    return last


# ─── checks ───────────────────────────────────────────────────────────────────


def check_auth(http: Http) -> str:
    section("auth (POST /user/login)")

    status, payload = http.request(
        "POST", "/user/login", {"user_name": "admin", "password": "wrong-password"}
    )
    check(status == 401, "bad password -> 401", f"status={status} {detail_of(payload)}")

    status, payload = http.request(
        "POST", "/user/login", {"user_name": "admin", "password": "admin123"}
    )
    ok = check(
        status == 200 and isinstance(payload, dict) and "access_token" in payload,
        "good password -> access_token",
        f"status={status}",
    )
    if ok:
        check_shape(
            payload,
            {"access_token": str, "token_type": str},
            "login response matches LoginResponse",
        )
    token = payload.get("access_token") if isinstance(payload, dict) else None

    # Swagger UI's Authorize dialog posts the OAuth2 password flow as form data
    # (tokenUrl is /user/login via OAuth2PasswordBearer).
    status, payload = http.request(
        "POST",
        "/user/login",
        raw=b"username=admin&password=admin123",
        content_type="application/x-www-form-urlencoded",
    )
    form_token = payload.get("access_token") if isinstance(payload, dict) else None
    check(
        status == 200 and isinstance(form_token, str) and form_token,
        "form-encoded login works too (Swagger Authorize)",
        f"status={status}",
    )
    if form_token:
        status, payload = http.request("GET", "/connection/robot_list", token=form_token)
        check(
            status == 200 and isinstance(payload, list),
            "the token from the form login authorises locked endpoints",
            f"status={status}",
        )

    # The token endpoint must stay an error for nonsense input, not a crash.
    status, payload = http.request("POST", "/user/login")
    check(
        status == 422,
        "empty login body -> 422 (same as the real backend's validation error)",
        f"status={status}",
    )

    return token or ""


def check_auth_required(http: Http, token: str) -> None:
    section("auth guard")

    status, payload = http.request("GET", "/connection/robot_list")
    check(status == 401, "robot_list without token -> 401", f"status={status}")

    status, payload = http.request(
        "GET", "/connection/robot_list", token="not-a-real-token"
    )
    check(status == 401, "robot_list with a bogus token -> 401", f"status={status}")

    status, payload = http.request("GET", "/connection/robot_list", token=token)
    ok = check(status == 200 and isinstance(payload, list) and len(payload) >= 2,
               "robot_list with token -> fleet", f"status={status} payload={payload}")
    if ok:
        ids = [entry.get("id") for entry in payload]
        check(ids == ["amr_1", "go2_1"], "fleet ids and order match the real backend", str(ids))
        check(
            all(isinstance(entry.get("type"), str) for entry in payload),
            "each robot has a 'type' (AMR / Go2)",
            str([entry.get("type") for entry in payload]),
        )

    status, payload = http.request("GET", "/connection/nope_1/status", token=token)
    check(status == 422, "unknown robot id -> 422 (path enum)", f"status={status}")


def check_offline_behaviour(http: Http, token: str) -> None:
    section("offline robot (before /connection/connect)")

    # Start from a known state: the disconnect endpoint is unauthenticated and
    # idempotent, exactly like the connect/disconnect pair the UI uses.
    for robot in ("amr_1", "go2_1"):
        http.request("POST", f"/connection/{robot}/disconnect")

    status, payload = http.request("GET", "/connection/amr_1/status", token=token)
    ok = check(status == 200, "status while offline -> 200", f"status={status}")
    if ok:
        message = payload.get("message", "")
        check(
            message == "Connection status for amr_1: Disconnected",
            "offline message text",
            message,
        )
        # This is the regex the UI uses in api/config.ts: parseConnectionMessage.
        check(
            not re.search(r":\s*Connected\b", message, re.I),
            "UI parseConnectionMessage('Disconnected') === false",
        )

    frames = asyncio.run(ws_collect(f"{WS}/streaming_socket/amr_1/ws/subscribe/odom", 1))
    check(
        frames and isinstance(frames[0], dict) and frames[0].get("error") == "robot not connected",
        "odom socket while offline -> {'error': 'robot not connected'}",
        str(frames[:1]),
    )

    frames = asyncio.run(
        ws_collect(f"{WS}/control_socket/robots/amr_1/ws/publish/twist", 1)
    )
    check(
        frames and isinstance(frames[0], dict) and "error" in frames[0],
        "twist socket while offline -> error frame",
        str(frames[:1]),
    )

    status, payload = http.request("POST", "/mapping/amr_1/start", token=token)
    check(
        status == 500 and "Not connected" in detail_of(payload),
        "mapping start while offline -> 500 with the robot's reason",
        f"status={status} {detail_of(payload)}",
    )


def check_connect(http: Http, token: str) -> None:
    section("connect / status")

    # Exactly what the UI sends: the robot's configured address (see robotStore.ts).
    status, payload = http.request(
        "POST", "/connection/amr_1/connect", {"host": "192.168.1.219", "port": 9090}
    )
    check(
        status == 200 and payload.get("message") == "Robot 'amr_1' connected",
        "connect amr_1 -> connected",
        f"status={status} {payload}",
    )

    status, payload = http.request("GET", "/connection/amr_1/status", token=token)
    ok = check(status == 200, "status while online -> 200", f"status={status}")
    if ok:
        message = payload.get("message", "")
        check(
            message == "Connection status for amr_1: Connected",
            "online message text",
            message,
        )
        check(
            bool(re.search(r":\s*Connected\b", message, re.I)),
            "UI parseConnectionMessage('Connected') === true",
        )

    # The real backend's endpoint default is 0.0.0.0; the fake treats it as
    # "use the robot's configured address" instead of connecting to the wildcard.
    status, payload = http.request("POST", "/connection/go2_1/connect", {})
    check(
        status == 200,
        "connect with an empty body uses the robot's own address",
        f"status={status} {detail_of(payload)}",
    )


def summarize_frames(frames: list) -> str:
    """A short, printable description of what a socket actually delivered."""

    if not frames:
        return "no frames received"
    parts = []
    for frame in frames[:3]:
        if not isinstance(frame, dict):
            parts.append(repr(frame)[:80])
        elif "error" in frame:
            parts.append(f"error={frame['error']}")
        else:
            keys = [key for key in frame if key not in ("robot_id", "status")]
            parts.append(
                "status="
                + str(frame.get("status"))
                + " "
                + ", ".join(
                    f"{key}={'null' if frame.get(key) is None else 'set'}" for key in keys
                )
            )
    return f"{len(frames)} frames: " + " | ".join(parts)


def check_odom(frames: list) -> None:
    section("odom stream")

    odom = None
    for frame in frames:
        if isinstance(frame, dict) and isinstance(frame.get("odom"), dict):
            odom = frame
            break

    ok = check(odom is not None, "odom frame carries a message", summarize_frames(frames))
    if not ok:
        return

    check(set(odom) >= {"robot_id", "status", "odom"}, "envelope keys", str(sorted(odom)))
    check(
        odom.get("status") in {"idle", "run_task", "offline"},
        "status is a RobotStatus value",
        str(odom.get("status")),
    )

    message = odom["odom"]
    ok = check_shape(
        message,
        {
            "header": dict,
            "child_frame_id": str,
            "pose": dict,
            "twist": dict,
        },
        "odom top level matches OdomMessage",
    )
    if not ok:
        return

    header = message["header"]
    check_shape(header, {"stamp": dict, "frame_id": str}, "odom header (seq/stamp/frame_id)")
    check_shape(header["stamp"], {"secs": int, "nsecs": int}, "stamp is ROS1 secs/nsecs")
    check(message["child_frame_id"] == "base_link", "child_frame_id", message["child_frame_id"])

    pose = message["pose"]
    check_shape(pose, {"pose": dict, "covariance": list}, "pose/covariance")
    check_shape(
        pose["pose"],
        {"position": dict, "orientation": dict},
        "pose.pose position/orientation",
    )
    check_shape(pose["pose"]["position"], {"x": float, "y": float, "z": float}, "position xyz")
    check_shape(
        pose["pose"]["orientation"], {"x": float, "y": float, "z": float, "w": float},
        "orientation xyzw",
    )
    check(len(pose["covariance"]) == 36, "pose covariance has 36 entries")

    twist = message["twist"]
    check_shape(twist, {"twist": dict, "covariance": list}, "twist/covariance")
    check_shape(
        twist["twist"], {"linear": dict, "angular": dict}, "twist.twist linear/angular"
    )


def check_tf(frames: list) -> None:
    section("tf stream")

    tf = None
    for frame in frames:
        if isinstance(frame, dict) and isinstance(frame.get("tf"), dict):
            tf = frame["tf"]
            break

    if not check(tf is not None, "tf frame carries a message", summarize_frames(frames)):
        return

    check_shape(tf, {"transforms": list}, "TfMessage.transforms")
    transforms = tf["transforms"]
    ok = check(len(transforms) >= 2, "more than one transform", f"{len(transforms)} transforms")
    if not ok:
        return
    first = transforms[0]
    check_shape(
        first,
        {"header": dict, "child_frame_id": str, "transform": dict},
        "TransformStamped fields",
    )
    check_shape(
        first["transform"], {"translation": dict, "rotation": dict},
        "transform translation/rotation",
    )
    pairs = [
        (item["header"].get("frame_id"), item["child_frame_id"]) for item in transforms
    ]
    check(("odom", "base_link") in pairs, "odom -> base_link present", str(pairs))


def check_diagnostics(frames: list) -> None:
    section("diagnostics stream")

    diagnostics = None
    for frame in frames:
        if isinstance(frame, dict) and isinstance(frame.get("diagnostics"), dict):
            diagnostics = frame["diagnostics"]
            break

    if not check(diagnostics is not None, "diagnostics frame carries a message", summarize_frames(frames)):
        return

    check_shape(diagnostics, {"header": dict, "status": list}, "DiagnosticArray fields")
    statuses = diagnostics["status"]
    ok = check(len(statuses) >= 6, "several services reported", f"{len(statuses)} entries")
    if not ok:
        return

    entry = statuses[0]
    check_shape(
        entry,
        {
            "level": int,
            "name": str,
            "message": str,
            "hardware_id": str,
            "values": list,
        },
        "DiagnosticStatus fields (name/level/message/hardware_id/values)",
    )
    check(entry["level"] in (0, 1, 2, 3), "level is 0..3 (UI's DiagnosticLevel)", str(entry["level"]))
    if entry["values"]:
        check_shape(entry["values"][0], {"key": str, "value": str}, "key/value entry")

    levels = {item["name"]: item["level"] for item in statuses}
    print(f"    services: {json.dumps(levels)}")


def check_map(http: Http, token: str) -> None:
    section("map stream (after /mapping/{id}/start)")

    status, payload = http.request("POST", "/mapping/amr_1/start", token=token)
    check(
        status == 200 and payload.get("status") == "map started",
        "mapping start -> map started",
        f"status={status} {detail_of(payload)}",
    )
    check(
        isinstance(payload.get("response"), dict)
        and payload["response"].get("success") is True,
        "service response reports success",
        str(payload.get("response")),
    )

    frame = asyncio.run(
        ws_wait_for(
            f"{WS}/streaming_socket/amr_1/ws/subscribe/map",
            lambda f: isinstance(f, dict) and isinstance(f.get("map"), dict),
            timeout=12.0,
        )
    )
    grid = frame.get("map") if isinstance(frame, dict) else None
    ok = check(
        grid is not None, "map frame carries an OccupancyGrid", summarize_frames([frame])
    )
    if not ok:
        return

    check_shape(
        grid,
        {"header": dict, "info": dict, "data": list},
        "OccupancyGrid fields",
    )
    info = grid["info"]
    check_shape(
        info,
        {"map_load_time": dict, "resolution": float, "width": int, "height": int, "origin": dict},
        "OccupancyGrid.info (map_load_time/resolution/width/height/origin)",
    )
    check_shape(info["origin"], {"position": dict, "orientation": dict}, "info.origin pose")
    check(
        len(grid["data"]) == info["width"] * info["height"],
        "data length == width * height",
        f"{len(grid['data'])} vs {info['width']}x{info['height']}",
    )
    values = set(grid["data"])
    check(
        values <= {-1, 0, 100},
        "cell values are -1 (unknown) / 0 (free) / 100 (occupied)",
        str(sorted(values)[:6]),
    )
    known = sum(1 for value in grid["data"] if value != -1)
    check(known > 0, "the simulated robot has mapped something", f"{known} known cells")

    # The mapping status must be visible to the UI (Dashboard badge).
    status, payload = http.request("GET", "/sim/robots/amr_1")
    check(
        payload.get("status") == "run_task" and payload.get("task") == "mapping",
        "status flips to run_task while mapping",
        f"status={payload.get('status')} task={payload.get('task')}",
    )

    status, payload = http.request(
        "POST", "/mapping/amr_1/stop", {"map_name": "smoke_test_map", "save_visual_slam_map": True,
                                      "overwrite_visual_slam_map_folder": True},
        token=token,
    )
    check(
        status == 200 and "saved" in str(payload.get("response", {}).get("message", "")),
        "mapping stop saves a map",
        str(payload.get("response")),
    )
    status, payload = http.request("GET", "/sim/robots/amr_1")
    check(payload.get("status") == "idle", "status returns to idle after stop", str(payload.get("status")))
    check(
        "smoke_test_map" in (payload.get("saved_maps") or []),
        "saved map is registered on the robot",
        str(payload.get("saved_maps")),
    )


def check_twist(http: Http, token: str) -> None:
    section("teleoperation socket (control_socket)")

    async def drive() -> dict:
        uri = f"{WS}/control_socket/robots/amr_1/ws/publish/twist"
        async with websockets.connect(uri, open_timeout=5) as socket:
            # Exactly the payload useRobotWebSocket.sendTwist() produces.
            await socket.send(json.dumps({"type": "twist", "data": {"linear": 0.4, "angular": 0.2}}))
            ack = _decode(await asyncio.wait_for(socket.recv(), timeout=5))

            await socket.send(json.dumps({"type": "spin"}))
            unknown = _decode(await asyncio.wait_for(socket.recv(), timeout=5))

            # ROS-shaped twist as well, to prove both spellings work.
            await socket.send(
                json.dumps({"type": "twist", "data": {"linear": {"x": 0.35, "y": 0, "z": 0},
                                                      "angular": {"x": 0, "y": 0, "z": 0.1}}})
            )
            vector_ack = _decode(await asyncio.wait_for(socket.recv(), timeout=5))

            # Hold the stick, the way the joystick hook publishes continuously,
            # and watch the base follow (the deadman switch is 0.5 s).
            loop = asyncio.get_running_loop()
            peak = 0.0
            deadline = time.time() + 1.0
            while time.time() < deadline:
                await socket.send(
                    json.dumps({"type": "twist", "data": {"linear": 0.45, "angular": 0.0}})
                )
                await asyncio.wait_for(socket.recv(), timeout=5)
                state = await loop.run_in_executor(
                    None, lambda: http.request("GET", "/sim/robots/amr_1")[1]
                )
                peak = max(peak, state["velocity"]["linear_x"])
                await asyncio.sleep(0.05)

            return {
                "ack": ack,
                "unknown": unknown,
                "vector_ack": vector_ack,
                "peak_linear": peak,
            }

    outcome = asyncio.run(drive())
    check(
        outcome["ack"] == {"status": "ok", "type": "twist"},
        "scalar twist -> {'status':'ok','type':'twist'}",
        json.dumps(outcome["ack"]),
    )
    check(
        isinstance(outcome["unknown"], dict) and "Unknown command type" in str(outcome["unknown"].get("error")),
        "unknown command type -> error frame (socket stays open)",
        json.dumps(outcome["unknown"]),
    )
    check(
        outcome["vector_ack"].get("status") == "ok",
        "ROS-shaped twist accepted too",
        json.dumps(outcome["vector_ack"]),
    )

    # The robot must actually move, and the deadman switch must zero it again.
    check(
        outcome["peak_linear"] > 0.05,
        "twist reached the simulated base",
        f"peak linear_x={outcome['peak_linear']:.3f} m/s",
    )

    time.sleep(1.2)
    status, payload = http.request("GET", "/sim/robots/amr_1")
    check(
        payload.get("velocity") == {"linear_x": 0.0, "angular_z": 0.0},
        "cmd_vel deadman switch stops the robot after ~0.5 s",
        f"velocity={json.dumps(payload.get('velocity'))} task={payload.get('task')} "
        f"status={payload.get('status')}",
    )

    status, payload = http.request("POST", "/navigation/amr_1/emergency_stop/activate")
    check(status == 200, "emergency stop activate -> 200", f"status={status}")
    status, payload = http.request("GET", "/sim/robots/amr_1")
    check(payload.get("emergency_stopped") is True, "emergency stop is latched in the simulation")

    status, payload = http.request("POST", "/navigation/amr_1/emergency_stop/deactivate")
    check(status == 200, "emergency stop deactivate -> 200", f"status={status}")
    status, payload = http.request("GET", "/sim/robots/amr_1")
    check(payload.get("emergency_stopped") is False, "emergency stop released")


def check_navigation_and_exploring(http: Http, token: str) -> None:
    section("navigation and exploring")

    # Navigation needs somewhere to go: put the robot back at its spawn pose so
    # the goal is a real drive away, whatever earlier steps did.
    status, payload = http.request("POST", "/sim/engine/reset?robot_id=amr_1")
    state = http.request("GET", "/sim/robots/amr_1")[1]
    check(
        state["task"] is None and state["map"]["mapped_ratio"] < 0.2,
        "navigation starts from a clean slate",
        f"task={state['task']} mapped={state['map']['mapped_ratio']:.4f}",
    )

    status, payload = http.request(
        "POST",
        "/navigation/amr_1/start_with_map",
        {
            "map_name": "latest",
            "localize_after_load": True,
            "localize_failure_is_fatal": True,
            "pose_hint_position_xyz": [0, 0, 0],
            "pose_hint_orientation_xyzw": [0, 0, 0, 1],
        },
        token=token,
    )
    check(
        status == 200 and payload.get("status") == "navigation started",
        "start_with_map -> navigation started",
        f"status={status} {detail_of(payload)}",
    )
    check(
        str(payload.get("response", {}).get("message", "")).startswith("navigation started with map"),
        "service response names the map",
        str(payload.get("response")),
    )

    # The plan is produced by the simulation loop, so give it a moment.
    planned = 0
    for _ in range(20):
        state = http.request("GET", "/sim/robots/amr_1")[1]
        planned = state.get("plan_points", 0)
        if planned > 1:
            break
        time.sleep(0.1)
    check(planned > 1, "a path was planned", f"{planned} waypoints")
    check(
        state.get("status") == "run_task",
        "status is run_task while navigating",
        str(state.get("status")),
    )

    frame = asyncio.run(
        ws_wait_for(
            f"{WS}/streaming_socket/amr_1/ws/subscribe/path",
            lambda f: isinstance(f, dict) and isinstance(f.get("path"), dict)
            and len(f["path"].get("poses") or []) > 0,
            timeout=8.0,
        )
    )
    path = frame.get("path") if isinstance(frame, dict) else None
    ok = check(isinstance(path, dict), "path frame carries a Path message")
    if ok:
        check_shape(path, {"header": dict, "poses": list}, "Path fields")
        check_shape(path["poses"][0], {"header": dict, "pose": dict}, "PoseStamped fields")

    before = http.request("GET", "/sim/robots/amr_1")[1]["pose"]
    time.sleep(2.5)
    after = http.request("GET", "/sim/robots/amr_1")[1]["pose"]
    moved = abs(after["x"] - before["x"]) + abs(after["y"] - before["y"])
    check(moved > 0.05, "the robot drives along the plan", f"moved {moved:.3f} m")

    status, payload = http.request("POST", "/navigation/amr_1/stop", token=token)
    check(status == 200, "navigation stop -> 200", f"status={status}")

    # A fresh SLAM map, so exploring has unmapped space to cover.
    status, payload = http.request("POST", "/sim/engine/reset?robot_id=amr_1")
    check(status == 200, "reset the simulation for amr_1", f"status={status}")
    status, payload = http.request("GET", "/sim/robots/amr_1")
    check(payload["map"]["mapped_ratio"] < 0.2, "the map starts almost unknown",
          f"{payload['map']['mapped_ratio']:.4f}")

    status, payload = http.request("POST", "/navigation/amr_1/exploring/start", token=token)
    check(status == 200 and payload.get("status") == "exploring started", "exploring start", f"status={status}")

    before = http.request("GET", "/sim/robots/amr_1")[1]["map"]["mapped_ratio"]
    time.sleep(3.0)
    state = http.request("GET", "/sim/robots/amr_1")[1]
    after = state["map"]["mapped_ratio"]
    check(after > before, "exploring maps new territory", f"{before:.4f} -> {after:.4f}")
    pose_before = state["pose"]
    time.sleep(2.0)
    pose_after = http.request("GET", "/sim/robots/amr_1")[1]["pose"]
    check(
        abs(pose_after["x"] - pose_before["x"]) + abs(pose_after["y"] - pose_before["y"]) > 0.05,
        "exploring drives the robot itself",
        json.dumps(pose_after),
    )

    status, payload = http.request("POST", "/navigation/amr_1/exploring/stop", token=token)
    check(status == 200 and payload.get("status") == "exploring stopped", "exploring stop", f"status={status}")

    status, payload = http.request(
        "POST", "/navigation/amr_1/start_with_map", {"map_name": "does_not_exist"}, token=token
    )
    check(
        status == 200 and payload.get("response", {}).get("success") is False,
        "unknown map -> 200 with success=false (service-level failure)",
        str(payload.get("response")),
    )


def check_recording(http: Http, token: str) -> None:
    section("recording (rosbag)")

    # The backend declares rosbag_name as a bare body string; the UI does
    # JSON.stringify(rosbagName) with Content-Type: application/json — reproduce
    # that exact body, quotes and all.
    status, payload = http.request(
        "POST", "/recording/amr_1/start", raw=json.dumps("smoke_test_bag").encode(),
        content_type="application/json", token=token,
    )
    check(
        status == 200 and payload.get("success") is True,
        "start recording with a bare JSON string body",
        f"status={status} {payload}",
    )
    check(
        payload.get("rosbag_name") == "smoke_test_bag",
        "the bag name arrives without the JSON quotes",
        repr(payload.get("rosbag_name")),
    )

    status, payload = http.request("POST", "/recording/amr_1/status", token=token)
    check(
        status == 200 and payload.get("recording") is True,
        "recording status reports the running bag",
        f"status={status} {json.dumps(payload)[:200]}",
    )
    check(
        " " not in str(payload.get("message", " ")),
        "status message is a single word (UI-friendly)",
        str(payload.get("message")),
    )

    status, payload = http.request("POST", "/recording/amr_1/stop", token=token)
    check(
        status == 200 and payload.get("success") is True,
        "stop recording",
        f"status={status} {payload}",
    )

    status, payload = http.request("DELETE", "/recording/amr_1/smoke_test_bag", token=token)
    check(
        status == 200 and payload.get("success") is True,
        "delete the bag",
        f"status={status} {payload}",
    )

    # A robot without recording services must fail readably, not with a traceback.
    status, payload = http.request(
        "POST", "/recording/go2_1/start", raw=json.dumps("nope").encode(),
        content_type="application/json", token=token,
    )
    check(
        status == 500 and "not available on this robot" in detail_of(payload),
        "go2_1 has no recording service -> readable 500",
        f"status={status} {detail_of(payload)}",
    )


def check_go2(http: Http, token: str) -> None:
    section("go2_1 capability differences")

    frames = asyncio.run(
        ws_wait_for(
            f"{WS}/streaming_socket/go2_1/ws/subscribe/odom",
            lambda f: isinstance(f, dict) and isinstance(f.get("odom"), dict),
            timeout=6.0,
        )
    )
    check(
        isinstance(frames, dict) and isinstance(frames.get("odom"), dict),
        "go2_1 odom streams (go2 has odom)",
    )

    frame = asyncio.run(
        ws_collect(f"{WS}/streaming_socket/go2_1/ws/subscribe/map", 1, timeout=5)
    )
    check(
        frame and isinstance(frame[0], dict) and "not available" in str(frame[0].get("error")),
        "go2_1 has no map topic -> clean error frame",
        str(frame[:1]),
    )

    status, payload = http.request(
        "POST", "/navigation/go2_1/start_with_map", {"map_name": "latest"}, token=token
    )
    check(
        status == 500 and "start_navigation_with_map" in detail_of(payload),
        "go2_1 has no start_with_map service -> readable 500",
        f"status={status} {detail_of(payload)}",
    )

    status, payload = http.request("POST", "/navigation/go2_1/exploring/start", token=token)
    check(status == 200, "go2_1 exploring start works (service exists)", f"status={status}")
    http.request("POST", "/navigation/go2_1/exploring/stop", token=token)


def check_streaming(http: Http, token: str) -> None:
    section("streaming (WebRTC signalling)")

    status, payload = http.request("GET", "/streaming/status", token=token)
    check_shape(payload, {"client_connected": bool, "source_tracks": int, "total_pcs": int},
                "GET /streaming/status shape")

    status, payload = http.request("GET", "/streaming/viewer", token=token)
    check(
        status == 200 and isinstance(payload, str) and "<video" in payload,
        "GET /streaming/viewer serves the test page",
        f"status={status}",
    )

    if not AIORTC:
        print("    (aiortc not installed in the test environment — skipping negotiation)")
        return

    async def negotiate():
        pc = RTCPeerConnection()
        pc.addTransceiver("video", direction="recvonly")

        received: list = []

        @pc.on("track")
        def on_track(track):
            received.append(track.kind)

        await pc.setLocalDescription(await pc.createOffer())
        status_code, answer = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: http.request(
                "POST",
                "/streaming/offer/browser",
                {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
                token=token,
            ),
        )
        if status_code != 200 or not isinstance(answer, dict):
            await pc.close()
            return status_code, answer, received

        check_shape(answer, {"sdp": str, "type": str, "track_count": int},
                    "offer/browser answer shape (sdp/type/track_count)")

        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))

        # Wait for the synthetic camera frame to arrive over the data path.
        try:
            await asyncio.wait_for(_wait_for_frames(pc), timeout=12)
        except asyncio.TimeoutError:
            pass
        await pc.close()
        return status_code, answer, received

    code, answer, received = asyncio.run(negotiate())
    check(code == 200, "offer/browser accepts a real aiortc offer", f"status={code}")
    check(bool(received), "a video track was negotiated and delivered", str(received))


async def _wait_for_frames(pc) -> None:
    """Pull one frame from every negotiated video track."""

    while not pc.getReceivers():
        await asyncio.sleep(0.1)
    for receiver in pc.getReceivers():
        track = receiver.track
        if track is None or track.kind != "video":
            continue
        await track.recv()


def check_sim_api(http: Http) -> None:
    section("simulation helper API (/sim)")

    status, payload = http.request("GET", "/sim/health")
    check(status == 200 and payload.get("running") is True, "/sim/health reports the engine", f"status={status}")
    check(payload.get("webrtc_available") is True, "aiortc detected", str(payload.get("webrtc_available")))

    for topic in ("imu", "battery_state", "point_cloud", "image_compressed", "depth_image_compressed",
                  "left_wheel_encoder", "right_wheel_encoder"):
        status, payload = http.request("GET", f"/sim/robots/amr_1/telemetry/{topic}")
        message = payload.get("message") if isinstance(payload, dict) else None
        check(
            status == 200 and isinstance(message, dict) and message,
            f"telemetry/{topic} produces a message",
            f"status={status} keys={sorted(message)[:4] if isinstance(message, dict) else message}",
        )

    status, payload = http.request("GET", "/sim/robots/amr_1/telemetry/battery_state")
    check(
        0.0 <= payload["message"]["percentage"] <= 1.0,
        "battery percentage stays in 0..1",
        str(payload["message"]["percentage"]),
    )

    status, raw = http.request(
        "GET", "/sim/robots/amr_1/map.png?source=world&downsample=2", binary=True
    )
    check(
        status == 200 and raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "map.png (ground truth) renders a PNG",
        f"status={status} bytes={len(raw) if isinstance(raw, bytes) else '?'}",
    )
    if isinstance(raw, bytes) and raw.startswith(b"\x89PNG"):
        saved = _save("world_map.png", raw)
        print(f"    saved the ground-truth map to {saved}")
        before = http.request("GET", "/sim/robots/amr_1/telemetry/map")[1]
        print(
            "    note: SLAM map topic currently "
            + ("available" if before.get("message") else "not published (no mapping run yet)")
        )

    status, payload = http.request("POST", "/sim/robots/amr_1/map/reveal_all")
    check(
        status == 200 and payload.get("mapped_ratio", 0) > 0.9,
        "reveal_all materialises a complete SLAM map",
        str(payload.get("mapped_ratio")),
    )
    status, raw = http.request(
        "GET", "/sim/robots/amr_1/map.png?source=slam&downsample=1", binary=True
    )
    if isinstance(raw, bytes) and raw.startswith(b"\x89PNG"):
        print(f"    saved the SLAM map to {_save('slam_map.png', raw)}")

    status, payload = http.request("POST", "/sim/robots/amr_1/teleport", {"x": 2.0, "y": 1.0, "yaw": 0.5})
    check(status == 200, "teleport", f"status={status}")

    status, payload = http.request("POST", "/sim/robots/amr_1/battery", {"percentage": 0.22})
    check(status == 200, "battery override", f"status={status}")
    frame = asyncio.run(
        ws_wait_for(
            f"{WS}/streaming_socket/amr_1/ws/subscribe/diagnostics",
            lambda f: isinstance(f, dict)
            and any(item["name"] == "battery_manager" and item["level"] == 1
                    for item in (f.get("diagnostics") or {}).get("status", [])),
            timeout=8.0,
        )
    )
    check(
        isinstance(frame, dict) and frame.get("diagnostics") is not None,
        "low battery surfaces as a warning diagnostic (UI badge)",
    )
    http.request("POST", "/sim/robots/amr_1/battery", {"percentage": 0.9})

    status, payload = http.request("POST", "/sim/robots/amr_1/fault", {"kind": "disconnect"})
    check(status == 200, "fault: disconnect", f"status={status}")
    status, payload = http.request("GET", "/connection/amr_1/status")
    check(status == 401, "status endpoint still requires a token", f"status={status}")
    http.request("POST", "/connection/amr_1/connect", {"host": "192.168.1.219", "port": 9090})

    status, payload = http.request("POST", "/sim/faults/unreachable_hosts", {"hosts": ["10.255.255.1"]})
    check(status == 200, "faults: unreachable host list", f"status={status}")
    status, payload = http.request(
        "POST", "/connection/amr_1/connect", {"host": "10.255.255.1", "port": 9090}
    )
    check(
        status == 500 and "Failed to connect" in detail_of(payload),
        "connecting to an unreachable host -> 500 (UI error path)",
        f"status={status} {detail_of(payload)}",
    )
    http.request("POST", "/sim/faults/unreachable_hosts", {"hosts": []})
    http.request("POST", "/connection/amr_1/connect", {"host": "192.168.1.219", "port": 9090})


def check_cors(http: Http, token: str) -> None:
    """The dashboard runs on :5173 and calls :8000, so CORS must actually work."""

    section("CORS (browser -> backend)")

    origin = "http://localhost:5173"

    def raw(method: str, path: str, extra_headers: dict, body: bytes | None = None):
        headers = {"Accept": "application/json", "Origin": origin, **extra_headers}
        request = urllib.request.Request(
            f"{http.base}{path}", data=body, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, dict(response.headers)
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers)

    status, headers = raw(
        "OPTIONS",
        "/connection/robot_list",
        {
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    allow_origin = headers.get("access-control-allow-origin")
    allow_headers = (headers.get("access-control-allow-headers") or "").lower()
    check(
        status in (200, 204) and allow_origin in (origin, "*"),
        "preflight for a token-bearing GET is allowed",
        f"status={status} allow-origin={allow_origin}",
    )
    check(
        "authorization" in allow_headers or allow_headers == "*",
        "preflight allows the Authorization header",
        f"allow-headers={allow_headers}",
    )

    status, headers = raw(
        "GET", "/connection/robot_list", {"Authorization": f"Bearer {token}"}
    )
    check(
        status == 200
        and headers.get("access-control-allow-origin") in (origin, "*")
        and (headers.get("access-control-allow-credentials") or "").lower() == "true",
        "actual request carries CORS + credentials headers (Origin echoed)",
        f"status={status} allow-origin={headers.get('access-control-allow-origin')} "
        f"credentials={headers.get('access-control-allow-credentials')}",
    )


def check_concurrency(http: Http, token: str) -> None:
    """The dashboard polls the fleet list and both robot statuses in parallel.

    This is the load that used to kill the process: ``get_current_user`` ran in
    FastAPI's threadpool while every request shared one module-level sqlite
    cursor, giving ``sqlite3.ProgrammingError: Recursive use of cursors not
    allowed`` and then a native access violation (exit 0xC0000005).
    """

    section("concurrency (parallel authenticated polling)")

    import threading

    paths = (
        "/connection/robot_list",
        "/connection/amr_1/status",
        "/connection/go2_1/status",
    )
    codes: list[int] = []
    lock = threading.Lock()

    def worker() -> None:
        for _ in range(10):
            for path in paths:
                code, _payload = http.request("GET", path, token=token)
                with lock:
                    codes.append(code)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    started = time.time()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    histogram: dict[int, int] = {}
    for code in codes:
        histogram[code] = histogram.get(code, 0) + 1

    check(
        len(codes) == 120 and all(code == 200 for code in codes),
        "120 parallel authenticated requests all succeed",
        f"{len(codes)} in {time.time() - started:.1f}s, codes={dict(sorted(histogram.items()))}",
    )

    status, payload = http.request("GET", "/sim/health")
    check(
        status == 200 and payload.get("running") is True,
        "the server is still alive and ticking afterwards",
        f"status={status}",
    )


def check_frontend_notes(http: Http, token: str) -> None:
    section("frontend integration notes")

    status, payload = http.request("GET", "/dashboard/amr_1/start", token=token)
    check(
        status == 404,
        "/dashboard/* is not mounted (it is not mounted in the real backend either)",
        f"status={status}",
    )

    status, payload = http.request("GET", "/docs")
    check(status == 200, "OpenAPI docs available at /docs", f"status={status}")

    status, payload = http.request("GET", "/openapi.json")
    paths = sorted(payload.get("paths", {})) if isinstance(payload, dict) else []
    expected = {
        "/user/login",
        "/user/create",
        "/connection/robot_list",
        "/connection/{robot_id}/status",
        "/connection/{robot_id}/{type}",
        "/mapping/{robot_id}/start",
        "/mapping/{robot_id}/stop",
        "/mapping/{robot_id}/delete",
        "/mapping/{robot_id}/save_location",
        "/navigation/{robot_id}/start",
        "/navigation/{robot_id}/start_with_map",
        "/navigation/{robot_id}/stop",
        "/navigation/{robot_id}/exploring/start",
        "/navigation/{robot_id}/exploring/stop",
        "/navigation/{robot_id}/emergency_stop/{state}",
        "/recording/{robot_id}/start",
        "/recording/{robot_id}/stop",
        "/recording/{robot_id}/status",
        "/recording/{robot_id}/{rosbag_name}",
        "/streaming/offer/client",
        "/streaming/offer/browser",
        "/streaming/status",
        "/streaming/viewer",
    }
    missing = sorted(expected - set(paths))
    check(not missing, "every REST path the frontend calls exists", f"missing: {missing}")
    print(f"    REST paths: {len(paths)}  (websockets are not listed in OpenAPI)")


def check_new_routes(http: Http, token: str) -> None:
    """The routes added for the dashboard: /telemetry and the waypoint store."""

    section("telemetry + waypoints")

    status, payload = http.request("GET", "/telemetry/amr_1", token=token)
    check(status == 200, "GET /telemetry/{robot} -> 200", f"status={status}")
    topics = payload.get("topics", {}) if isinstance(payload, dict) else {}
    check(
        "battery_state" in topics,
        "the battery topic is readable (the UI status bar needs it)",
        f"topics={sorted(topics)}",
    )
    battery = topics.get("battery_state") or {}
    check(
        isinstance(battery.get("percentage"), (int, float)),
        "battery percentage is a number",
        f"percentage={battery.get('percentage')}",
    )

    status, payload = http.request(
        "GET", "/telemetry/amr_1/battery_state", token=token
    )
    check(status == 200, "GET /telemetry/{robot}/{topic} -> 200", f"status={status}")
    check(
        "recording" not in payload,
        "the envelope carries message/generated_at, not a bare message",
        f"keys={sorted(payload)}",
    )

    status, _ = http.request("GET", "/telemetry/amr_1/nope", token=token)
    check(status == 404, "unknown telemetry topic -> 404", f"status={status}")

    status, _ = http.request("GET", "/telemetry/ghost", token=token)
    check(status == 404, "unknown robot on /telemetry -> 404", f"status={status}")

    status, _ = http.request("GET", "/telemetry/amr_1")
    check(status == 401, "telemetry requires a token", f"status={status}")

    # ── waypoints ────────────────────────────────────────────────────────────
    status, payload = http.request("GET", "/sim/waypoints", token=token)
    seeded = payload if isinstance(payload, list) else []
    check(
        status == 200 and len(seeded) >= 4,
        "GET /sim/waypoints lists the world's waypoints",
        f"status={status} count={len(seeded)}",
    )
    check(
        all({"name", "x", "y", "yaw"} <= set(item) for item in seeded),
        "every waypoint carries name/x/y/yaw",
    )

    status, saved = http.request(
        "POST",
        "/sim/waypoints",
        body={"name": "smoke_test_wp", "x": 1.25, "y": -0.5, "yaw": 0.75},
        token=token,
    )
    check(
        status == 200 and saved.get("name") == "smoke_test_wp",
        "POST /sim/waypoints saves a waypoint",
        f"status={status} {saved}",
    )

    status, payload = http.request("GET", "/sim/waypoints", token=token)
    check(
        any(item.get("name") == "smoke_test_wp" for item in payload),
        "the saved waypoint is listed afterwards",
    )

    status, _ = http.request("DELETE", "/sim/waypoints/smoke_test_wp", token=token)
    check(status == 200, "DELETE /sim/waypoints/{name} -> 200", f"status={status}")

    status, _ = http.request("DELETE", "/sim/waypoints/smoke_test_wp", token=token)
    check(status == 404, "deleting it twice -> 404", f"status={status}")

    # ── map PNG caching ─────────────────────────────────────────────────────
    status, body = http.request(
        "GET", "/sim/robots/amr_1/map.png?source=world", binary=True
    )
    check(
        status == 200 and body[:8] == b"\x89PNG\r\n\x1a\n",
        "map.png still renders a PNG after the cache was added",
        f"status={status} bytes={len(body) if isinstance(body, bytes) else '?'}",
    )


# ─── main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    global WS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    WS = base.replace("http://", "ws://").replace("https://", "wss://")

    print(f"fake backend smoke test -> {base}")

    http = Http(base)
    try:
        status, _ = http.request("GET", "/docs", timeout=5)
    except Exception as error:
        print(f"\ncannot reach {base}: {error}")
        return 2

    token = check_auth(http)
    if not token:
        print("\nno token: the rest of the suite cannot run")
        return 1

    check_auth_required(http, token)
    check_offline_behaviour(http, token)
    check_connect(http, token)

    odom_frames = asyncio.run(
        ws_collect(f"{WS}/streaming_socket/amr_1/ws/subscribe/odom", 6, timeout=6)
    )
    check_odom(odom_frames)

    tf_frames = asyncio.run(
        ws_collect(f"{WS}/streaming_socket/amr_1/ws/subscribe/tf", 3, timeout=6)
    )
    check_tf(tf_frames)

    diagnostics_frames = asyncio.run(
        ws_collect(f"{WS}/streaming_socket/amr_1/ws/subscribe/diagnostics", 2, timeout=6)
    )
    check_diagnostics(diagnostics_frames)

    check_map(http, token)
    check_twist(http, token)
    check_navigation_and_exploring(http, token)
    check_recording(http, token)
    check_go2(http, token)
    check_streaming(http, token)
    check_sim_api(http)
    check_new_routes(http, token)
    check_cors(http, token)
    check_concurrency(http, token)
    check_frontend_notes(http, token)

    failed = [label for ok, label, _ in results if not ok]
    print("\n" + "=" * 70)
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("failures:")
        for label in failed:
            print(f"  - {label}")
    print("=" * 70)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
