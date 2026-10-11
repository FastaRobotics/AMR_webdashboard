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
    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    try:
        while True:
            msg = await websocket.receive_json()

            cmd_type = msg.get("type")
            data = msg.get("data")

            if cmd_type == "twist":
                robot.publish_twist(data["linear"], data["angular"])

            else:
                await websocket.send_json({"error": f"Unknown command type {cmd_type}"})
                continue

            await websocket.send_json({"status": "ok", "type": cmd_type})

    except WebSocketDisconnect:
        print(f"[WS PUB] {robot_id} client disconnected")

    except Exception as e:
        print(f"[WS PUB ERROR {robot_id}]", e)

    finally:
        try:
            await websocket.close()
        except:
            pass