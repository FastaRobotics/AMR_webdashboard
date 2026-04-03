from fastapi import APIRouter, Depends, HTTPException
from fastapi import Body, Path
from routers.auth import authenticate   
from typing import Dict, Optional
from enum import Enum

from ros_bridge.connection.ConnectRequest import ConnectRequest, RequestType
from robot import Robot  
from amr_robot import AMR
from go2_robot import Go2 

class Robots(str, Enum):
    AMR_1 = "amr_1"
    GO2_1 = "go2_1"
    
class ConnectionType(str, Enum):
    CONNECT = "connect"
    DISCONNECT = "disconnect"

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

router = APIRouter(prefix="/connection", tags=["connection"])

@router.post("/{robot_id}/{type}")
async def robot_connection(
    current_user=Depends(authenticate),
    robot_id: Robots = Path(..., description="Unique ID of the robot. for example amr_1"),
    type: ConnectionType = Path(..., description="Connect or Disconnect")
    ):
    """
    Connect an existing robot by id.
    Robot id is defined in the ROBOTS dict. For example,
    to connect to amr_1, send a POST request to 
    /connection/connect/amr_1 with body:
    """
    try:
        robot = get_robot(robot_id)
        
        if type == ConnectionType.CONNECT:
            robot.connect()
            return {"message": f"Robot '{robot_id}' connected"}
        
        elif type == ConnectionType.DISCONNECT:
            robot.disconnect()
            return {"message": f"Robot '{robot_id}' disconnected"}

    except TimeoutError as e:
        raise HTTPException(
            status_code=504,
            detail=f"Failed to connect to ROS bridge for robot '{robot_id}': {str(e)}."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{robot_id}/status")
async def connection_status(
    current_user=Depends(authenticate),
    robot_id: Robots = Path(..., description="Unique ID of the robot. for example amr_1")):
    """ Get the connection status of a robot. Returns whether the robot is connected to ROS or not."""
    try:
        robot = get_robot(robot_id)
        status = robot.get_connection_status()
        return {"message": f"Connection status for {robot_id}: {'Connected' if status['connection'] else 'Disconnected'}"}
    
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
