from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBasic
from routers.auth import get_current_user
from routers.connection import *
import sqlite3
from pydantic import BaseModel
from enum import Enum

class State(str, Enum):
    activate = "activate"
    deactivate = "deactivate"

router = APIRouter(prefix="/navigation", tags=["navigation"])

# navigation service (for navigation)
@router.post("/{robot_id}/start")
async def start_navigation(
    # current_user=Depends(get_current_user),
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
        response = robot.start_navigation()
        return {"status": "navigation started", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{robot_id}/start_with_map")
async def start_navigation_with_map(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    map_name: str = Body("latest", description="Name of the map to save"),
    localize_after_load: bool = Body(True, description="Whether to localize after load map."),
    localize_failure_is_fatal: bool = Body(True, description="Whether localization failure is fatal and terminate the navigation."),
    pose_hint_position_xyz: list = Body([0.0, 0.0, 0.0], description="Position hint for localization."),
    pose_hint_orientation_xyzw: list = Body([0.0, 0.0, 0.0, 1.0], description="Orientation hint for localization."),
    ):
    """
    Start navigation service on the robot with map name.
    This will start the navigation process where the robot will navigate to the goal pose.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to start navigation on amr_1,
    send a POST request to /robots/amr_1/navigation/start_with_map
    """
    try: 
        request = {
            "map_name": map_name,
            "localize_after_load": localize_after_load,
            "localize_failure_is_fatal": localize_failure_is_fatal,
            "pose_hint_position_xyz": pose_hint_position_xyz,
            "pose_hint_orientation_xyzw": pose_hint_orientation_xyzw,            
        }
        robot = get_robot(robot_id)
        response = robot.start_navigation_with_map(request)
        return {"status": "navigation started", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@router.post("/{robot_id}/goal_pose")
async def send_goal_pose(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    position_xyz: list = Body([0.0, 0.0, 0.0], description="Goal position in the map frame."),
    orientation_xyzw: list = Body([0.0, 0.0, 0.0, 1.0], description="Goal orientation quaternion."),
    frame_id: str = Body("map", description="Frame of the goal pose."),
    ):
    """
    Publish a navigation goal pose for the robot.
    Nav2's bt_navigator subscribes to /goal_pose and will drive the robot there.
    For example, send a POST request to /navigation/amr_1/goal_pose with body
    {"position_xyz": [1.0, 2.0, 0.0], "orientation_xyzw": [0.0, 0.0, 0.0, 1.0]}
    """
    try:
        robot = get_robot(robot_id)
        header = {"frame_id": frame_id, "stamp": {"sec": 0, "nanosec": 0}}
        pose = {
            "position": {"x": position_xyz[0], "y": position_xyz[1], "z": position_xyz[2]},
            "orientation": {
                "x": orientation_xyzw[0],
                "y": orientation_xyzw[1],
                "z": orientation_xyzw[2],
                "w": orientation_xyzw[3],
            },
        }
        response = robot.publish_goal_pose(header, pose)
        return {"status": "goal pose sent", "robot_id": robot_id, "response": response}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{robot_id}/stop")
async def stop_navigation(
    # current_user=Depends(get_current_user),
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
        response = robot.stop_navigation()
        return {"status": "navigation stopped", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# exploring service (for auto mapping)
@router.post("/{robot_id}/exploring/start")
async def start_exploring(
    # current_user=Depends(get_current_user),
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
        response = robot.start_exploring()
        return {"status": "exploring started", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@router.post("/{robot_id}/exploring/stop")
async def stop_exploring(
    # current_user=Depends(get_current_user),
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
        response = robot.stop_exploring()
        return {"status": "exploring stopped", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{robot_id}/emergency_stop/{state}")
async def emergency_stop(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    state: State = Path(..., description="Emergency stop state")
    ):
    """
    Activate emergency stop on the robot.
    This will immediately stop all robot movement and save the generated map.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to activate emergency stop on amr_1,
    send a POST request to /robots/amr_1/emergency_stop
    """
    try: 
        robot = get_robot(robot_id)
        if state == State.activate:
            response = robot.publish_emergency_stop(True)
        else:
            response = robot.publish_emergency_stop(False)

        return {"status": "emergency stop activated", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))