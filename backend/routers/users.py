from fastapi import APIRouter, Depends, HTTPException
from routers.auth import authenticate
import sqlite3
from pydantic import BaseModel

router = APIRouter(prefix="/user", tags=["users"])

conn = sqlite3.connect("database/users.db", check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    user_name TEXT UNIQUE,
    password TEXT
)
""")
conn.commit()

class LoginRequest(BaseModel):
    user_name: str
    password: str

class User(BaseModel):
    id: int
    first_name: str
    last_name: str
    email: str
    user_name: str
    password: str

# create user
@router.post("/create")
async def create_user(user: User):
    """
    Create a new user in the database.
    """
    cursor.execute("SELECT * FROM users WHERE user_name = ?", (user.user_name,))
    existing = cursor.fetchone()

    if existing:
        raise HTTPException(status_code=400, detail="User already exists")

    cursor.execute(
        "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)",
        (user.id, user.first_name, user.last_name, user.email, user.user_name, user.password)
    )

    conn.commit()

    return {"message": "user created", "username": user.user_name}


# get user
@router.get("/{user_id}")
async def get_user(user_id: int, current_user=Depends(authenticate)):
    """ 
    Get a user by ID. Requires authentication.
    """
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "message": "authenticated",
        "current_user": current_user["user_name"],
        "user": {
            "id": user[0],
            "first_name": user[1],
            "last_name": user[2],
            "email": user[3],
            "user_name": user[4]
        }
    }

# delete user
@router.delete("/delete/{user_id}")
async def delete_user(user_id: int, current_user=Depends(authenticate)):
    """ Delete a user by ID. Requires authentication. """
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()

    return {"message": f"user with id {user_id} deleted"}

