"""Demo scenario: map by hand, explore, save the map, then navigate.

Drives the fake backend the way the dashboard would and records what happens,
including pictures of the result:

    cd fake_backend
    .venv/Scripts/python.exe tools/demo_scenario.py --seconds 20

Phases
  A. connect, start mapping, and drive with the teleoperation socket (the
     dashboard's virtual joystick) — SLAM builds the map from real motion
  B. switch to autonomous exploring so the whole warehouse gets covered
  C. stop mapping to save the map under a name (and stop exploring)
  D. start navigation with that saved map and follow the odom stream to the goal
  E. write ``tools/_artifacts/demo_map_after_exploring.png`` and
     ``tools/_artifacts/demo_map.png`` (map + planned path + odom trail)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import struct
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

import websockets

ARTIFACTS = Path(__file__).resolve().parent / "_artifacts"


# ─── tiny HTTP client ─────────────────────────────────────────────────────────


class Http:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.token = ""

    def __call__(self, method: str, path: str, body=None, auth: bool = False):
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if auth and self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        request = urllib.request.Request(
            f"{self.base}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw or b"null")
            except json.JSONDecodeError:
                return error.code, raw.decode("utf-8", "replace")


# ─── PNG writer (same approach as the backend's simulation/imaging.py) ─────────


def _chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rgb: bytearray) -> None:
    raw = bytearray()
    for row in range(height):
        raw.append(0)
        raw.extend(rgb[row * width * 3 : (row + 1) * width * 3])
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _chunk(b"IEND", b"")
    )


def render_map(
    grid: dict,
    path_png: Path,
    plan: list[tuple[float, float]] | None = None,
    trail: list[tuple[float, float]] | None = None,
    goal: tuple[float, float] | None = None,
    robot: tuple[float, float] | None = None,
) -> None:
    info = grid["info"]
    width, height, resolution = info["width"], info["height"], info["resolution"]
    origin_x = info["origin"]["position"]["x"]
    origin_y = info["origin"]["position"]["y"]

    buffer = bytearray(width * height * 3)
    for index, value in enumerate(grid["data"]):
        shade = 30 if value == 100 else (235 if value == 0 else 115)
        offset = index * 3
        buffer[offset] = shade
        buffer[offset + 1] = shade
        buffer[offset + 2] = shade

    def to_pixel(x: float, y: float) -> tuple[int, int]:
        # No vertical flip: this matches how the dashboard draws the grid (and
        # how the /sim map.png endpoint renders it), so the pictures line up.
        return int((x - origin_x) / resolution), int((y - origin_y) / resolution)

    def dot(x: float, y: float, colour: tuple[int, int, int], radius: int = 1) -> None:
        px, py = to_pixel(x, y)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                cx, cy = px + dx, py + dy
                if 0 <= cx < width and 0 <= cy < height:
                    offset = (cy * width + cx) * 3
                    buffer[offset] = colour[0]
                    buffer[offset + 1] = colour[1]
                    buffer[offset + 2] = colour[2]

    for x, y in plan or []:
        dot(x, y, (60, 120, 255))
    for x, y in trail or []:
        dot(x, y, (255, 70, 70))
    if goal:
        dot(goal[0], goal[1], (40, 200, 90), radius=3)
    if robot:
        dot(robot[0], robot[1], (255, 210, 40), radius=2)

    write_png(path_png, width, height, buffer)


def trail_length(trail: list[tuple[float, float]]) -> float:
    return sum(
        math.hypot(x1 - x0, y1 - y0) for (x0, y0), (x1, y1) in zip(trail, trail[1:])
    )


# ─── scenario ─────────────────────────────────────────────────────────────────


async def sample_odom(ws_url: str, seconds: float, on_frame, should_stop=None) -> None:
    """Read the odom stream for a while, handing each envelope to ``on_frame``."""

    deadline = time.time() + seconds
    async with websockets.connect(ws_url, open_timeout=10) as socket:
        while time.time() < deadline:
            if should_stop is not None and should_stop():
                break
            try:
                raw = await asyncio.wait_for(
                    socket.recv(), timeout=max(0.1, deadline - time.time())
                )
            except asyncio.TimeoutError:
                break
            envelope = json.loads(raw)
            if envelope.get("odom"):
                on_frame(envelope)


async def manual_drive(ws_url: str, http: Http, robot: str, trail: list) -> None:
    """Hold the virtual joystick: forward, turn, forward — like a human would."""

    script = [
        (2.0, 0.45, 0.0),   # straight, along the aisle by the south wall
        (1.4, 0.0, 0.7),    # turn on the spot
        (1.2, 0.35, 0.0),   # short straight
        (1.4, 0.0, -0.6),   # turn back
        (1.6, 0.4, 0.0),    # straight again
    ]

    async with websockets.connect(ws_url, open_timeout=10) as socket:
        for duration, linear, angular in script:
            deadline = time.time() + duration
            while time.time() < deadline:
                await socket.send(
                    json.dumps(
                        {"type": "twist", "data": {"linear": linear, "angular": angular}}
                    )
                )
                await socket.recv()
                await asyncio.sleep(0.05)

            # Same zero-twist the UI sends when control is released.
            await socket.send(
                json.dumps({"type": "twist", "data": {"linear": 0.0, "angular": 0.0}})
            )
            await socket.recv()

            state = http("GET", f"/sim/robots/{robot}")[1]
            trail.append((state["pose"]["x"], state["pose"]["y"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--robot", default="amr_1")
    parser.add_argument("--seconds", type=float, default=20.0, help="exploring time")
    parser.add_argument("--goal-timeout", type=float, default=90.0)
    args = parser.parse_args()

    http = Http(args.base)
    ws_base = args.base.replace("http://", "ws://").replace("https://", "wss://")
    robot = args.robot

    status, payload = http("POST", "/user/login", {"user_name": "admin", "password": "admin123"})
    if status != 200:
        print(f"login failed: {status} {payload}")
        return 2
    http.token = payload["access_token"]
    print("logged in")

    config = http("GET", "/sim/config")[1]
    endpoint = config["robots"][robot]
    status, payload = http(
        "POST", f"/connection/{robot}/connect",
        {"host": endpoint["host"], "port": endpoint["port"]},
    )
    print(f"connect {robot}: {payload}")

    http("POST", f"/sim/engine/reset?robot_id={robot}")
    http("POST", f"/mapping/{robot}/start", auth=True)

    trail: list[tuple[float, float]] = []

    print("\n-- A. manual mapping with the teleoperation socket " + "-" * 18)
    asyncio.run(
        manual_drive(f"{ws_base}/control_socket/robots/{robot}/ws/publish/twist", http, robot, trail)
    )
    state = http("GET", f"/sim/robots/{robot}")[1]
    print(
        f"  after manual drive: pose=({state['pose']['x']:.2f},{state['pose']['y']:.2f}) "
        f"mapped={state['map']['mapped_ratio'] * 100:.1f}% status={state['status']}"
    )

    print(f"\n-- B. autonomous exploring for {args.seconds:.0f}s " + "-" * 27)
    http("POST", f"/navigation/{robot}/exploring/start", auth=True)
    start = time.time()
    last_report = 0.0

    def on_frame(envelope: dict) -> None:
        nonlocal last_report
        pose = envelope["odom"]["pose"]["pose"]["position"]
        trail.append((pose["x"], pose["y"]))
        now = time.time() - start
        if now - last_report >= 2.0:
            last_report = now
            state = http("GET", f"/sim/robots/{robot}")[1]
            print(
                f"  t={now:5.1f}s pose=({pose['x']:6.2f},{pose['y']:6.2f}) "
                f"mapped={state['map']['mapped_ratio'] * 100:5.1f}% "
                f"status={state['status']:<8} task={state['task']}"
            )

    asyncio.run(
        sample_odom(
            f"{ws_base}/streaming_socket/{robot}/ws/subscribe/odom", args.seconds, on_frame
        )
    )
    http("POST", f"/navigation/{robot}/exploring/stop", auth=True)

    print("\n-- C. saving the map " + "-" * 38)
    status, payload = http(
        "POST", f"/mapping/{robot}/stop",
        {"map_name": "demo_explored", "save_visual_slam_map": True,
         "overwrite_visual_slam_map_folder": True},
        auth=True,
    )
    print(f"  {payload.get('response', {}).get('message')}")

    state = http("GET", f"/sim/robots/{robot}")[1]
    print(
        f"  mapped {state['map']['mapped_ratio'] * 100:.1f}% of the world in "
        f"{time.time() - start:.0f}s of exploring; trail {len(trail)} samples, "
        f"{trail_length(trail):.2f} m"
    )

    grid = http("GET", f"/sim/robots/{robot}/telemetry/map")[1]["message"]
    if grid:
        render_map(
            grid,
            ARTIFACTS / "demo_map_after_exploring.png",
            trail=trail,
            robot=(state["pose"]["x"], state["pose"]["y"]),
        )
        print(f"  wrote {ARTIFACTS / 'demo_map_after_exploring.png'}")

    print("\n-- D. navigating with the saved map " + "-" * 29)
    status, payload = http(
        "POST", f"/navigation/{robot}/start_with_map",
        {
            "map_name": "demo_explored",
            "localize_after_load": True,
            "localize_failure_is_fatal": True,
            "pose_hint_position_xyz": [0.0, 0.0, 0.0],
            "pose_hint_orientation_xyzw": [0.0, 0.0, 0.0, 1.0],
        },
        auth=True,
    )
    print(f"  start_with_map: {payload.get('response', {}).get('message')}")

    goal_state = http("GET", f"/sim/robots/{robot}")[1]
    goal = goal_state["goal"]
    print(f"  goal: {goal}  (default goal '{config['default_goal_name']}')")

    nav_trail: list[tuple[float, float]] = []
    reached_at: float | None = None
    nav_start = time.time()
    last_probe = 0.0

    def on_nav(envelope: dict) -> None:
        nonlocal reached_at, last_probe
        position = envelope["odom"]["pose"]["pose"]["position"]
        nav_trail.append((position["x"], position["y"]))

        now = time.time()
        if reached_at is not None or now - last_probe < 0.5:
            return
        last_probe = now
        state = http("GET", f"/sim/robots/{robot}")[1]
        if state["task"] != "navigation":
            reached_at = now - nav_start
            print(
                f"  {state['last_navigation_result']} after {reached_at:.1f}s "
                f"(status={state['status']}, travelled {trail_length(nav_trail):.2f} m)"
            )

    try:
        asyncio.run(
            sample_odom(
                f"{ws_base}/streaming_socket/{robot}/ws/subscribe/odom",
                args.goal_timeout,
                on_nav,
                should_stop=lambda: reached_at is not None,
            )
        )
    except Exception as error:
        print(f"  odom stream ended: {error}")

    final = http("GET", f"/sim/robots/{robot}")[1]
    distance_to_goal = (
        math.hypot(final["pose"]["x"] - goal[0], final["pose"]["y"] - goal[1])
        if goal
        else None
    )
    print(
        f"\n  result: {final['last_navigation_result']}  status={final['status']}  "
        f"distance to goal="
        + (f"{distance_to_goal:.2f} m" if distance_to_goal is not None else "n/a")
    )

    http("POST", f"/navigation/{robot}/stop", auth=True)

    grid = http("GET", f"/sim/robots/{robot}/telemetry/map")[1]["message"]
    if grid:
        render_map(
            grid,
            ARTIFACTS / "demo_map.png",
            plan=[tuple(point) for point in final.get("plan", [])],
            trail=nav_trail,
            goal=(goal[0], goal[1]) if goal else None,
            robot=(final["pose"]["x"], final["pose"]["y"]),
        )
        print(f"  wrote {ARTIFACTS / 'demo_map.png'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
