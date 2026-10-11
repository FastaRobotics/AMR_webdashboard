"""Mirror of backend/routers/users.py.

Same routes, same status codes, same response bodies:

* ``POST /user/create`` -> ``{"message": "user created"}``, or 400 "User exists"
* ``POST /user/login``  -> ``{"access_token": ..., "token_type": "bearer"}``,
  or 401 "Invalid credentials"

Two changes, both additive:

* hashing/token creation come from our standard-library implementation in
  ``routers/auth.py`` (same module path as the real backend);
* ``POST /user/login`` also accepts the ``application/x-www-form-urlencoded``
  body that Swagger UI's *Authorize* dialog posts (OAuth2 password flow:
  ``username`` / ``password``), because ``routers/auth.py`` declares
  ``OAuth2PasswordBearer(tokenUrl="/user/login")``. The real backend only
  accepts JSON there, so its Swagger "Authorize" button cannot work — this one
  can, while the dashboard's JSON request behaves exactly as before.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from urllib.parse import parse_qs

from database import db, init_db
from routers.auth import hash_password, verify_password, issue_token

router = APIRouter(prefix="/user", tags=["users"])

init_db()


def _first(values: list[str] | None) -> str | None:
    return values[0] if values else None


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
    if db.fetchone("SELECT id FROM users WHERE user_name = ?", (user.user_name,)):
        raise HTTPException(status_code=400, detail="User exists")

    hashed = hash_password(user.password)

    db.execute(
        "INSERT INTO users (first_name, last_name, email, user_name, password) VALUES (?, ?, ?, ?, ?)",
        (user.first_name, user.last_name, user.email, user.user_name, hashed)
    )
    db.commit()

    return {"message": "user created"}

# ===== LOGIN =====
#: The real backend declares a JSON body here. Documenting both media types lets
#: Swagger UI show a body editor *and* drive its OAuth2 password-flow
#: "Authorize" dialog, which posts form data to this URL.
LOGIN_OPENAPI = {
    "requestBody": {
        "required": False,
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "required": ["user_name", "password"],
                    "properties": {
                        "user_name": {"type": "string", "title": "User Name"},
                        "password": {"type": "string", "title": "Password"},
                    },
                }
            },
            "application/x-www-form-urlencoded": {
                "schema": {
                    "type": "object",
                    "required": ["username", "password"],
                    "properties": {
                        "username": {"type": "string", "title": "Username"},
                        "password": {"type": "string", "title": "Password"},
                    },
                }
            },
        },
    }
}


@router.post("/login", openapi_extra=LOGIN_OPENAPI)
async def login(request: Request):
    """JSON (what the dashboard sends) or OAuth2 password form (Swagger's
    *Authorize* dialog, which posts ``username``/``password`` as form data).

    The urlencoded body is parsed with the standard library rather than
    ``request.form()``, which would pull in ``python-multipart`` just to read two
    fields.
    """

    content_type = (request.headers.get("content-type") or "").lower()

    if "form-urlencoded" in content_type:
        fields = parse_qs(
            (await request.body()).decode("utf-8", "replace"), keep_blank_values=True
        )
        user_name = _first(fields.get("user_name")) or _first(fields.get("username"))
        password = _first(fields.get("password"))
    elif "multipart/form-data" in content_type:
        try:
            form = await request.form()
        except AssertionError:
            raise HTTPException(
                status_code=415,
                detail=(
                    "multipart form parsing is unavailable (python-multipart is not "
                    "installed); send JSON or application/x-www-form-urlencoded"
                ),
            )
        user_name = form.get("user_name") or form.get("username")
        password = form.get("password")
    else:
        try:
            payload = await request.json()
        except Exception:
            payload = None
        if isinstance(payload, dict):
            user_name = payload.get("user_name") or payload.get("username")
            password = payload.get("password")
        else:
            user_name = None
            password = None

    if not user_name or password is None:
        # Same shape as FastAPI's own validation error, which the dashboard's
        # apiErrorMessage() already knows how to render.
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "missing",
                    "loc": ["body", "user_name"],
                    "msg": "Field required",
                    "input": None,
                }
            ],
        )

    data = LoginRequest(user_name=str(user_name), password=str(password))

    user = db.fetchone("SELECT * FROM users WHERE user_name = ?", (data.user_name,))

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(data.password, user[5]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = issue_token(user[4])

    return {
        "access_token": token,
        "token_type": "bearer"
    }
