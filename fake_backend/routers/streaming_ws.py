"""Mirror of backend/routers/streaming_ws.py — the telemetry sockets.

    ws://host/streaming_socket/{robot_id}/ws/subscribe/{map|odom|tf|diagnostics|path}

The envelope is unchanged:

    {"robot_id": "amr_1", "status": "idle", "odom": {...}}

and so is the push rate (2 Hz for map, 10 Hz for odom/tf, and 2 Hz for
diagnostics/path) and
the "robot not connected" error frame that closes the socket.

Fixes over the real backend:

* a topic the robot does not publish (``map``/``diagnostics``/``path`` on
  ``go2_1``) is answered with
  ``{"error": "topic 'map' is not available on robot 'go2_1'"}`` and a clean
  close, where the real backend dies with an ``AttributeError`` and the browser
  only sees an abnormal 1006 close (which makes the UI retry five times);
* a topic whose latched message has not arrived yet (``subscribe()`` returns
  ``None`` for a few milliseconds after the socket opens) is waited out rather
  than sent as ``{"robot_id": ..., "status": ..., "odom": null}``;
* an unexpected internal error is reported as an error frame before closing;
* the five endpoints share one implementation instead of five copies of it.
"""

import asyncio

from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import get_current_user
from routers.connection import *


router = APIRouter(prefix="/streaming_socket", tags=["streaming_socket"])

#: how many sockets are currently streaming each (robot, topic) pair
_active_sockets: dict[tuple[str, str], int] = {}


def _acquire(robot_id: str, topic: str) -> None:
    key = (str(robot_id), topic)
    _active_sockets[key] = _active_sockets.get(key, 0) + 1


def _release(robot: Robot, robot_id: str, topic: str) -> None:
    """Unsubscribe once the last socket for this topic has gone away."""

    key = (str(robot_id), topic)
    remaining = _active_sockets.get(key, 1) - 1
    if remaining <= 0:
        _active_sockets.pop(key, None)
        robot.release_subscription(topic)
    else:
        _active_sockets[key] = remaining


async def _stream_topic(
    websocket: WebSocket,
    robot_id: Robots,
    topic: str,
    key: str,
    subscribe_method: str,
    interval_s: float,
) -> None:
    await websocket.accept()

    try:
        robot = get_robot(robot_id)
    except HTTPException as error:
        await websocket.send_json({"error": error.detail})
        await websocket.close()
        return

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    if not robot.supports_topic(topic):
        await websocket.send_json(
            {"error": f"topic '{topic}' is not available on robot '{robot_id_value(robot_id)}'"}
        )
        await websocket.close()
        return

    # Same call the real backend makes on every iteration (subscribe once, then
    # hand back the latched message).
    subscribe = getattr(robot, subscribe_method)
    _acquire(robot_id, topic)

    try:
        while True:
            payload = subscribe()

            # A subscription has no latched message until the robot has actually
            # published on the topic (odom/tf at 20 Hz, diagnostics/path at
            # 2 Hz), which is a few milliseconds after `subscribe()`. Sending
            # that first `null` would put a frame on the wire whose envelope
            # advertises the topic but carries no message, so wait for real data
            # instead. `path` legitimately stays silent until a plan exists.
            if payload is not None:
                data = {
                    "robot_id": robot_id_value(robot_id),
                    "status": robot.status.value,
                    key: payload,
                }

                await websocket.send_json(data)

            await asyncio.sleep(interval_s)

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)
        try:
            await websocket.send_json({"error": f"internal error: {e}"})
        except Exception:
            pass

    finally:
        _release(robot, robot_id, topic)
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/{robot_id}/ws/subscribe/map")
async def map_ws(
    websocket: WebSocket,
    robot_id: Robots,
    ):
    """
    WebSocket endpoint to subscribe to robot map updates.

    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/map

    Streams the full map at 2Hz to connected clients. Map updates are large,
    while robot pose remains available at 10Hz over the odometry socket.
    Returns robot status and current map when available.

    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to subscribe to

    Returns:
        JSON stream with robot_id, status, and map data

    Raises:
        HTTPException: If robot is not connected
    """
    await _stream_topic(websocket, robot_id, "map", "map", "subscribe_map", 0.5)


@router.websocket("/{robot_id}/ws/subscribe/odom")
async def odom_ws(
    websocket: WebSocket,
    robot_id: Robots,
    ):
    """
    WebSocket endpoint to subscribe to robot odometry updates.

    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/odom

    Continuously streams the robot's odometry data at 10Hz to connected clients.
    Returns robot status and current odometry information.

    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to subscribe to

    Returns:
        JSON stream with robot_id, status, and odom data

    Raises:
        HTTPException: If robot is not connected
    """
    await _stream_topic(websocket, robot_id, "odom", "odom", "subscribe_odom", 0.1)


@router.websocket("/{robot_id}/ws/subscribe/tf")
async def tf_ws(
    websocket: WebSocket,
    robot_id: Robots,
    ):
    """
    WebSocket endpoint to subscribe to robot transform (tf) updates.

    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/tf

    Continuously streams the robot's transformation data at 10Hz to connected clients.
    Returns robot status and current transform information.

    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to subscribe to

    Returns:
        JSON stream with robot_id, status, and tf data

    Raises:
        HTTPException: If robot is not connected
    """
    await _stream_topic(websocket, robot_id, "tf", "tf", "subscribe_tf", 0.1)


@router.websocket("/{robot_id}/ws/subscribe/diagnostics")
async def diagnostics_ws(
    websocket: WebSocket,
    robot_id: Robots,
    ):
    """
    WebSocket endpoint to subscribe to robot diagnostics updates.

    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/diagnostics

    Continuously streams the robot's diagnostic data at 10Hz to connected clients.
    Returns robot status and current diagnostic information.

    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to subscribe to

    Returns:
        JSON stream with robot_id, status, and diagnostics data

    Raises:
        HTTPException: If robot is not connected
    """
    await _stream_topic(
        websocket, robot_id, "diagnostics", "diagnostics", "subscribe_diagnostics", 0.5
    )


@router.websocket("/{robot_id}/ws/subscribe/path")
async def path_ws(
    websocket: WebSocket,
    robot_id: Robots,
    ):
    """
    WebSocket endpoint to subscribe to robot path updates.

    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/path

    Continuously streams the robot's path data at 10Hz to connected clients.
    Returns robot status and current path information.

    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to subscribe to

    Returns:
        JSON stream with robot_id, status, and path data

    Raises:
        HTTPException: If robot is not connected
    """
    await _stream_topic(websocket, robot_id, "path", "path", "subscribe_path", 0.5)
