from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import sqlite3
import secrets

security = HTTPBasic()

conn = sqlite3.connect("database/users.db", check_same_thread=False)
cursor = conn.cursor()


def authenticate(credentials: HTTPBasicCredentials = Depends(security)):
    username = credentials.username
    password = credentials.password

    cursor.execute("SELECT * FROM users WHERE user_name = ?", (username,))
    user = cursor.fetchone()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Basic"},
        )

    stored_password = user[5]

    if not secrets.compare_digest(password, stored_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Wrong password",
            headers={"WWW-Authenticate": "Basic"},
        )

    return {
        "id": user[0],
        "user_name": user[4]
    }