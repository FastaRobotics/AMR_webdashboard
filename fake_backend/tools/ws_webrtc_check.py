"""Focused WebSocket + WebRTC integration check (browser -> fake backend).

The existing smoke test negotiates an offer against ``/streaming/offer/browser``
inside a single process; that proves signalling parses, but not that a *separate*
peer receives media. This script reproduces what the dashboard actually does:

1. WebSocket telemetry: the five ``/streaming_socket`` topics, their envelope
   shape, their push cadence, the absence of null-payload frames, and the
   ``{"error": ...}`` + clean-close branches.
2. WebSocket teleoperation: ``/control_socket`` twist ack and the resulting
   motion of the simulated base.
3. WebRTC: a real second peer connection ("the browser") gathers ICE candidates,
   completes the ICE handshake against the backend, and decodes real video
   frames from the synthetic camera.

Usage (backend already running):

    cd fake_backend
    .venv/Scripts/python.exe tools/ws_webrtc_check.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
import urllib.request

import websockets
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results: list[tuple[bool, str, str]] = []

#: Filled in by main() once the admin token has been issued.
TOKEN: str = ""


def check(condition: bool, label: str, detail: str = "") -> bool:
    results.append((bool(condition), label, detail))
    marker = PASS if condition else FAIL
    line = f"  [{marker}] {label}"
    if detail:
        line += f"  -- {detail}"
    print(line, flush=True)
    return bool(condition)


def section(title: str) -> None:
    print(f"\n=== {title} " + "=" * max(0, 58 - len(title)), flush=True)


# ── HTTP ──────────────────────────────────────────────────────────────────────
_MISSING = object()


def http_json(base: str, method: str, path: str, body=_MISSING, token: str | None = None):
    data = None if body is _MISSING else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{base}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read().decode())


# ── 1. telemetry sockets ──────────────────────────────────────────────────────
async def read_frames(uri: str, count: int, timeout: float = 8.0) -> tuple[list, float | None, bool]:
    """Return (frames, seconds_to_first_frame, closed_cleanly).

    Every frame is timestamped as it arrives, so the caller can measure the
    push interval without the round-trip cost of opening a second socket.
    """

    frames: list = []
    stamps: list[float] = []
    clean = False
    started = time.time()

    async with websockets.connect(uri, open_timeout=timeout) as socket:
        while len(frames) < count and time.time() - started < timeout:
            try:
                raw = await asyncio.wait_for(socket.recv(), timeout=max(0.1, timeout - (time.time() - started)))
            except asyncio.TimeoutError:
                break
            except websockets.ConnectionClosed:
                clean = True
                break
            frames.append(json.loads(raw))
            stamps.append(time.time())

    return frames, stamps, clean


async def check_telemetry_sockets(ws: str) -> dict:
    section("telemetry websockets (/streaming_socket)")

    # Both robots must be online for the pre-connect topics to stream, and
    # amr_1 needs an active map + plan so that `map` and `path` have something
    # to publish at all (see simulation/state.py::snapshot).
    http_json("http://127.0.0.1:8000", "POST", "/connection/amr_1/connect", {})
    http_json("http://127.0.0.1:8000", "POST", "/connection/go2_1/connect", {})
    http_json("http://127.0.0.1:8000", "POST", "/mapping/amr_1/start", None, token=TOKEN)
    http_json(
        "http://127.0.0.1:8000",
        "POST",
        "/navigation/amr_1/start_with_map",
        {"map_name": "latest"},
        token=TOKEN,
    )

    # Give the simulation loop a moment to latch the first map/plan.
    await asyncio.sleep(1.0)

    rates = {"map": 0.1, "odom": 0.1, "tf": 0.1, "diagnostics": 0.5, "path": 0.5}
    measured: dict[str, float] = {}

    for topic in ("map", "odom", "tf", "diagnostics", "path"):
        uri = f"{ws}/streaming_socket/amr_1/ws/subscribe/{topic}"
        frames, stamps, _ = await read_frames(uri, 8, timeout=8.0)

        ok = check(
            len(frames) >= 2 and isinstance(frames[0], dict),
            f"{topic}: frames arrive",
            f"{len(frames)} frames in {stamps[-1] - stamps[0]:.2f}s" if len(stamps) >= 2 else "no frames",
        )
        if not ok:
            continue

        envelope = frames[0]
        check(
            {"robot_id", "status", topic} <= set(envelope),
            f"{topic}: envelope has robot_id/status/{topic}",
            str(sorted(envelope)),
        )
        check(
            envelope.get("robot_id") == "amr_1",
            f"{topic}: robot_id is the wire value 'amr_1' (not 'Robots.AMR_1')",
            str(envelope.get("robot_id")),
        )

        # A null payload is a real defect: the envelope advertises the topic but
        # carries nothing, so the UI's first render has no message to show.
        nulls = sum(1 for f in frames if f.get(topic) is None)
        check(
            nulls == 0,
            f"{topic}: no frame carries a null payload",
            f"{nulls}/{len(frames)} frames were null",
        )

        # Measure the push interval from the arrival timestamps.
        if len(stamps) >= 3:
            measured[topic] = (stamps[-1] - stamps[0]) / (len(stamps) - 1)

    for topic, expected in rates.items():
        got = measured.get(topic)
        if got is None:
            continue
        # Loose tolerance: this is a smoke check, not a benchmark.
        check(
            expected * 0.5 <= got <= expected * 2.5,
            f"{topic}: push interval approx {expected}s",
            f"measured {got:.3f}s",
        )

    # go2_1 must not carry map/diagnostics/path and must say so cleanly.
    for topic in ("map", "diagnostics", "path"):
        uri = f"{ws}/streaming_socket/go2_1/ws/subscribe/{topic}"
        frames, _, clean = await read_frames(uri, 2, timeout=6.0)
        first = frames[0] if frames else {}
        check(
            isinstance(first, dict)
            and "not available" in str(first.get("error", ""))
            and clean,
            f"go2_1 {topic}: clean error frame + clean close (no 1006 retry storm)",
            f"{first} clean={clean}",
        )

    # Offline robot: error frame then close.
    http_json("http://127.0.0.1:8000", "POST", "/connection/go2_1/disconnect", {})
    frames, _, clean = await read_frames(f"{ws}/streaming_socket/go2_1/ws/subscribe/odom", 2, timeout=6.0)
    first = frames[0] if frames else {}
    check(
        isinstance(first, dict) and first.get("error") == "robot not connected" and clean,
        "offline robot: {'error': 'robot not connected'} then a clean close",
        f"{first} clean={clean}",
    )

    # An idle robot has no active map and no plan, so those topics have nothing
    # to publish. Staying silent is correct: a real ROS robot does not publish
    # OccupancyGrid/Path until its mapping/navigation stack is running, and the
    # UI's viewers key off "no frame yet" rather than off a null payload.
    http_json("http://127.0.0.1:8000", "POST", "/navigation/amr_1/stop", None, token=TOKEN)
    http_json("http://127.0.0.1:8000", "POST", "/sim/engine/reset?robot_id=amr_1", None)
    await asyncio.sleep(0.5)
    frames, _, _ = await read_frames(f"{ws}/streaming_socket/amr_1/ws/subscribe/map", 2, timeout=3.0)
    check(
        frames == [],
        "idle robot: the map topic stays silent instead of sending null",
        f"{len(frames)} frames",
    )

    return measured


# ── 2. twist socket ───────────────────────────────────────────────────────────
async def check_twist_socket(ws: str, http_base: str) -> None:
    section("teleoperation socket (/control_socket)")

    uri = f"{ws}/control_socket/robots/amr_1/ws/publish/twist"
    acks: list = []
    peaks: list[float] = []

    async with websockets.connect(uri, open_timeout=5) as socket:
        # Exactly what useRobotWebSocket.sendTwist() sends, at joystick cadence.
        deadline = time.time() + 1.2
        while time.time() < deadline:
            await socket.send(json.dumps({"type": "twist", "data": {"linear": 0.45, "angular": 0.3}}))
            ack = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
            acks.append(ack)
            await asyncio.sleep(0.05)

        state = await asyncio.get_running_loop().run_in_executor(
            None, lambda: http_json(http_base, "GET", "/sim/robots/amr_1")[1]
        )
        peaks.append(state["velocity"]["linear_x"])

    check(
        all(a == {"status": "ok", "type": "twist"} for a in acks),
        "every twist frame is acked with {'status':'ok','type':'twist'}",
        f"{len(acks)} acks, e.g. {acks[0] if acks else None}",
    )
    check(peaks and peaks[0] > 0.05, "the commanded velocity reached the simulated base", f"linear_x={peaks[0]:.3f} m/s")

    # The dashboard's `disconnect()` sends a zero twist on the way out; the
    # deadman switch must stop the base shortly after the socket closes anyway.
    await asyncio.sleep(1.0)
    state = http_json(http_base, "GET", "/sim/robots/amr_1")[1]
    check(
        state["velocity"] == {"linear_x": 0.0, "angular_z": 0.0},
        "after the socket closes the deadman switch zeroes the base",
        json.dumps(state["velocity"]),
    )


# ── 3. WebRTC across two real peers ───────────────────────────────────────────
async def check_webrtc(http_base: str, token: str) -> None:
    section("WebRTC media path (browser peer -> backend peer)")

    pc = RTCPeerConnection(configuration=RTCConfiguration(iceServers=[]))
    pc.addTransceiver("video", direction="recvonly")

    tracks: list = []
    frames: list = []
    frame_times: list[float] = []

    @pc.on("track")
    def on_track(track):
        tracks.append(track)

        async def drain():
            while True:
                try:
                    frame = await track.recv()
                except Exception:
                    return
                frames.append(frame)
                frame_times.append(time.time())

        asyncio.ensure_future(drain())

    await pc.setLocalDescription(await pc.createOffer())

    # Wait for ICE gathering to finish, like a browser does before it POSTs the
    # offer — the backend needs candidates to be able to answer off the same SDP.
    for _ in range(100):
        if pc.iceGatheringState == "complete":
            break
        await asyncio.sleep(0.1)

    check(
        pc.iceGatheringState == "complete",
        "the browser peer gathered its ICE candidates",
        f"state={pc.iceGatheringState}, {len(pc.localDescription.sdp)} bytes of SDP",
    )

    loop = asyncio.get_running_loop()
    code, answer = await loop.run_in_executor(
        None,
        lambda: http_json(
            http_base,
            "POST",
            "/streaming/offer/browser",
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
            token=token,
        ),
    )
    check(code == 200 and isinstance(answer, dict), "POST /streaming/offer/browser answered", f"status={code}")
    check(
        isinstance(answer, dict) and answer.get("type") == "answer",
        "the backend replied with an SDP answer",
        str(answer.get("type")) if isinstance(answer, dict) else str(answer),
    )
    check(
        isinstance(answer, dict) and int(answer.get("track_count", 0)) >= 1,
        "the relay had at least one source track to subscribe the browser to",
        f"track_count={answer.get('track_count') if isinstance(answer, dict) else '?'}",
    )

    await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))

    # Let ICE + DTLS actually complete between the two peers.
    deadline = time.time() + 20
    while time.time() < deadline and pc.connectionState not in ("connected", "failed"):
        await asyncio.sleep(0.2)

    check(
        pc.connectionState == "connected",
        "ICE + DTLS completed: peer connections are actually connected",
        f"state={pc.connectionState}",
    )
    check(bool(tracks), "an inbound video track was negotiated", str([t.kind for t in tracks]))

    # Wait for decoded frames.
    deadline = time.time() + 20
    while time.time() < deadline and len(frames) < 5:
        await asyncio.sleep(0.2)

    check(len(frames) >= 5, "real video frames were decoded by the browser peer", f"{len(frames)} frames")

    if frames:
        first = frames[0]
        check(
            first.width > 0 and first.height > 0,
            "decoded frames carry a real picture",
            f"{first.width}x{first.height} fmt={first.format.name}",
        )

    if len(frame_times) >= 3:
        span = frame_times[-1] - frame_times[0]
        fps = (len(frame_times) - 1) / span if span > 0 else 0.0
        check(2.0 <= fps <= 40.0, "frames keep arriving at a live rate", f"{fps:.1f} fps")

    # And the backend's own relay view must agree.
    status_code, status = http_json(http_base, "GET", "/streaming/status", token=token)
    check(
        status_code == 200 and status.get("total_pcs", 0) >= 1,
        "GET /streaming/status reports the peer connection",
        json.dumps(status),
    )

    await pc.close()
    await asyncio.sleep(0.5)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    ws = base.replace("http://", "ws://").replace("https://", "wss://")

    print(f"websocket + webrtc integration check -> {base}")

    status, login = http_json(base, "POST", "/user/login", {"user_name": "admin", "password": "admin123"})
    if status != 200:
        print(f"login failed: {status} {login}")
        return 2
    global TOKEN
    TOKEN = login["access_token"]
    token = TOKEN

    await check_telemetry_sockets(ws)
    await check_twist_socket(ws, base)
    await check_webrtc(base, token)

    passed = sum(1 for ok, _, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 70)
    print(f"{passed}/{total} checks passed")
    print("=" * 70)
    for ok, label, detail in results:
        if not ok:
            print(f"  FAILED: {label}  -- {detail}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
