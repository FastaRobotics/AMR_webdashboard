from pydantic import BaseModel
from roslibpy import Ros


class ConnectRequest(BaseModel):
    request: str = "connect"
    ip: str = "localhost"
    port: int = 9090 
