from pydantic import BaseModel
from typing import Optional, Dict
from ros_bridge.subscriber_available import SubscribableTopics 


class OdomMessageRequest(BaseModel):
    topic: SubscribableTopics = SubscribableTopics.odom
    data: Optional[str] = None
    type: Optional[str] = "nav_msgs/msgs/Odometry"
