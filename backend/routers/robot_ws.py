from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import get_current_user
from routers.connection import *
import asyncio 


router = APIRouter(prefix="/socket", tags=["socket"])
        
@router.websocket("/{robot_id}/ws/subscribe/map")
async def robot_ws(
    websocket: WebSocket,
    robot_id: Robots, 
    ):                    
    await websocket.accept()

    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    try:
        while True:
            data = {
                "robot_id": robot_id,
                "status": robot.status.value,
                "map": robot.subscribe_map()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.1)  # 10Hz stream

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/{robot_id}/ws/subscribe/odom")
async def robot_ws(
    websocket: WebSocket,
    robot_id: Robots, 
    ):                    
    await websocket.accept()

    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    try:
        while True:
            data = {
                "robot_id": robot_id,
                "status": robot.status.value,
                "odom": robot.subscribe_odom()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.1)  # 10Hz stream

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/{robot_id}/ws/subscribe/tf")
async def robot_ws(
    websocket: WebSocket,
    robot_id: Robots, 
    ):                    
    await websocket.accept()

    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    try:
        while True:
            data = {
                "robot_id": robot_id,
                "status": robot.status.value,
                "tf": robot.subscribe_tf()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.1)  # 10Hz stream

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/robots/{robot_id}/ws/publish/twist")
async def robot_publish_ws(websocket: WebSocket, robot_id: Robots):
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