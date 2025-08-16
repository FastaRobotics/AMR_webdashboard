from fastapi import FastAPI, HTTPException, Path
from roslibpy import Ros
from typing import Dict, Optional


# from msgs.String import StringMessageRequest 
from msgs.Twist import TwistMessageRequest
# from msgs.Pose import PoseMessageRequest
# from msgs.Odom import OdomMessageRequest 
# from msgs.Transformation import TfMessageRequest
# from msgs.GoalPose import GoalPoseMessageRequest

from srv.SaveMap import SaveMapMessageRequest
from srv.Trigger import TriggerMessageRequest 

from connection.ConnectRequest import ConnectRequest

from robot import Robot  
from amr_robot import AMR
from go2_robot import Go2 

app = FastAPI()

# Keep a registry of multiple robots by id
ROBOTS: Dict[str, Robot] = {}

ROBOTS['amr_1'] = AMR(robot_id="amr_1", port=9090)

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
        robot.publish_twist("",req.linear,req.angular)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# @app.post("/publish/pose")
# async def publish_pose(req: PoseMessageRequest):
#     topic = req.topic
#     msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "geometry_msgs/msg/Pose")

#     if topic not in publishers:
#         publishers[topic] = RosPublisher(ros=ros, topic_name=topic, message_type=msg_type)

#     pose_msg = {
#         "position": req.position,
#         "orientation": req.orientation
#     }

#     try:
#         publishers[topic].publish_once(pose_msg)
#         publishers[topic].close()

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

#     return {
#         "status": "published",
#         "topic": topic,
#         "type": msg_type,
#         "message": pose_msg
#     }

# @app.post("/publish/goal_pose")
# async def publish_goal_pose(req: GoalPoseMessageRequest):
#     topic = req.topic
#     msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "geometry_msgs/msg/PoseStamped")

#     if topic not in publishers:
#         publishers[topic] = RosPublisher(
#             ros=ros, topic_name=topic, message_type=msg_type)

#     pose_msg = {
#         "header": {
#             "frame_id": req.header.frame_id,
#             "stamp": req.header.stamp
#         },
#         "pose": {
#             "position": {
#                 "x": req.pose.position.x,
#                 "y": req.pose.position.y,
#                 "z": req.pose.position.z
#             },
#             "orientation": {
#                 "x": req.pose.orientation.x,
#                 "y": req.pose.orientation.y,
#                 "z": req.pose.orientation.z,
#                 "w": req.pose.orientation.w
#             }
#         }
#     }

#     try:
#         publishers[topic].publish_once(pose_msg)
#         publishers[topic].close()
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

#     return {
#         "status": "published",
#         "topic": topic,
#         "type": msg_type,
#         "message": pose_msg
#     }


# # Subscribers API 
# @app.post("/subscribe/odom")
# async def get_odom(req: OdomMessageRequest):
#     topic = req.topic
#     msg_type = req.type or SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic, "nav_msgs/msg/Odometry")

#     if topic not in subscribers:
#         subscriber = RosSubscriber(ros=ros, topic_name=topic, message_type=msg_type)
#         subscriber.subscribe()
#         subscribers[topic] = subscriber

#     try:
#         odom_msg = subscribers[topic].get_last_message()
#         # subscribers[topic].unsubscribe()

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

#     return {
#         "status": "subscribed",
#         "topic": topic,
#         "type": msg_type,
#         "message": odom_msg
#     }

# @app.post("/subscribe/tf")
# async def get_tf(req: TfMessageRequest):
#     topic = req.topic
#     msg_type = req.type or SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic, "tf2_msgs/msg/TFMessage")

#     if topic not in subscribers:
#         subscriber = RosSubscriber(ros=ros, topic_name=topic, message_type=msg_type)
#         subscriber.subscribe()
#         subscribers[topic] = subscriber

#     try:
#         odom_msg = subscribers[topic].get_last_message()
#         # subscribers[topic].unsubscribe()

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

#     return {
#         "status": "subscribed",
#         "topic": topic,
#         "type": msg_type,
#         "message": odom_msg
#     }

# # Mapping
# @app.post("/start/mapping")
# async def start_mapping(req: TriggerMessageRequest):
#     service_name = req.service_name or "/start_mapping"
#     service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "std_srv/srv/Trigger")
#     request = req.request 

#     try:
#         if service_type not in services:
#             service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
#             response = service.call(request)

#     except Exception as e: 
#         raise HTTPException(status_code=500, detail=str(e))
    
#     return {
#         "status": "service called", 
#         "service_name": service_name, 
#         "service_type": service_type, 
#         "message": response
#     }

# @app.post("/stop/mapping")
# async def stop_mapping(req: SaveMapMessageRequest):
#     service_name = req.service_name or "/stop_mapping_and_save_map"
#     service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "go2_msgs/srv/SaveMap")
#     request = req.request 

#     try:
#         if service_type not in services:
#             service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
#             response = service.call(request)

#     except Exception as e: 
#         raise HTTPException(status_code=500, detail=str(e))
    
#     return {
#         "status": "service called", 
#         "service_name": service_name, 
#         "service_type": service_type, 
#         "message": response
#     }

# # exploring service (for auto mapping)
# @app.post("/start/exploring")
# async def start_exploring(req: TriggerMessageRequest):
#     service_name = req.service_name or "/start_exploring"
#     service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "std_srv/srv/Trigger")
#     request = req.request 

#     try:
#         if service_type not in services:
#             service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
#             response = service.call(request)

#     except Exception as e: 
#         raise HTTPException(status_code=500, detail=str(e))
    
#     return {
#         "status": "service called", 
#         "service_name": service_name, 
#         "service_type": service_type, 
#         "message": response
#     }

# @app.post("/stop/exploring")
# async def stop_mapping(req: SaveMapMessageRequest):
#     service_name = req.service_name or "/stop_exploring"
#     service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "go2_msgs/srv/SaveMap")
#     request = req.request 

#     try:
#         if service_type not in services:
#             service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
#             response = service.call(request)

#     except Exception as e: 
#         raise HTTPException(status_code=500, detail=str(e))
    
#     return {
#         "status": "service called", 
#         "service_name": service_name, 
#         "service_type": service_type, 
#         "message": response
#     }
 
