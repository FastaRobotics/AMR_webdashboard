from fastapi import FastAPI, HTTPException
from roslibpy import Ros

from ros_bridge.publisher import RosPublisher
from ros_bridge.subscriber import RosSubscriber
from ros_bridge.service_client import RosServiceClient
from ros_bridge.publisher_available import TOPIC_MESSAGE_TYPES
from ros_bridge.subscriber_available import SUBSCRIBABLE_TOPIC_MESSAGE_TYPES 
from ros_bridge.service_client_available import SERVICE_MESSAGE_TYPES

from msgs.String import StringMessageRequest 
from msgs.Twist import TwistMessageRequest
from msgs.Pose import PoseMessageRequest
from msgs.Odom import OdomMessageRequest 
from msgs.Transformation import TfMessageRequest
from msgs.GoalPose import GoalPoseMessageRequest

from srv.SaveMap import SaveMapMessageRequest
from srv.Trigger import TriggerMessageRequest 

from connection.ConnectRequest import ConnectRequest


ros: Ros = None

publishers = {}
subscribers = {}
services = {}

app = FastAPI()

# Connect to robot
@app.post("/connect")
async def connect(req: ConnectRequest):
    global ros
    ip = req.ip 
    port = req.port

    if ros and ros.is_connected:
        return {"message": f"Already connected to ROS at {ros.host}:{ros.port}"}

    try:
        ros = Ros(host=ip, port=port)
        ros.run()

        if not ros.is_connected:
            raise HTTPException(status_code=500, detail="Failed to connect to ROS.")

        return {"message": f"Connected to ROS at {req.ip}:{req.port}"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/disconnect")
async def disconnect():
    global ros
    if ros and ros.is_connected:
        ros.terminate()
        ros = None
        return {"status": "disconnected"}
    else:
        raise HTTPException(status_code=400, detail="Not connected to any ROS master.")


# Publishers API 
@app.post("/publish/string")
async def publish_string(req: StringMessageRequest):
    topic = req.topic
    msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "std_msgs/String")

    if topic not in publishers:
        publishers[topic] = RosPublisher(ros=ros, topic_name=topic, message_type=msg_type)

    try:
        publishers[topic].publish_once({"data": req.data})
        publishers[topic].close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "published", 
            "topic": topic, 
            "type": msg_type, 
            "data": req.data}


@app.post("/publish/twist")
async def publish_twist(req: TwistMessageRequest):
    topic = req.topic
    msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "geometry_msgs/Twist")

    if topic not in publishers:
        publishers[topic] = RosPublisher(ros=ros, topic_name=topic, message_type=msg_type)

    twist_msg = {
        "linear": req.linear,
        "angular": req.angular
    }

    try:
        publishers[topic].publish_once(twist_msg)
        publishers[topic].close()

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "published", 
            "topic": topic,
            "type": msg_type, 
            "message": twist_msg}

@app.post("/publish/pose")
async def publish_pose(req: PoseMessageRequest):
    topic = req.topic
    msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "geometry_msgs/Pose")

    if topic not in publishers:
        publishers[topic] = RosPublisher(ros=ros, topic_name=topic, message_type=msg_type)

    pose_msg = {
        "position": req.position,
        "orientation": req.orientation
    }

    try:
        publishers[topic].publish_once(pose_msg)
        publishers[topic].close()

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "published",
        "topic": topic,
        "type": msg_type,
        "message": pose_msg
    }

@app.post("/publish/goal_pose")
async def publish_goal_pose(req: GoalPoseMessageRequest):
    topic = req.topic
    msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "geometry_msgs/PoseStamped")

    if topic not in publishers:
        publishers[topic] = RosPublisher(
            ros=ros, topic_name=topic, message_type=msg_type)

    pose_msg = {
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

    try:
        publishers[topic].publish_once(pose_msg)
        publishers[topic].close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "published",
        "topic": topic,
        "type": msg_type,
        "message": pose_msg
    }


# Subscribers API 
@app.post("/subscribe/odom")
async def get_odom(req: OdomMessageRequest):
    topic = req.topic
    msg_type = req.type or SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic, "nav_msgs/Odometry")

    if topic not in subscribers:
        subscriber = RosSubscriber(ros=ros, topic_name=topic, message_type=msg_type)
        subscriber.subscribe()
        subscribers[topic] = subscriber

    try:
        odom_msg = subscribers[topic].get_last_message()
        # subscribers[topic].unsubscribe()

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "subscribed",
        "topic": topic,
        "type": msg_type,
        "message": odom_msg
    }

@app.post("/subscribe/tf")
async def get_tf(req: TfMessageRequest):
    topic = req.topic
    msg_type = req.type or SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic, "tf2_msgs/TFMessage")

    if topic not in subscribers:
        subscriber = RosSubscriber(ros=ros, topic_name=topic, message_type=msg_type)
        subscriber.subscribe()
        subscribers[topic] = subscriber

    try:
        odom_msg = subscribers[topic].get_last_message()
        # subscribers[topic].unsubscribe()

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "subscribed",
        "topic": topic,
        "type": msg_type,
        "message": odom_msg
    }

# Mapping
@app.post("/start/mapping")
async def start_mapping(req: TriggerMessageRequest):
    service_name = req.service_name or "/start_mapping"
    service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "std_srv/srv/Trigger")
    request = req.request 

    try:
        if service_type not in services:
            service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
            response = service.call(request)

    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))
    
    return {
        "status": "service called", 
        "service_name": service_name, 
        "service_type": service_type, 
        "message": response
    }

@app.post("/stop/mapping")
async def stop_mapping(req: SaveMapMessageRequest):
    service_name = req.service_name or "/stop_mapping_and_save_map"
    service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "go2_msgs/srv/SaveMap")
    request = req.request 

    try:
        if service_type not in services:
            service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
            response = service.call(request)

    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))
    
    return {
        "status": "service called", 
        "service_name": service_name, 
        "service_type": service_type, 
        "message": response
    }

# exploring service (for auto mapping)
@app.post("/start/exploring")
async def start_exploring(req: TriggerMessageRequest):
    service_name = req.service_name or "/start_exploring"
    service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "std_srv/srv/Trigger")
    request = req.request 

    try:
        if service_type not in services:
            service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
            response = service.call(request)

    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))
    
    return {
        "status": "service called", 
        "service_name": service_name, 
        "service_type": service_type, 
        "message": response
    }

@app.post("/stop/exploring")
async def stop_mapping(req: SaveMapMessageRequest):
    service_name = req.service_name or "/stop_exploring"
    service_type = req.service_type or SERVICE_MESSAGE_TYPES.get(service_name, "go2_msgs/srv/SaveMap")
    request = req.request 

    try:
        if service_type not in services:
            service = RosServiceClient(ros=ros, service_name=service_name, service_type=service_type)
            response = service.call(request)

    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))
    
    return {
        "status": "service called", 
        "service_name": service_name, 
        "service_type": service_type, 
        "message": response
    }
 
