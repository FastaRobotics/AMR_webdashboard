from fastapi import FastAPI, HTTPException, Path
from roslibpy import Ros
from typing import Dict, Optional
# from chatbot.assistant import FastaGPTAssistant
# from chatbot.AskRequest import AskRequest 

# from msgs.String import StringMessageRequest 
from msgs.Twist import TwistMessageRequest
from msgs.Pose import PoseMessageRequest
# from msgs.Odom import OdomMessageRequest 
# from msgs.Transformation import TfMessageRequest
from msgs.GoalPose import GoalPoseMessageRequest

from srv.SaveMap import SaveMapMessageRequest
from srv.Trigger import TriggerMessageRequest 

from connection.ConnectRequest import ConnectRequest

from robot import Robot  
from amr_robot import AMR
from go2_robot import Go2 


app = FastAPI()
# support = FastaGPTAssistant()

# Keep a registry of multiple robots by id
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
@app.post("/robots/{robot_id}/connection")
async def connection(
    robot_id: str = Path(..., description="Unique ID of the robot"),
    req: ConnectRequest = None,
):
    """
    Connect or disconnect an existing robot by id.
    Body fields: ip, port, request ∈ {'connect', 'disconnect'}
    """
    try: 
        if req is None or not req.request:
            raise HTTPException(status_code=400, detail="Missing 'request' in body.")

        request_type = req.request.lower()

        robot = get_robot(robot_id)

        if request_type == "connect":
            robot.connect()
            return {"message": f"Robot '{robot_id}' connected"}

        elif request_type == "disconnect":
            robot.disconnect()  
            return {"message": f"Robot '{robot_id}' disconnected"}
    except TimeoutError as e:
        # Provide a clear, actionable error to the client
        raise HTTPException(
            status_code=504,
            detail=f"Failed to connect to ROS bridge for robot '{robot_id}': {str(e)}. "
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# Publishers API 
# @app.post("/publish/string")
# async def publish_string(req: StringMessageRequest):
#     topic = req.topic
#     msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "std_msgs/msg/String")

#     if topic not in publishers:
#         publishers[topic] = RosPublisher(ros=ros, topic_name=topic, message_type=msg_type)

#     try:
#         publishers[topic].publish_once({"data": req.data})
#         publishers[topic].close()
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

#     return {"status": "published", 
#             "topic": topic, 
#             "type": msg_type, 
#             "data": req.data}


@app.post("/robots/{robot_id}/publish/twist")
async def publish_twist(robot_id: str = Path(..., description="Unique ID of the robot"),
                        req: TwistMessageRequest = None,):
    
    try: 
        robot = get_robot(robot_id)
        robot.publish_twist(req.linear,req.angular)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/robots/{robot_id}/publish/pose")
async def publish_pose(robot_id: str = Path(..., description="Unique ID of the robot"),
                       req: PoseMessageRequest=None):
    
    try: 
        robot = get_robot(robot_id)
        robot.publish_pose(req.position,req.orientation)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
 
@app.post("/robots/{robot_id}/publish/goal_pose")
async def publish_goal_pose(robot_id: str = Path(..., description="Unique ID of the robot"),
                            req: GoalPoseMessageRequest = None):
    try:
        pose_msg ={
            "header": {
                "frame_id": req.header.frame_id,
                "stamp": req.header.stamp
            },
            "pose": {
                "position": {
                    "x": req.pose.position.x,
                    "y": req.pose.position.y,
                    "z": req.pose.position.z
                },
                "orientation": {
                    "x": req.pose.orientation.x,
                    "y": req.pose.orientation.y,
                    "z": req.pose.orientation.z,
                    "w": req.pose.orientation.w
                }
            }
        }

        robot = get_robot(robot_id)
        robot.publish_goal_pose(pose_msg.header,pose_msg.pose)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Subscribers API 
@app.post("/robots/{robot_id}/subscribe/odom")
async def get_odom(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        message = robot.subscribe_odom()
        return {"status": "published", "robot_id": robot_id, "message": message}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/robots/{robot_id}/subscribe/tf")
async def get_tf(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        message = robot.subscribe_tf()
        return {"status": "published", "robot_id": robot_id, "message": message}

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

# # AI Support
# @app.post("/assistant/ask")
# async def ask(request: AskRequest):
#     try:
#         question = request.question
#         response = support.ask(question)
#         return {"response": response}

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

    
 
