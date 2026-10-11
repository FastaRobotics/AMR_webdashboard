"""SQLite user store.

Mirrors the schema created by backend/routers/users.py:

    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        user_name TEXT UNIQUE,
        password TEXT
    )

Deliberate differences from the real backend:

* the file lives next to this module (``fake_backend/database/users.db``)
  instead of being resolved against the process working directory, so the app
  behaves the same no matter where uvicorn was started from;
* the store is seeded with known demo credentials (``FAKE_SEED_USERS``, default
  ``admin:admin123,operator:operator123,demo:demo123``) because the password
  hashes in the real ``backend/database/users.db`` cannot be recovered;
* **sqlite access is thread-safe** (see ``Sqlite`` below). This one is not
  cosmetic: the real backend shares a single module-level connection and cursor,
  and FastAPI runs plain ``def`` dependencies such as ``get_current_user`` in a
  worker thread, so two requests can use that cursor at the same time.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from config import settings


class Sqlite:
    """Thread-safe sqlite access with a per-thread connection.

    Why this exists: FastAPI executes *sync* dependencies with
    ``run_in_threadpool``, so ``get_current_user`` (a plain ``def``) runs on an
    anyio worker thread while async handlers run on the event loop. A single
    shared connection/cursor then gets used from two threads at once, which
    sqlite answers with ``sqlite3.ProgrammingError: Recursive use of cursors not
    allowed`` — and, because the C object is not re-entrant, it corrupts state
    badly enough to kill the process (0xC0000005 / access violation) under the
    dashboard's parallel fleet polling.

    Each thread therefore opens its own connection, which is also what keeps
    reads fast (no lock needed: sqlite serialises writers by itself, and
    ``busy_timeout`` covers the rare write).
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._local = threading.local()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # ── connection handling ─────────────────────────────────────────────────

    def connection(self) -> sqlite3.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = sqlite3.connect(str(self.path), check_same_thread=False)
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=5000")
            self._local.connection = connection
        return connection

    def cursor(self) -> sqlite3.Cursor:
        cursor = getattr(self._local, "cursor", None)
        if cursor is None:
            cursor = self.connection().cursor()
            self._local.cursor = cursor
        return cursor

    def close_thread_connection(self) -> None:
        connection = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None
            self._local.cursor = None

    # ── statement helpers ───────────────────────────────────────────────────

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        return self.cursor().execute(sql, params)

    def fetchone(self, sql: str, params: tuple = ()):
        cursor = self.execute(sql, params)
        return cursor.fetchone()

    def fetchall(self, sql: str, params: tuple = ()) -> list:
        cursor = self.execute(sql, params)
        return cursor.fetchall()

    def commit(self) -> None:
        self.connection().commit()


#: module-level singleton, used exactly like the real backend's ``cursor``/``conn``
db = Sqlite(settings.db_path)


def init_db() -> None:
    """Create the users table and seed any missing demo account."""

    # Imported here rather than at module level: routers/auth.py imports this
    # module, so a top-level import of it would be circular.
    from routers.auth import hash_password

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT,
            last_name TEXT,
            email TEXT,
            user_name TEXT UNIQUE,
            password TEXT
        )
        """
    )
    db.commit()

    for user_name, password in settings.seed_users:
        if db.fetchone("SELECT id FROM users WHERE user_name = ?", (user_name,)):
            continue
        db.execute(
            """
            INSERT INTO users (first_name, last_name, email, user_name, password)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user_name.capitalize(),
                "Fake",
                f"{user_name}@fake.local",
                user_name,
                hash_password(password),
            ),
        )
    db.commit()


def list_user_names() -> list[str]:
    return [row[0] for row in db.fetchall("SELECT user_name FROM users ORDER BY id")]
