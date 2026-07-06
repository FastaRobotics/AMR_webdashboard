import asyncio
import logging
import os

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay

from routers.auth import get_current_user

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server")

# ── Relay state ───────────────────────────────────────────────────────────────
relay = MediaRelay()
source_tracks: list = []
client_pc: RTCPeerConnection | None = None
all_pcs: set[RTCPeerConnection] = set()

router = APIRouter(prefix="/streaming", tags=["streaming"])


class OfferRequest(BaseModel):
    sdp: str
    type: str


# ── POST /streaming/offer/client ──────────────────────────────────────────────
@router.post("/offer/client")
async def offer_client(
    body: OfferRequest,
    current_user=Depends(get_current_user),
):
    global client_pc, relay, source_tracks

    offer_sdp = RTCSessionDescription(sdp=body.sdp, type=body.type)

    if client_pc is not None:
        logger.info("Client reconnected — closing old client PC")
        await client_pc.close()
        all_pcs.discard(client_pc)

    relay = MediaRelay()
    source_tracks = []

    pc = RTCPeerConnection()
    pc_id = f"CLIENT-{id(pc)}"
    client_pc = pc
    all_pcs.add(pc)
    logger.info(f"[{pc_id}] Client PC created")

    @pc.on("connectionstatechange")
    async def on_state():
        logger.info(f"[{pc_id}] State: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed"):
            all_pcs.discard(pc)

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
    offer_sdp = RTCSessionDescription(sdp=body.sdp, type=body.type)

    pc = RTCPeerConnection()
    pc_id = f"BROWSER-{id(pc)}"
    all_pcs.add(pc)
    logger.info(f"[{pc_id}] Browser PC created — {len(source_tracks)} source tracks available")

    @pc.on("connectionstatechange")
    async def on_state():
        logger.info(f"[{pc_id}] State: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed"):
            all_pcs.discard(pc)

    for track in source_tracks:
        proxy = relay.subscribe(track, buffered=False)
        pc.addTrack(proxy)
        logger.info(f"[{pc_id}] Subscribed to source track {track.id[:8]}… → proxy {id(proxy)}")

    await pc.setRemoteDescription(offer_sdp)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
        "track_count": len(source_tracks),
    }


# ── GET /streaming/status ─────────────────────────────────────────────────────
@router.get("/status")
async def stream_status(current_user=Depends(get_current_user)):
    return {
        "client_connected": client_pc is not None and client_pc.connectionState == "connected",
        "source_tracks": len(source_tracks),
        "total_pcs": len(all_pcs),
    }


# ── GET /streaming/viewer ─────────────────────────────────────────────────────
@router.get("/viewer", response_class=HTMLResponse)
async def viewer(current_user=Depends(get_current_user)):
    html_path = os.path.join(os.path.dirname(__file__), "viewer.html")
    with open(html_path) as f:
        return f.read()


# ── Shutdown helper (registered in api.py) ────────────────────────────────────
async def shutdown_webrtc():
    await asyncio.gather(*[pc.close() for pc in list(all_pcs)])
    all_pcs.clear()
