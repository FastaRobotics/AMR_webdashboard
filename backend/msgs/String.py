from pydantic import BaseModel
from publisher_available import AvailableTopics
from typing import Optional, Dict


class StringMessageRequest(BaseModel):
    topic: AvailableTopics
    data: str
    type: Optional[str] = "std_msgs/String"  # Optional override
