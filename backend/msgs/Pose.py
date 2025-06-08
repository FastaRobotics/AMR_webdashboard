from pydantic import BaseModel
from typing import Optional, Dict
from ros_bridge.publisher_available import AvailableTopics 


class PoseMessageRequest(BaseModel):
    topic: AvailableTopics = AvailableTopics.point
    position: Dict[str, float] = {"x": 0.0, "y": 0.0, "z": 0.0}
    orientation: Dict[str, float] = {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
    type: Optional[str] = "geometry_msgs/Pose"
