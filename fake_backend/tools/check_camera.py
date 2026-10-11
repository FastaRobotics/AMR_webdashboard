"""Camera-only check for the fake backend, with saved frame images.

``tools/ws_webrtc_check.py`` already negotiates a real browser peer against
``/streaming/offer/browser`` and asserts that video frames decode at a live
rate. This script is the narrower companion for the dashboard's ``/live-camera``
page specifically: it walks the same signalling the page uses, and then goes one
step further than the smoke test by **decoding the frame pixels** — proving the
picture is the synthetic camera view and that it actually animates, and writing
PNGs a human can look at.

    1. ``POST /user/login``                     → bearer token
    2. ``POST /connection/{robot_id}/connect``  → robot online
    3. ``GET  /streaming/status``               → relay sources before an offer
    4. aiortc pc: addTransceiver(video, recvonly) → createOffer → setLocalDescription
    5. ``POST /streaming/offer/browser``        → answer (+ track_count)
    6. ``setRemoteDescription(answer)``         → pull N frames off the relay
    7. decode each frame to RGB, compare them, write the first few as PNGs

Exit code 0 means the whole path works, real video frames arrived, and the
picture is changing between frames.

Usage (from ``fake_backend``):

    .venv\\Scripts\\python.exe tools\\check_camera.py
    .venv\\Scripts\\python.exe tools\\check_camera.py --robot amr_1 --frames 20
    .venv\\Scripts\\python.exe tools\\check_camera.py --base http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: Where the captured frames land. ``--out`` overrides it.
DEFAULT_OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs", "camera"
)


class CheckError(RuntimeError):
    """A failed step, reported with the step name and the reason."""


def http_json(
    method: str,
    url: str,
    payload: dict | None = None,
    token: str | None = None,
    timeout: float = 20.0,
) -> dict:
    """Minimal JSON client (the venv has no requests/httpx)."""

    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Accept", "application/json")
    if body is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise CheckError(f"HTTP {error.code} from {method} {url}: {detail}") from error
    except urllib.error.URLError as error:
        raise CheckError(f"cannot reach {url}: {error.reason}") from error

    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError as error:
        raise CheckError(f"{method} {url} did not return JSON: {raw[:200]!r}") from error


def raw_frame_to_rgb(frame) -> tuple[bytes, int, int]:
    """Pull RGB24 bytes out of an ``av.VideoFrame`` without numpy/Pillow.

    PyAV 17 dropped ``VideoPlane.buffer``; the only way in without numpy is
    ``VideoPlane.buffer_ptr`` (the address of the plane) plus ``buffer_size``,
    which ``ctypes.string_at`` turns into bytes.
    """

    import ctypes

    rgb = frame.reformat(width=frame.width, height=frame.height, format="rgb24")
    plane = rgb.planes[0]
    width, height = rgb.width, rgb.height

    raw = ctypes.string_at(plane.buffer_ptr, plane.buffer_size)

    # A plane may be padded per row (``line_size``); repack so the buffer is
    # exactly width*height*3 and the PNG encoder accepts it.
    line_size = plane.line_size
    expected = width * 3
    if line_size == expected:
        return raw[: expected * height], width, height

    out = bytearray(expected * height)
    for row in range(height):
        start = row * line_size
        out[row * expected : (row + 1) * expected] = raw[start : start + expected]
    return bytes(out), width, height


async def run(args: argparse.Namespace) -> int:
    from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription

    from simulation.imaging import png_encode

    base = args.base.rstrip("/")
    step = "login"

    try:
        # ── 1. authenticate ──────────────────────────────────────────────────
        login = http_json(
            "POST",
            f"{base}/user/login",
            {"user_name": args.user, "password": args.password},
        )
        token = login.get("access_token")
        if not token:
            raise CheckError(f"no access_token in login response: {login}")
        print(f"[1/6] login ok as '{args.user}'")

        # ── 2. connect the robot ─────────────────────────────────────────────
        step = "connect"

        def is_connected() -> bool:
            payload = http_json(
                "GET", f"{base}/connection/{args.robot}/status", token=token
            )
            # "Connection status for amr_1: Connected"
            return "connected" in str(payload.get("message", "")).lower() and not str(
                payload.get("message", "")
            ).lower().rstrip(".").endswith("disconnected")

        if not is_connected():
            # The dashboard omits host/port so the robot keeps its configured
            # address (see connectRobot in routes.ts).
            http_json(
                "POST", f"{base}/connection/{args.robot}/connect", {}, token=token
            )
        if not is_connected():
            raise CheckError("robot did not come online")

        robot_list = http_json("GET", f"{base}/connection/robot_list", token=token)
        kinds = {entry.get("id"): entry.get("type") for entry in robot_list}
        print(f"[2/6] robot '{args.robot}' connected (kind={kinds.get(args.robot)})")

        # ── 3. relay state before any offer ──────────────────────────────────
        step = "streaming/status"
        before = http_json("GET", f"{base}/streaming/status", token=token)
        print(
            f"[3/6] relay before offer: sources={before.get('source_tracks')} "
            f"pcs={before.get('total_pcs')} client_connected={before.get('client_connected')}"
        )

        # ── 4. negotiate like the dashboard ──────────────────────────────────
        step = "offer"
        pc = RTCPeerConnection(configuration=RTCConfiguration(iceServers=[]))
        pc.addTransceiver("video", direction="recvonly")

        received: list = []
        frame_times: list[float] = []

        @pc.on("track")
        def on_track(track) -> None:
            print(f"[4/6] inbound track: kind={track.kind} id={track.id[:8]}…")

            async def drain() -> None:
                try:
                    while len(received) < args.frames:
                        frame = await track.recv()
                        received.append(frame)
                        frame_times.append(time.time())
                except Exception as error:  # MediaStreamError on close
                    if len(received) < args.frames:
                        print(f"      track ended early: {error!r}")

            asyncio.ensure_future(drain())

        offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        # Same wait as the dashboard: let local ICE gathering finish so the offer
        # carries real candidates.
        deadline = time.time() + args.ice_timeout
        while pc.iceGatheringState != "complete" and time.time() < deadline:
            await asyncio.sleep(0.05)

        answer_payload = http_json(
            "POST",
            f"{base}/streaming/offer/browser",
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
            token=token,
        )
        track_count = answer_payload.get("track_count")
        print(f"[5/6] answer received: track_count={track_count}")

        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=answer_payload["sdp"], type=answer_payload["type"])
        )

        # ── 5. wait for frames ───────────────────────────────────────────────
        step = "frames"
        started = time.time()
        timeout = started + args.timeout
        while len(received) < args.frames and time.time() < timeout:
            await asyncio.sleep(0.1)

        connection_state = pc.connectionState
        await pc.close()

        if not received:
            raise CheckError(
                f"no video frames arrived within {args.timeout:.0f}s "
                f"(pc connectionState={connection_state}, track_count={track_count})"
            )

        # ── 6. decode, compare and save ──────────────────────────────────────
        step = "decode"
        os.makedirs(args.out, exist_ok=True)
        saved: list[str] = []
        digests: list[int] = []
        first_rgb: bytes | None = None
        last_rgb: bytes | None = None
        size = ""

        for index, frame in enumerate(received):
            rgb, width, height = raw_frame_to_rgb(frame)
            if len(rgb) != width * height * 3:
                raise CheckError(
                    f"frame {index} decoded to {len(rgb)} bytes, "
                    f"expected {width * height * 3} for {width}x{height}"
                )
            # Hash the WHOLE frame: sampling a prefix would only see the sky,
            # which barely changes and would understate the motion.
            digests.append(zlib.crc32(rgb))
            if first_rgb is None:
                first_rgb = rgb
            last_rgb = rgb
            size = f"{width}x{height}"
            if index < args.save:
                path = os.path.join(args.out, f"frame_{index:03d}.png")
                with open(path, "wb") as handle:
                    handle.write(png_encode(width, height, rgb))
                saved.append(path)

        distinct = len(set(digests))

        # Mean absolute per-channel difference between the first and the last
        # frame, as a share of full scale. A frozen renderer scores ~0.
        changed = 0.0
        if first_rgb is not None and last_rgb is not None and first_rgb != last_rgb:
            total = sum(
                abs(a - b) for a, b in zip(first_rgb[::97], last_rgb[::97])
            )
            samples = len(range(0, len(first_rgb), 97))
            changed = 100.0 * total / (samples * 255)

        # Measure the arrival cadence from the frame timestamps themselves; the
        # wall-clock of the whole loop would include ICE/DTLS setup.
        span = (frame_times[-1] - frame_times[0]) if len(frame_times) >= 2 else 0.0
        fps = (len(frame_times) - 1) / span if span > 0 else 0.0
        print(
            f"[6/6] {len(received)} frame(s) decoded, {size} each, "
            f"{fps:.1f} fps over {span:.2f}s"
        )
        print(f"      first frame {frame_times[0] - started:.2f}s after the answer")
        print(f"      pc connectionState: {connection_state}")
        print(f"      distinct frames: {distinct}/{len(received)}")
        print(f"      first→last frame pixel change: {changed:.2f}% of full scale")
        for path in saved:
            print(f"      wrote {os.path.relpath(path, os.path.dirname(DEFAULT_OUT))}")

        after = http_json("GET", f"{base}/streaming/status", token=token)
        print(
            f"      relay after offer: sources={after.get('source_tracks')} "
            f"pcs={after.get('total_pcs')}"
        )

        # One distinct frame means the renderer is frozen: the picture decoded,
        # but nothing about it is live, which is exactly what a broken camera
        # looks like from the dashboard's point of view.
        if distinct < 2:
            print(
                "\nFAILED: every decoded frame is identical — the picture is not "
                "animating, so the feed is not live.",
                file=sys.stderr,
            )
            return 1

        print("\nCAMERA PIPELINE OK — /live-camera gets live, animating video.")
        return 0

    except CheckError as error:
        print(f"\nFAILED at step '{step}': {error}", file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.getenv("FAKE_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin123")
    parser.add_argument("--robot", default=os.getenv("FAKE_CAMERA_ROBOT", "amr_1"))
    parser.add_argument("--frames", type=int, default=12, help="frames to collect")
    parser.add_argument("--save", type=int, default=3, help="frames to write as PNG")
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--timeout", type=float, default=20.0, help="seconds for frames")
    parser.add_argument("--ice-timeout", type=float, default=2.0)
    args = parser.parse_args(argv)

    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
