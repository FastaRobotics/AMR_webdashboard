from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from pydantic import BaseModel


password_hash = PasswordHash.recommended()
DUMMY_HASH = password_hash.hash("dummypassword")

# print(DUMMY_HASH)
print(password_hash.verify("dummypassword", DUMMY_HASH))