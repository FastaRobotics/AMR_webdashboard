"""Authentication helpers — mirrors backend/routers/auth.py.

Same public surface as the real module (``hash_password``, ``verify_password``,
``create_access_token``, ``get_current_user``, ``oauth2_scheme``), so the rest of
the app is written exactly like the real one, but the crypto is implemented with
the standard library instead of ``passlib`` + ``python-jose``:

* passwords use PBKDF2-HMAC-SHA256, stored as
  ``pbkdf2_sha256$<iterations>$<salt_b64>$<digest_b64>``;
* tokens are HS256 JWTs built with ``hmac``/``hashlib``/``base64``.

Tokens stay wire-compatible with the real backend: same header, same ``sub`` and
``exp`` claims, same ``SECRET_KEY`` default ("CHANGE_ME"), so a token issued by
the real backend validates here (and vice versa) as long as the secret matches.

``verify_password`` still understands bcrypt hashes (``$2b$…``) if the ``bcrypt``
package happens to be installed, which makes it possible to point
``FAKE_DB_PATH`` at a copy of the real ``backend/database/users.db``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from database import db


SECRET_KEY = settings.secret_key
ALGORITHM = settings.algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes

PBKDF2_ITERATIONS = 180_000
PBKDF2_PREFIX = "pbkdf2_sha256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/user/login")


# ─── base64url helpers (JWT is base64url without padding) ─────────────────────


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


# ─── Password hashing ─────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "$".join(
        (
            PBKDF2_PREFIX,
            str(PBKDF2_ITERATIONS),
            _b64url_encode(salt),
            _b64url_encode(digest),
        )
    )


def _verify_pbkdf2(password: str, hashed: str) -> bool:
    try:
        prefix, iterations, salt_b64, digest_b64 = hashed.split("$")
        if prefix != PBKDF2_PREFIX:
            return False
        expected = _b64url_decode(digest_b64)
        candidate = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            _b64url_decode(salt_b64),
            int(iterations),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, expected)


def _verify_bcrypt(password: str, hashed: str) -> bool:
    """Best-effort verification of hashes written by the real backend."""

    try:
        import bcrypt  # type: ignore
    except ImportError:
        return False

    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    if hashed.startswith(PBKDF2_PREFIX + "$"):
        return _verify_pbkdf2(plain, hashed)
    if hashed.startswith(("$2a$", "$2b$", "$2y$")):
        return _verify_bcrypt(plain, hashed)
    return False


# ─── JWT (HS256) ──────────────────────────────────────────────────────────────


def _sign(signing_input: bytes) -> bytes:
    return hmac.new(SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256).digest()


def create_access_token(data: dict) -> str:
    to_encode = dict(data)
    expire = int(time.time()) + ACCESS_TOKEN_EXPIRE_MINUTES * 60
    to_encode.update({"exp": expire})

    header = {"alg": ALGORITHM, "typ": "JWT"}
    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url_encode(json.dumps(to_encode, separators=(",", ":")).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    segments.append(_b64url_encode(_sign(signing_input)))
    return ".".join(segments)


def decode_access_token(token: str) -> dict:
    """Return the claims, or raise ``ValueError`` when the token is unusable."""

    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:  # not three segments
        raise ValueError("malformed token") from exc

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    if not hmac.compare_digest(_b64url_decode(signature_b64), _sign(signing_input)):
        raise ValueError("bad signature")

    try:
        claims = json.loads(_b64url_decode(payload_b64))
    except (ValueError, TypeError) as exc:
        raise ValueError("malformed payload") from exc

    if not isinstance(claims, dict):
        raise ValueError("malformed payload")

    expire = claims.get("exp")
    if expire is not None and float(expire) < time.time():
        raise ValueError("token expired")

    return claims


# ─── Auth dependency ──────────────────────────────────────────────────────────


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """Identical status codes/messages to the real backend: 401 for a bad or
    expired token, 401 for a token whose user no longer exists.

    Declared ``async`` on purpose. The real backend declares it ``def``, which
    makes FastAPI run it in a worker thread: combined with a module-level sqlite
    cursor that every request shares, two parallel requests (the dashboard polls
    the fleet and both robot statuses at once) hit
    ``sqlite3.ProgrammingError: Recursive use of cursors not allowed`` and can
    take the whole process down with an access violation. Running it on the event
    loop, together with the thread-safe store in ``database.py``, removes that
    class of failure entirely.
    """

    try:
        claims = decode_access_token(token)
        username = claims.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.fetchone("SELECT * FROM users WHERE user_name = ?", (username,))

    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return {"id": user[0], "user_name": user[4]}


def issue_token(user_name: str) -> str:
    """Same claim layout as the real backend: ``{"sub": user_name}``."""

    return create_access_token({"sub": user_name})


def gen_secret_if_default() -> None:
    """Warn (once) when running with the real backend's placeholder secret."""

    if SECRET_KEY == "CHANGE_ME":
        print(
            "[auth] SECRET_KEY is the placeholder 'CHANGE_ME'. "
            "That matches the real deployment default; set SECRET_KEY to change it.",
            flush=True,
        )


__all__ = [
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "create_access_token",
    "db",
    "decode_access_token",
    "get_current_user",
    "hash_password",
    "issue_token",
    "oauth2_scheme",
    "verify_password",
]
