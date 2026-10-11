from pydantic import BaseModel, Field
from typing import Optional, Dict


class TwistMessageRequest(BaseModel):
    linear: Dict[str, float]  = {"x": 0.0, "y": 0.0, "z": 0.0}
    angular: Dict[str, float]  = {"x": 0.0, "y": 0.0, "z": 0.0}
    type: Optional[str] = "geometry_msgs/Twist"  # Optional override