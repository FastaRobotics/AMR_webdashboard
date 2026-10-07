"""Mirror of backend/ros_bridge/connection/ConnectRequest.py (import adjusted)."""

from pydantic import BaseModel
from sim_roslibpy import Ros
from enum import Enum


class RequestType(str, Enum):
    CONNECT = "connect"
    DISCONNECT = "disconnect"


class ConnectRequest(BaseModel):
    ip: str = "localhost"
    port: int = 9090
