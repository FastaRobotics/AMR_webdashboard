from fastapi import APIRouter, Depends
from routers.auth import get_current_user
from routers.connection import * 
import sqlite3
from pydantic import BaseModel

router = APIRouter(prefix="/mapping", tags=["mapping"])

# Mapping
@router.post("/{robot_id}/start")
async def start_mapping(
    current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot")
    ):
    """
    Start mapping service on the robot.
    This will start the SLAM process and generate a map of the environment.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to start mapping on amr_1,
    send a POST request to /amr_1/mapping/start
    """
    try: 
        robot = get_robot(robot_id)
        response = robot.start_mapping()
        return {"status": "map started", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{robot_id}/stop")
async def stop_mapping(
    current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    map_name: str = Body("latest", description="Name of the map to save"),
    save_visual_slam_map: bool = Body(True, description="Whether to save the visual SLAM map"),
    overwrite_visual_slam_map_folder: bool = Body(True, description="Whether to overwrite the visual SLAM map folder"),
    ):
    """
    Stop mapping service on the robot.
    This will stop the SLAM process and save the generated map.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to stop mapping on amr_1,
    send a POST request to /amr_1/mapping/stop
    """
    try: 
        request = {
            "map_name": map_name,
            "save_visual_slam_map": save_visual_slam_map,
            "overwrite_visual_slam_map_folder": overwrite_visual_slam_map_folder,
        }

        robot = get_robot(robot_id)
        response = robot.stop_mapping(request)
        return {"status": "map stopped", "robot_id": robot_id, "response": response }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{robot_id}/delete")
async def delete_mapping(current_user=Depends(get_current_user), 
                         robot_id: Robots = Path(..., description="Unique ID of the robot"), 
                         map_name: str = Body("latest", description="Name of the map to delete")):
    """ Delete the current mapping.
    This will delete the generated map from the database.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to delete mapping on amr_1,
    send a DELETE request to /amr_1/mapping/delete"""
    return {"message": "mapping deleted"}

@router.post("/{robot_id}/save_location")
async def save_location(current_user=Depends(get_current_user),
                        robot_id: Robots = Path(..., description="Unique ID of the robot")):
    """ Save the current location of the robot.
    This will save the current location of the robot to the database.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to save location on amr_1,
    send a POST request to /amr_1/mapping/save_location"""
    return {"message": "location saved"}
