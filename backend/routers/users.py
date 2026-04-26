from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import sqlite3

from routers.auth import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/user", tags=["users"])

conn = sqlite3.connect("database/users.db", check_same_thread=False)
cursor = conn.cursor()

# ===== DB =====
cursor.execute("""
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    user_name TEXT UNIQUE,
    password TEXT
)
""")
conn.commit()

# ===== MODELS =====
class UserCreate(BaseModel):
    first_name: str
    last_name: str
    email: str
    user_name: str
    password: str

class LoginRequest(BaseModel):
    user_name: str
    password: str

# ===== CREATE USER =====
@router.post("/create")
async def create_user(user: UserCreate):
    cursor.execute("SELECT * FROM users WHERE user_name = ?", (user.user_name,))
    if cursor.fetchone():
        raise HTTPException(status_code=400, detail="User exists")

    hashed = hash_password(user.password)

    cursor.execute(
        "INSERT INTO users (first_name, last_name, email, user_name, password) VALUES (?, ?, ?, ?, ?)",
        (user.first_name, user.last_name, user.email, user.user_name, hashed)
    )
    conn.commit()

    return {"message": "user created"}

# ===== LOGIN =====
@router.post("/login")
async def login(data: LoginRequest):
    cursor.execute("SELECT * FROM users WHERE user_name = ?", (data.user_name,))
    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(data.password, user[5]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": user[4]})

    return {
        "access_token": token,
        "token_type": "bearer"
    }