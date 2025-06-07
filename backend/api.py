from fastapi import FastAPI, HTTPException
from publisher import RosPublisher
from publisher_available import TOPIC_MESSAGE_TYPES
from msgs.String import StringMessageRequest 
from msgs.Twist import TwistMessageRequest
from msgs.Pose import PoseMessageRequest


publishers = {}
app = FastAPI()

@app.post("/publish/string")
async def publish_string(req: StringMessageRequest):
    topic = req.topic
    msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "std_msgs/String")

    if topic not in publishers:
        publishers[topic] = RosPublisher(topic_name=topic, message_type=msg_type)

    try:
        publishers[topic].publish_once({"data": req.data})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "published", "topic": topic, "type": msg_type, "data": req.data}


@app.post("/publish/twist")
async def publish_twist(req: TwistMessageRequest):
    topic = req.topic
    msg_type = req.type or TOPIC_MESSAGE_TYPES.get(topic, "geometry_msgs/Twist")

    if topic not in publishers:
        publishers[topic] = RosPublisher(topic_name=topic, message_type=msg_type)

    twist_msg = {
        "linear": req.linear,
        "angular": req.angular
    }

    try:
        publishers[topic].publish_once(twist_msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "published", "topic": topic, "type": msg_type, "message": twist_msg}

@app.post("/publish/pose")
async def publish_pose(req):
    pass
