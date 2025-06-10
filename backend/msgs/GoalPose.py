from pydantic import BaseModel, Field
from typing import Dict, Optional
from ros_bridge.publisher_available import AvailableTopics


class Header(BaseModel):
    frame_id: str = "map"
    stamp: Optional[Dict[str, int]] = Field(
        default_factory=lambda: {"secs": 0, "nsecs": 0}
    ) 

class Position(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

class Orientation(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    w: float = 1.0

class Pose(BaseModel):
    position: Position = Field(default_factory=Position)
    orientation: Orientation = Field(default_factory=Orientation)

class GoalPoseMessageRequest(BaseModel):
    topic: AvailableTopics = AvailableTopics.goal_pose
    header: Header = Field(default_factory=Header)
    pose: Pose = Field(default_factory=Pose)
    type: Optional[str] = "geometry_msgs/PoseStamped"
