from pydantic import BaseModel

class ConnectRequest(BaseModel):
    ip: str
    port: int = 9090 