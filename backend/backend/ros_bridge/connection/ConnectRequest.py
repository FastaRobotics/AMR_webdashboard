from pydantic import BaseModel
from roslibpy import Ros
from enum import Enum 

class RequestType(str, Enum):
    CONNECT = "connect"
    DISCONNECT = "disconnect"

class ConnectRequest(BaseModel):
    ip: str = "localhost"
    port: int = 9090 
