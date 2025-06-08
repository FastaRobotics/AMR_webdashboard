from pydantic import BaseModel
from typing import Optional
from subscriber_available import SubscribableTopics 


class TfMessageRequest(BaseModel):
    topic: SubscribableTopics
    data: Optional[str] = None
    type: Optional[str] = "tf2_msgs/TFMessage"
