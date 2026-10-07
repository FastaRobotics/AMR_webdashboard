"""Mirror of backend/routers/control.py — the teleoperation socket.

    ws://host/control_socket/robots/{robot_id}/ws/publish/twist

Protocol (unchanged):

    -> {"type": "twist", "data": {"linear": 0.4, "angular": 0.0}}
    <- {"status": "ok", "type": "twist"}

Fixes over the real backend:

* an unknown or missing ``type`` returns an error frame instead of killing the
  socket with an unhandled ``KeyError``;
* a malformed payload returns an error frame instead of a traceback;
* the twist values are accepted in both shapes the dashboard and ROS use:
  a scalar (``{"linear": 0.4, "angular": 0.0}`` — what the UI sends) and a
  vector (``{"linear": {"x": 0.4}, "angular": {"z": 0.0}}``).
"""

from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import get_current_user
from routers.connection import *
import asyncio


router = APIRouter(prefix="/control_socket", tags=["control_socket"])

@router.websocket("/robots/{robot_id}/ws/publish/twist")
async def robot_publish_ws(websocket: WebSocket, robot_id: Robots):
    """
    WebSocket endpoint to publish twist commands to the robot.

    URL: ws://localhost:8000/control_socket/robots/{robot_id}/ws/publish/twist

    Allows clients to send velocity commands (linear and angular) to control
    robot movement. Expects JSON messages with type and data fields.

    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to control

    Expected message format:
        {
            "type": "twist",
            "data": {
                "linear": <linear_velocity>,
                "angular": <angular_velocity>
            }
        }

    Returns:
        JSON confirmation with status and command type

    Raises:
        HTTPException: If robot is not connected
    """
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

    try:
        while True:
            msg = await websocket.receive_json()

            if not isinstance(msg, dict):
                await websocket.send_json({"error": "expected a JSON object"})
                continue

            cmd_type = msg.get("type")
            data = msg.get("data")

            if cmd_type == "twist":
                if not isinstance(data, dict) or "linear" not in data or "angular" not in data:
                    await websocket.send_json(
                        {"error": "twist requires data.linear and data.angular"}
                    )
                    continue
                try:
                    robot.publish_twist(data["linear"], data["angular"])
                except (TypeError, ValueError) as error:
                    await websocket.send_json({"error": f"invalid twist values: {error}"})
                    continue

            else:
                await websocket.send_json({"error": f"Unknown command type {cmd_type}"})
                continue

            await websocket.send_json({"status": "ok", "type": cmd_type})

    except WebSocketDisconnect:
        print(f"[WS PUB] {robot_id} client disconnected")

    except Exception as e:
        print(f"[WS PUB ERROR {robot_id}]", e)
        try:
            await websocket.send_json({"error": f"internal error: {e}"})
        except Exception:
            pass

    finally:
        try:
            await websocket.close()
        except:
            pass
