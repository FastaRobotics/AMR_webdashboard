from pydantic import BaseModel
from typing import Optional, Dict

class PoseMessageRequest(BaseModel):
    position: Dict[str, float] = {"x": 0.0, "y": 0.0, "z": 0.0}
    orientation: Dict[str, float] = {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}