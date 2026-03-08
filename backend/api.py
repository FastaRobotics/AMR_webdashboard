from fastapi import FastAPI, HTTPException, Path
from fastapi import WebSocket, WebSocketDisconnect
import asyncio

from roslibpy import Ros
from typing import Dict, Optional

from msgs.Twist import TwistMessageRequest
from msgs.Pose import PoseMessageRequest
from msgs.GoalPose import GoalPoseMessageRequest
from srv.SaveMap import SaveMapMessageRequest
from srv.Trigger import TriggerMessageRequest 
from connection.ConnectRequest import ConnectRequest, RequestType

from robot import Robot  
from amr_robot import AMR
from go2_robot import Go2 


app = FastAPI()

ROBOTS: Dict[str, Robot] = {}
ROBOTS['amr_1'] = AMR(robot_id="amr_1", port=9090)
ROBOTS['go2_1'] = Go2(robot_id="go2_1", port=7070)

# --------- Helpers ---------
def get_robot(robot_id: str) -> Robot:
    if robot_id not in ROBOTS.keys():
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    return ROBOTS[robot_id]

def ensure_connected(robot: Robot):
    if not robot.is_connected:
        raise HTTPException(status_code=400, detail=f"Robot '{robot}' is not connected.")

# --------- Connection management ---------
@app.post("/robots/{robot_id}/connection/{connection_type}")
async def connection(
    robot_id: str = Path(..., description="Unique ID of the robot. for example amr_1"),
    connection_type: RequestType = Path(..., description="Type of connection action"),
    req: Optional[ConnectRequest] = Path(..., description="ip of the robot and port of rosbridge"),
):
    """
    Connect or disconnect an existing robot by id.
    Robot id is defined in the ROBOTS dict. For example,
    to connect to amr_1, send a POST request to 
    /robots/amr_1/connection/connect with body:
    Body fields: ip, port, request ∈ {'connect', 'disconnect'}
    """
    try:
        if req is None:
            raise HTTPException(status_code=400, detail="Missing request body.")

        robot = get_robot(robot_id)

        if connection_type == RequestType.CONNECT:
            robot.connect()
            return {"message": f"Robot '{robot_id}' connected"}

        elif connection_type == RequestType.DISCONNECT:
            robot.disconnect()
            return {"message": f"Robot '{robot_id}' disconnected"}

    except TimeoutError as e:
        raise HTTPException(
            status_code=504,
            detail=f"Failed to connect to ROS bridge for robot '{robot_id}': {str(e)}."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mapping
@app.post("/robots/{robot_id}/mapping/start")
async def start_mapping(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        robot.start_mapping()
        return {"status": "map started", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/robots/{robot_id}/mapping/stop")
async def stop_mapping(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        robot.stop_mapping()
        return {"status": "map stopped", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# exploring service (for auto mapping)
@app.post("/robots/{robot_id}/exploring/start")
async def start_exploring(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        robot.start_exploring()
        return {"status": "exploring started", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@app.post("/robots/{robot_id}/exploring/stop")
async def stop_exploring(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        robot.stop_exploring()
        return {"status": "exploring stopped", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# navigation service (for navigation)
@app.post("/robots/{robot_id}/navigation/start")
async def start_navigation(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        robot.start_navigation()
        return {"status": "exploring started", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@app.post("/robots/{robot_id}/navigation/stop")
async def stop_navigation(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        robot.stop_navigation()
        return {"status": "navigation stopped", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/robots/{robot_id}/ws/subscribing")
async def robot_ws(websocket: WebSocket, robot_id: str):
    await websocket.accept()

    robot = get_robot(robot_id)

    if not robot.is_connected():
        await websocket.send_json({"error": "robot not connected"})
        await websocket.close()
        return

    # subscribe once
    robot.subscribe_odom()
    robot.subscribe_tf()
    robot.subscribe_map()

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

@app.websocket("/robots/{robot_id}/ws/publish")
async def robot_publish_ws(websocket: WebSocket, robot_id: str):
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


