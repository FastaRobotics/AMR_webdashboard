import asyncio
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay

from routers.auth import get_current_user


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server")


relay = MediaRelay()

source_tracks: list = []

# New: metadata sent by the bridge.
source_track_infos: list[dict] = []

client_pc: RTCPeerConnection | None = None
all_pcs: set[RTCPeerConnection] = set()

router = APIRouter(prefix="/streaming", tags=["streaming"])


class TrackInfo(BaseModel):
    slot: int
    label: str
    topic: Optional[str] = None
    sender_track_id: Optional[str] = None


class OfferRequest(BaseModel):
    sdp: str
    type: str

    # For /offer/client this is filled by bridge.
    # For /offer/browser this can be empty.
    tracks: list[TrackInfo] = []


def pydantic_to_dict(model: BaseModel) -> dict:
    """
    Works with both Pydantic v1 and v2.
    """
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


@router.post("/offer/client")
async def offer_client(
    body: OfferRequest,
    current_user=Depends(get_current_user),
):
    global client_pc, relay, source_tracks, source_track_infos

    offer_sdp = RTCSessionDescription(sdp=body.sdp, type=body.type)

    if client_pc is not None:
        logger.info("Client reconnected — closing old client PC")
        await client_pc.close()
        all_pcs.discard(client_pc)

        relay = MediaRelay()
        source_tracks = []
        source_track_infos = []

    # Store bridge metadata immediately.
    # This is Fix 4 backend side.
    source_track_infos = [
        pydantic_to_dict(track_info)
        for track_info in body.tracks
    ]

    logger.info(f"Received source track metadata: {source_track_infos}")

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
        Store raw source track.

        We match track metadata by arrival index.
        This is good enough if the bridge always creates tracks in config order.
        """

        index = len(source_tracks)

        logger.info(
            f"[{pc_id}] Source track index={index}, "
            f"kind={track.kind}, id={track.id[:8]}…"
        )

        source_tracks.append(track)

        if index < len(source_track_infos):
            source_track_infos[index]["receiver_track_id"] = track.id
            source_track_infos[index]["kind"] = track.kind
        else:
            # Fallback if bridge sent no metadata for this track.
            source_track_infos.append(
                {
                    "slot": index,
                    "label": f"camera_{index}",
                    "topic": None,
                    "sender_track_id": None,
                    "receiver_track_id": track.id,
                    "kind": track.kind,
                }
            )

        logger.info(
            f"Source tracks ready: {len(source_tracks)}, "
            f"metadata: {source_track_infos}"
        )

    await pc.setRemoteDescription(offer_sdp)

    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    }


@router.post("/offer/browser")
async def offer_browser(
    body: OfferRequest,
    current_user=Depends(get_current_user),
):
    offer_sdp = RTCSessionDescription(sdp=body.sdp, type=body.type)

    pc = RTCPeerConnection()
    pc_id = f"BROWSER-{id(pc)}"

    all_pcs.add(pc)

    logger.info(
        f"[{pc_id}] Browser PC created — "
        f"{len(source_tracks)} source tracks available"
    )

    @pc.on("connectionstatechange")
    async def on_state():
        logger.info(f"[{pc_id}] State: {pc.connectionState}")

        if pc.connectionState in ("failed", "closed"):
            all_pcs.discard(pc)

    # Add tracks in the same order as metadata.
    for index, track in enumerate(source_tracks):
        proxy = relay.subscribe(track, buffered=False)
        pc.addTrack(proxy)

        label = (
            source_track_infos[index].get("label")
            if index < len(source_track_infos)
            else f"camera_{index}"
        )

        logger.info(
            f"[{pc_id}] Subscribed to source track index={index}, "
            f"label={label}, "
            f"source={track.id[:8]}… → proxy={id(proxy)}"
        )

    await pc.setRemoteDescription(offer_sdp)

    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    # This is Fix 6.
    # Browser receives metadata and can attach streams by slot/label.
    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
        "track_count": len(source_tracks),
        "tracks": source_track_infos,
    }


@router.get("/status")
async def stream_status(current_user=Depends(get_current_user)):
    return {
        "client_connected": (
            client_pc is not None
            and client_pc.connectionState == "connected"
        ),
        "source_tracks": len(source_tracks),
        "track_infos": source_track_infos,
        "total_pcs": len(all_pcs),
    }


@router.get("/viewer", response_class=HTMLResponse)
async def viewer(current_user=Depends(get_current_user)):
    html_path = os.path.join(os.path.dirname(__file__), "viewer.html")
    with open(html_path) as f:
        return f.read()


async def shutdown_webrtc():
    await asyncio.gather(*[pc.close() for pc in list(all_pcs)])
    all_pcs.clear()