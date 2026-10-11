"""Mirror of backend/routers/connection.py.

Routes, response bodies and status codes are identical. The robot registry is
built from ``config.settings.robots`` (same ids, host and ports as the real
file's hardcoded ``ROBOTS`` dict) so the addresses can be overridden with
``FAKE_AMR_HOST`` / ``FAKE_GO2_HOST`` and friends.

Note that ``/connection/{robot_id}/connect`` and ``/connection/{robot_id}/disconnect``
are unauthenticated in the real backend too (the dependency is commented out
there), so they are unauthenticated here: same public surface, no surprises for
the frontend.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Body, Path
from routers.auth import get_current_user
from typing import Dict, Optional
from enum import Enum
import random

from ros_bridge.connection.ConnectRequest import ConnectRequest, RequestType
from robot import Robot
from amr_robot import AMR
from go2_robot import Go2
from config import settings


class Robots(str, Enum):
    AMR_1 = "amr_1"
    GO2_1 = "go2_1"

class ConnectionType(str, Enum):
    CONNECT = "connect"
    DISCONNECT = "disconnect"

ROBOTS: Dict[str, Robot] = {}
ROBOTS['amr_1'] = AMR(
    robot_id="amr_1",
    port=int(settings.robots["amr_1"]["port"]),
    host=str(settings.robots["amr_1"]["host"]),
)
ROBOTS['go2_1'] = Go2(
    robot_id="go2_1",
    port=int(settings.robots["go2_1"]["port"]),
    host=str(settings.robots["go2_1"]["host"]),
)

# --------- Helpers ---------
def robot_id_value(robot_id) -> str:
    """Path params arrive as ``Robots`` members; the wire form is their value.

    ``str(Robots.AMR_1)`` is ``"Robots.AMR_1"``, which the real backend leaks
    into its status message; the value ("amr_1") is what the UI expects to read.
    """

    return str(getattr(robot_id, "value", robot_id))


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
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot. for example amr_1"),
    type: ConnectionType = Path(..., description="Connect or Disconnect"),
    host: Optional[str] = Body("0.0.0.0", description="ROS bridge host IP address. Required for connect, ignored for disconnect"),
    port: Optional[int] = Body(9090, description="ROS bridge port. Required for connect, ignored for disconnect")
    ):
    """
    Connect an existing robot by id.
    Robot id is defined in the ROBOTS dict. For example,
    to connect to amr_1, send a POST request to
    /connection/connect/amr_1 with body {
        "host": "192.168.1.219",
        "port": 9090
    }
    """
    try:
        robot = get_robot(robot_id)

        if type == ConnectionType.CONNECT:
            robot.connect(host=host, port=port)
            return {"message": f"Robot '{robot_id_value(robot_id)}' connected"}

        elif type == ConnectionType.DISCONNECT:
            robot.disconnect()
            return {"message": f"Robot '{robot_id_value(robot_id)}' disconnected"}

    except TimeoutError as e:
        raise HTTPException(
            status_code=504,
            detail=f"Failed to connect to ROS bridge for robot '{robot_id}': {str(e)}."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{robot_id}/status")
async def connection_status(
    current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot. for example amr_1")):
    """ Get the connection status of a robot. Returns whether the robot is connected to ROS or not.

    Unlike the real backend this always answers: backend/robot.py calls
    ``self.ros.is_connected()`` while roslibpy defines it as a property, so the
    real endpoint raises a TypeError (HTTP 500) for any robot that has connected
    at least once, and the dashboard can never see it come online.
    """
    try:
        robot = get_robot(robot_id)
        status = robot.get_connection_status()
        name = robot_id_value(robot_id)
        return {"message": f"Connection status for {name}: {'Connected' if status['connection'] else 'Disconnected'}"}

    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")

@router.get("/robot_list")
async def robot_list(current_user=Depends(get_current_user),):
    return [
        {
            "id": robot_id,
            "type": robot.__class__.__name__
        }
        for robot_id, robot in ROBOTS.items()
    ]
