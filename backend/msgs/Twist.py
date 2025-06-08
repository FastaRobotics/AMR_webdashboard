from pydantic import BaseModel, Field
from ros_bridge.publisher_available import AvailableTopics
from typing import Optional, Dict


class TwistMessageRequest(BaseModel):
    topic: AvailableTopics = AvailableTopics.cmd_vel_out
    linear: Dict[str, float]  = {"x": 0.0, "y": 0.0, "z": 0.0}
    angular: Dict[str, float]  = {"x": 0.0, "y": 0.0, "z": 0.0}
    type: Optional[str] = "geometry_msgs/Twist"  # Optional override