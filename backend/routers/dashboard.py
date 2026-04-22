from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBasic
from routers.auth import authenticate
from routers.connection import *
import sqlite3
from pydantic import BaseModel

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# navigation service (for navigation)
@router.post("/{robot_id}/start")
async def start_navigation(
    current_user=Depends(authenticate),
    robot_id: Robots = Path(..., description="Unique ID of the robot")
    ):
    """
    Start navigation service on the robot.
    This will start the navigation process where the robot will navigate to the goal pose.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to start navigation on amr_1,
    send a POST request to /robots/amr_1/navigation/start
    """
    try: 
        robot = get_robot(robot_id)
        robot.start_navigation()
        return {"status": "exploring started", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

