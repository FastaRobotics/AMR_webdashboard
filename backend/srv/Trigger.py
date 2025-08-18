from pydantic import BaseModel
from typing import Optional, Dict 


class TriggerMessageRequest(BaseModel):
    service_name: str 
    service_type: str 
    request: None