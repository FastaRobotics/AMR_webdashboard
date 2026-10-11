from pydantic import BaseModel
from typing import Optional, Dict 


class SaveMapMessageRequest(BaseModel):
    service_name: str
    service_type: str 
    request: Dict[str, str]