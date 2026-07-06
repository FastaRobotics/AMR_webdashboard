from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import get_current_user
from routers.connection import *
import asyncio 


router = APIRouter(prefix="/streaming_socket", tags=["streaming_socket"])
        
@router.websocket("/{robot_id}/ws/subscribe/map")
async def map_ws(
    websocket: WebSocket,
    robot_id: Robots, 
    ):
    """
    WebSocket endpoint to fetch the robot map once.

    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/map

    Subscribes to the ROS map topic, sends the first available map payload,
    then closes the connection. Clients should cache the map until reconnect.
    """
    await websocket.accept()

    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    try:
        robot.subscribe_map()
        map_data = robot.get_cached_map()

        if map_data is None:
            for _ in range(100):
                map_data = robot.get_cached_map()
                if map_data is not None:
                    break
                await asyncio.sleep(0.1)

        await websocket.send_json({
            "robot_id": robot_id,
            "status": robot.status.value,
            "map": map_data,
        })
        await websocket.close()

    except WebSocketDisconnect:
        print(f"{robot_id} map websocket disconnected")

    except Exception as e:
        print("WS error:", e)

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

@router.websocket("/{robot_id}/ws/subscribe/scan")
async def scan_ws(
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
                "scan": robot.subscribe_scan()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/{robot_id}/ws/subscribe/amcl_pose")
async def amcl_pose_ws(
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
                "amcl_pose": robot.subscribe_amcl_pose(),
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/{robot_id}/ws/subscribe/local_plan")
async def local_plan_ws(
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
                "local_plan": robot.subscribe_local_plan(),
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

@router.websocket("/{robot_id}/ws/subscribe/diagnostics")
async def diagnostics_ws(
    websocket: WebSocket,
    robot_id: Robots, 
    ):
    """Deprecated: use /scan instead. Kept for backward compatibility."""
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
                "scan": robot.subscribe_scan()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)

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
                "path": robot.subscribe_path()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.5)  # 10Hz stream

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

    except Exception as e:
        print("WS error:", e)
