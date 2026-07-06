from pydantic import BaseModel
from typing import Optional
from ros_bridge.subscriber_available import SubscribableTopics 


class TfMessageRequest(BaseModel):
    topic: SubscribableTopics = SubscribableTopics.tf
    data: Optional[str] = None
    type: Optional[str] = "tf2_msgs/TFMessage"
