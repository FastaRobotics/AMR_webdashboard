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
    WebSocket endpoint to subscribe to robot map updates.
    
    URL: ws://localhost:8000/streaming_socket/{robot_id}/ws/subscribe/map
    
    Continuously streams the robot's map data at 10Hz to connected clients.
    Returns robot status and current map when available.
    
    Args:
        websocket: WebSocket connection object
        robot_id: The robot identifier to subscribe to
    
    Returns:
        JSON stream with robot_id, status, and map data
    
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
                "map": robot.subscribe_map()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.1)  # 10Hz stream

    except WebSocketDisconnect:
        print(f"{robot_id} websocket disconnected")

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
                "diagnostics": robot.subscribe_diagnostics()
            }

            await websocket.send_json(data)
            await asyncio.sleep(0.5)  # 10Hz stream

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
