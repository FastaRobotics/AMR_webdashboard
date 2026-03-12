from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import authenticate
from routers.connection import *
import asyncio 

router = APIRouter(prefix="/socket", tags=["socket"])


@router.websocket("/{robot_id}/ws/subscribe/{topic_name}")
async def robot_ws(
    websocket: WebSocket,
    robot_id: Robots, 
    topic_name: str,
    current_user=Depends(authenticate)
    ):                    
    await websocket.accept()

    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    # subscribe once
    robot.subscribe(topic_name)

    try:
        while True:
            data = {
                "robot_id": robot_id,
                "status": robot.status.value,
                "odom": robot.get_last_message(robot.SubscribableTopics.odom),
                "tf": robot.get_last_message(robot.SubscribableTopics.tf), 
                "map": robot.get_last_message(robot.SubscribableTopics.map)
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.05)  # 20Hz stream

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/robots/{robot_id}/ws/publish")
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
            elif cmd_type == "pose":
                robot.publish_pose(data["position"], data["orientation"])
            elif cmd_type == "goal_pose":
                robot.publish_goal_pose(data["header"], data["pose"])
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