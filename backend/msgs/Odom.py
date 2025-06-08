from pydantic import BaseModel
from typing import Optional, Dict
from subscriber_available import SubscribableTopics 


class OdomMessageRequest(BaseModel):
    topic: SubscribableTopics
    data: Optional[str] = None
    type: Optional[str] = "nav_msgs/Odometry"
