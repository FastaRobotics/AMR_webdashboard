from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBasic
from routers.auth import get_current_user
from routers.connection import *
import sqlite3
from pydantic import BaseModel

router = APIRouter(prefix="/navigation", tags=["navigation"])

# navigation service (for navigation)
@router.post("/{robot_id}/start")
async def start_navigation(
    current_user=Depends(get_current_user),
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
    

@router.post("/{robot_id}/stop")
async def stop_navigation(
    current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot")
    ):
    """
    Stop navigation service on the robot.
    This will stop the navigation process and save the generated map.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to stop navigation on amr_1,
    send a POST request to /robots/amr_1/navigation/stop
    """
    try: 
        robot = get_robot(robot_id)
        robot.stop_navigation()
        return {"status": "navigation stopped", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# exploring service (for auto mapping)
@router.post("/{robot_id}/exploring/start")
async def start_exploring(
    current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot")
    ):
    """
    Start exploring service on the robot.
    This will start the auto mapping process where the robot
    will explore the environment and generate a map of the environment.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to start exploring on amr_1,
    send a POST request to /robots/amr_1/exploring/start
    """
    try: 
        robot = get_robot(robot_id)
        robot.start_exploring()
        return {"status": "exploring started", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@router.post("/{robot_id}/exploring/stop")
async def stop_exploring(
    current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot")
    ):
    """
    Stop exploring service on the robot.
    This will stop the auto mapping process and save the generated map.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to stop exploring on amr_1,
    send a POST request to /robots/amr_1/exploring/stop
    """
    try: 
        robot = get_robot(robot_id)
        robot.stop_exploring()
        return {"status": "exploring stopped", "robot_id": robot_id }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

