from fastapi import APIRouter, Depends
from routers.auth import get_current_user
from routers.connection import * 
import sqlite3
from pydantic import BaseModel

router = APIRouter(prefix="/recording", tags=["recording"])

# Recording
@router.post("/{robot_id}/start")
async def start_recording(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    rosbag_name: str = Body("latest", description="Name of the rosbag to save"),
    ):
    """
    Start recording rosbag on the robot.
    This will start recording the robot's sensors and topics into a rosbag file.
    only input is robot_id which is defined in the ROBOTS dict and rosbag_name which
    is the name of the rosbag file to save.
    For example, to start recording on amr_1 with rosbag name "test.bag",
    send a POST request to /amr_1/rosbag/start with body {"rosbag_name": "test.bag"}
    """
    try:
        robot = get_robot(robot_id)
        return robot.start_recording(rosbag_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{robot_id}/stop")
async def stop_recording(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    ):
    """
    Stop recording rosbag on the robot.
    This will stop recording the robot's sensors and topics into a rosbag file.
    only input is robot_id which is defined in the ROBOTS dict and rosbag_name which
    is the name of the rosbag file to save.
    For example, to stop recording on amr_1 with rosbag name "test.bag",
    send a POST request to /amr_1/rosbag/stop with body {"rosbag_name": "test.bag"}
    """
    try:
        robot = get_robot(robot_id)
        return robot.stop_recording()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{robot_id}/status")
async def recording_status(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    ):
    """
    Get the status of the recording on the robot.
    This will return the status of the recording on the robot.
    only input is robot_id which is defined in the ROBOTS dict.
    For example, to get the recording status on amr_1,
    send a POST request to /amr_1/rosbag/status
    """
    try:
        robot = get_robot(robot_id)
        return robot.recording_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.delete("/{robot_id}/{rosbag_name}")
async def delete_recording(
    # current_user=Depends(get_current_user),
    robot_id: Robots = Path(..., description="Unique ID of the robot"),
    rosbag_name: str = Path(..., description="Name of the rosbag to delete"),
    ):
    """
    Delete a rosbag file on the robot.
    This will delete a rosbag file on the robot.
    only input is robot_id which is defined in the ROBOTS dict and rosbag_name which
    is the name of the rosbag file to delete.
    For example, to delete a rosbag named "test.bag" on amr_1,
    send a DELETE request to /amr_1/rosbag/test.bag
    """
    try:
        robot = get_robot(robot_id)
        return robot.delete_recording(rosbag_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

