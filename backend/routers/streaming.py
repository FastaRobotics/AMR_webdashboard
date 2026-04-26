import asyncio
import cv2
import numpy as np

from fastapi import FastAPI, Request, APIRouter
from fastapi.responses import StreamingResponse
from routers.auth import get_current_user
from routers.connection import * 

from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    RTCConfiguration,
    RTCIceServer,
)

router = APIRouter(prefix="/streaming", tags=["streaming"])

# ─────────────────────────────
# GLOBAL STATE
# ─────────────────────────────
active_connections = set()
latest_frame = None
frame_lock = asyncio.Lock()


# ─────────────────────────────
# WEBRTC OFFER ENDPOINT
# ─────────────────────────────
@router.post("/offer")
async def offer(request: Request,
                current_user=Depends(get_current_user),):
    params = await request.json()

    offer = RTCSessionDescription(
        sdp=params["sdp"],
        type=params["type"]
    )

    config = RTCConfiguration(
        iceServers=[RTCIceServer(urls=["stun:127.0.0.1:3478"])]
    )

    pc = RTCPeerConnection(configuration=config)
    active_connections.add(pc)

    # ─────────────────────────────
    # VIDEO TRACK ONLY
    # ─────────────────────────────
    @pc.on("track")
    def on_track(track):
        global latest_frame

        if track.kind != "video":
            return

        print("📹 Video track connected")

        async def video_loop():
            global latest_frame

            try:
                while True:
                    frame = await track.recv()
                    img = frame.to_ndarray(format="bgr24")

                    ok, jpg = cv2.imencode(".jpg", img)
                    if ok:
                        async with frame_lock:
                            latest_frame = jpg.tobytes()

            except Exception as e:
                print("Video ended:", e)

        asyncio.create_task(video_loop())

    # ─────────────────────────────
    # NEGOTIATION
    # ─────────────────────────────
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    await asyncio.sleep(0.3)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    }


# ─────────────────────────────
# MJPEG STREAM
# ─────────────────────────────
async def mjpeg_generator():
    global latest_frame

    while True:
        async with frame_lock:
            frame = latest_frame

        if frame:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" +
                frame +
                b"\r\n"
            )

        await asyncio.sleep(0.03)


@router.get("/video")
async def video(current_user=Depends(get_current_user),):
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )