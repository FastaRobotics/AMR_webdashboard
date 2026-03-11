from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
import secrets

class User(BaseModel):
    first_name: str
    last_name: str
    email: str
    user_name: str
    password: str
    id: int

router = APIRouter(prefix="/user", tags=["users"])

security = HTTPBasic()
users_db = {}


def authenticate(credentials: HTTPBasicCredentials = Depends(security)):
    username = credentials.username
    password = credentials.password

    if username not in users_db:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Basic"},
        )

    stored_user = users_db[username]

    correct_password = secrets.compare_digest(password, stored_user["password"])

    if not correct_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Wrong password",
            headers={"WWW-Authenticate": "Basic"},
        )

    return stored_user


@router.post("/create")
async def create_user(user: User):
    if user.user_name in users_db:
        raise HTTPException(status_code=400, detail="User already exists")

    users_db[user.user_name] = user.dict()

    return {"message": "user created", "username": user.user_name}


@router.get("/{user_id}")
async def get_user(user_id: int, current_user=Depends(authenticate)):
    return {
        "message": "authenticated",
        "current_user": current_user["user_name"],
        "requested_user_id": user_id
    }
    
@router.delete("/delete/{user_id}")
async def delete_user(user_id: int, current_user=Depends(authenticate)):
    for username, user in users_db.items():
        if user["id"] == user_id:
            del users_db[username]
            return {"message": f"User with id {user_id} deleted"}
    
    raise HTTPException(status_code=404, detail="User not found")