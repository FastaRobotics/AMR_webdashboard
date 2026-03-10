from fastapi import APIRouter 
from pydantic import BaseModel


class User(BaseModel):
    first_name: str 
    last_name: str 
    email: str 
    user_name: str
    password: str
    id: int 


router = APIRouter(prefix="/user", tags=["users"])

@router.get("/{user_id}")
async def get_user(user_id: int):
    user = "salam"
    return user

@router.post("/")
async def create_user(user: User):
    return {"message": "user created"}

