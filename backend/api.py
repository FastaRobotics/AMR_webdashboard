from fastapi import FastAPI, HTTPException

from ros_bridge.publisher import RosPublisher
from ros_bridge.subscriber import RosSubscriber
from ros_bridge.publisher_available import TOPIC_MESSAGE_TYPES
from ros_bridge.subscriber_available import SUBSCRIBABLE_TOPIC_MESSAGE_TYPES 

from msgs.String import StringMessageRequest 
from msgs.Twist import TwistMessageRequest
from msgs.Pose import PoseMessageRequest
from msgs.Odom import OdomMessageRequest 
from msgs.Transformation import TfMessageRequest

from roslibpy import Ros
from ros_process_manager import RosProcessManager

# Create ONE shared connection instance
ros = Ros(host='192.168.0.224', port=9090)
ros.run()
ros_processor = RosProcessManager()

if not ros.is_connected:
    raise Exception("[ROS Bridge] Failed to connect to ROS bridge")

print("[ROS Bridge] Connected to ROS at ws://192.168.0.224:9090")

publishers = {}
subscribers = {}
app = FastAPI()

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

# Mapping and navigation
@app.post("/start/mapping")
def start_mapping():
    ros_processor.start_mapping()
    return {"status": "mapping started"}

@app.post("/stop/mapping")
def stop_mapping():
    ros_processor.stop_mapping()
    return {"status": "mapping stopped"}

@app.post("/start/navigation")
def start_navigation():
    ros_processor.start_navigation()
    return {"status": "navigation started"}

@app.post("/stop/navigation")
def stop_navigation():
    ros_processor.stop_navigation()
    return {"status": "navigation stopped"}

@app.get("/status")
def get_status():
    return ros_processor.status()
