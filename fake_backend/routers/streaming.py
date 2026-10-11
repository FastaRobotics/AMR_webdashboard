"""Mirror of backend/routers/streaming.py — WebRTC signalling.

Same four endpoints and the same relay design as the real backend:

* ``POST /streaming/offer/client``  — the robot side offers; its tracks become
  the relay sources;
* ``POST /streaming/offer/browser`` — each browser gets its own proxy track per
  source, via ``MediaRelay.subscribe(track, buffered=False)``;
* ``GET  /streaming/status``        — ``client_connected`` / ``source_tracks`` /
  ``total_pcs``;
* ``GET  /streaming/viewer``        — the bundled test page.

Because no robot pushes a camera in the fake setup, a synthetic animated camera
track is added as a relay source (``FAKE_SYNTHETIC_CAMERA=0`` disables it), so
``offer/browser`` really does negotiate and stream video and the viewer page
works end to end.

If ``aiortc`` is not installed, the signalling endpoints answer 501 with an
explanation instead of crashing — the rest of the API is unaffected.

The peer connections are created with an explicit empty ``iceServers`` list; the
default (a public STUN server plus mDNS resolution of the browser's host
candidates) added ~5 s to every ``setLocalDescription()`` on this localhost
deployment. See ``_new_peer_connection``.
"""

import asyncio
import logging
import os
from fractions import Fraction

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from config import settings
from routers.auth import get_current_user
from simulation.engine import get_engine
from simulation.imaging import render_camera_rgb

if settings.disable_webrtc:
    # FAKE_DISABLE_WEBRTC=1: keep aiortc/av (and their ffmpeg DLLs) out of the
    # process entirely; the signalling endpoints then answer 501.
    av = None  # type: ignore
    RTCPeerConnection = None  # type: ignore
    RTCConfiguration = None  # type: ignore
    RTCSessionDescription = None  # type: ignore
    MediaStreamTrack = object  # type: ignore
    MediaRelay = None  # type: ignore
    AIORTC_AVAILABLE = False
else:
    try:  # pragma: no cover - exercised by whichever environment runs this
        import av
        from aiortc import (
            RTCPeerConnection,
            RTCConfiguration,
            RTCSessionDescription,
            MediaStreamTrack,
        )
        from aiortc.contrib.media import MediaRelay

        AIORTC_AVAILABLE = True
    except ImportError:  # pragma: no cover
        av = None  # type: ignore
        RTCPeerConnection = None  # type: ignore
        RTCConfiguration = None  # type: ignore
        RTCSessionDescription = None  # type: ignore
        MediaStreamTrack = object  # type: ignore
        MediaRelay = None  # type: ignore
        AIORTC_AVAILABLE = False


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server")

# ── Relay state ───────────────────────────────────────────────────────────────
relay = MediaRelay() if AIORTC_AVAILABLE else None
source_tracks: list = []
client_pc = None
all_pcs: set = set()

router = APIRouter(prefix="/streaming", tags=["streaming"])

VIEWER_PATH = os.path.join(os.path.dirname(__file__), "..", "static", "viewer.html")


class OfferRequest(BaseModel):
    sdp: str
    type: str


class SyntheticCameraTrack(MediaStreamTrack if AIORTC_AVAILABLE else object):
    """A stand-in for the robot's camera: an animated test pattern."""

    kind = "video"

    def __init__(self, robot_id: str, fps: int = 12, width: int = 320, height: int = 180):
        if AIORTC_AVAILABLE:
            super().__init__()
        self.robot_id = robot_id
        self.fps = max(1, fps)
        self.width = width
        self.height = height
        self._timestamp = 0
        self._started_at = None

    async def recv(self):
        import time

        if self._started_at is None:
            self._started_at = time.time()

        self._timestamp += 1
        target = self._started_at + self._timestamp / self.fps
        delay = target - time.time()
        if delay > 0:
            await asyncio.sleep(delay)

        state = get_engine().state_for(self.robot_id)
        frame = av.VideoFrame(self.width, self.height, format="rgb24")
        frame.planes[0].update(render_camera_rgb(state, self.width, self.height))
        frame.pts = self._timestamp
        frame.time_base = Fraction(1, self.fps)
        return frame


def _require_aiortc() -> None:
    if not AIORTC_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail=(
                "aiortc is not installed in the fake backend environment, so "
                "WebRTC signalling is unavailable. Install it with "
                "`pip install aiortc` to enable these endpoints."
            ),
        )


def _new_peer_connection() -> "RTCPeerConnection":
    """A peer connection that does not stall for ~5 s on ICE gathering.

    ``aiortc`` defaults to a Google STUN server, which puts every server-side
    ``setLocalDescription()`` behind a round trip that this localhost deployment
    does not need. Browsers also hand over host candidates whose addresses are
    mDNS names such as ``8d7e1599-….local``; resolving those costs another
    timeout when they do not answer.

    Measured on this checkout: the default configuration made
    ``setLocalDescription(answer)`` take **5.0 s**, while an explicit empty
    ``iceServers`` list brings the whole signalling round trip down to **~10 ms**
    and does not change the media path at all — the browser and the server still
    exchange host candidates directly, which is what the relay needs. A real
    deployment that must traverse NAT should install a TURN server and add it
    here.
    """

    return RTCPeerConnection(
        configuration=RTCConfiguration(iceServers=[]),
    )


def _make_synthetic_track() -> "SyntheticCameraTrack | None":
    if not settings.synthetic_camera or not AIORTC_AVAILABLE:
        return None
    return SyntheticCameraTrack(
        robot_id=settings.camera_robot, fps=settings.camera_fps
    )


def _count_peers() -> None:
    try:
        get_engine().state_for(settings.camera_robot).webrtc_peers = len(all_pcs)
    except Exception:  # pragma: no cover - diagnostics only
        pass


def _ensure_synthetic_source() -> None:
    """Seed the relay with the synthetic camera when no robot pushes tracks.

    The real backend's relay is fed by the robot client; the fake backend can be
    used without one, so a browser offer would otherwise negotiate zero tracks.
    """

    if source_tracks:
        return
    synthetic = _make_synthetic_track()
    if synthetic is not None:
        source_tracks.append(synthetic)
        logger.info("Seeded relay with the synthetic camera track")


# ── POST /streaming/offer/client ──────────────────────────────────────────────
@router.post("/offer/client")
async def offer_client(
    body: OfferRequest,
    current_user=Depends(get_current_user),
):
    _require_aiortc()

    global client_pc, relay, source_tracks

    offer_sdp = RTCSessionDescription(sdp=body.sdp, type=body.type)

    if client_pc is not None:
        logger.info("Client reconnected — closing old client PC")
        await client_pc.close()
        all_pcs.discard(client_pc)

    relay = MediaRelay()
    source_tracks = []

    pc = _new_peer_connection()
    pc_id = f"CLIENT-{id(pc)}"
    client_pc = pc
    all_pcs.add(pc)
    logger.info(f"[{pc_id}] Client PC created")

    @pc.on("connectionstatechange")
    async def on_state():
        logger.info(f"[{pc_id}] State: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed"):
            all_pcs.discard(pc)
        _count_peers()

    @pc.on("track")
    async def on_track(track):
        """
        Store the raw source track.
        DO NOT consume it here — MediaRelay will pull frames from it
        as soon as the first subscriber (browser) calls recv() on a proxy.
        """
        logger.info(f"[{pc_id}] Source track: {track.kind} {track.id[:8]}…")
        source_tracks.append(track)
        logger.info(f"Source tracks ready: {len(source_tracks)}")

    await pc.setRemoteDescription(offer_sdp)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    # The fake robot has no camera of its own: expose a synthetic one as a
    # relay source so browsers still receive a live video track.
    synthetic = _make_synthetic_track()
    if synthetic is not None:
        source_tracks.append(synthetic)
        logger.info("Added synthetic camera track as a relay source")

    _count_peers()
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}


# ── POST /streaming/offer/browser ─────────────────────────────────────────────
@router.post("/offer/browser")
async def offer_browser(
    body: OfferRequest,
    current_user=Depends(get_current_user),
):
    """
    Each browser Connect click lands here.

    For each source track we call relay.subscribe(track) which returns a
    fresh proxy MediaStreamTrack. We then addTrack(proxy) to this browser's
    PC. The proxy delivers the same frames as the source without interfering
    with any other subscriber.

    buffered=False: don't buffer frames in the proxy — send them as fast
    as they arrive from the source. This reduces latency.
    """
    _require_aiortc()

    offer_sdp = RTCSessionDescription(sdp=body.sdp, type=body.type)

    _ensure_synthetic_source()

    pc = _new_peer_connection()
    pc_id = f"BROWSER-{id(pc)}"
    all_pcs.add(pc)
    logger.info(f"[{pc_id}] Browser PC created — {len(source_tracks)} source tracks available")

    @pc.on("connectionstatechange")
    async def on_state():
        logger.info(f"[{pc_id}] State: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed"):
            all_pcs.discard(pc)
        _count_peers()

    for track in source_tracks:
        proxy = relay.subscribe(track, buffered=False)
        pc.addTrack(proxy)
        logger.info(f"[{pc_id}] Subscribed to source track {track.id[:8]}… → proxy {id(proxy)}")

    await pc.setRemoteDescription(offer_sdp)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    _count_peers()

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
        "track_count": len(source_tracks),
    }


# ── GET /streaming/status ─────────────────────────────────────────────────────
@router.get("/status")
async def stream_status(current_user=Depends(get_current_user)):
    return {
        "client_connected": client_pc is not None
        and client_pc.connectionState == "connected",
        "source_tracks": len(source_tracks),
        "total_pcs": len(all_pcs),
    }


# ── GET /streaming/viewer ─────────────────────────────────────────────────────
@router.get("/viewer", response_class=HTMLResponse)
async def viewer(current_user=Depends(get_current_user)):
    """The real backend opens ``routers/viewer.html``, which is not in the
    repository, so that route always fails there. The fake backend ships the
    page (``static/viewer.html``), so a human can watch the synthetic camera."""

    html_path = os.path.abspath(VIEWER_PATH)
    if not os.path.exists(html_path):
        raise HTTPException(status_code=500, detail=f"viewer page not found at {html_path}")
    with open(html_path, encoding="utf-8") as f:
        return f.read()


# ── Shutdown helper (registered in api.py) ────────────────────────────────────
async def shutdown_webrtc():
    if not AIORTC_AVAILABLE:
        return
    await asyncio.gather(*[pc.close() for pc in list(all_pcs)])
    all_pcs.clear()
