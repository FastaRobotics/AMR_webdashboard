"""Parallel-polling check: does the backend survive the dashboard's own load?

The dashboard polls the fleet list and both robot statuses at the same time
(``useFleet.refresh`` → ``getRobotList`` + two ``getRobotConnectionStatus``
calls). Those are *authenticated* requests, and in the real backend
``get_current_user`` is a plain ``def`` dependency: FastAPI runs it in a worker
thread while every request shares one module-level sqlite cursor. Two parallel
requests then hit

    sqlite3.ProgrammingError: Recursive use of cursors not allowed

and the shared C object is corrupted badly enough that the process dies with an
access violation (Windows exit code ``-1073741819`` / ``0xC0000005``) — the
server simply disappears, usually a few seconds after the dashboard connects.

Usage:

    python tools/concurrency_check.py                       # this fake backend
    python tools/concurrency_check.py --base http://192.168.1.50:8000
    python tools/concurrency_check.py --path /sim/health     # unauthenticated path

Exit code 0 means every request was answered and the server stayed up.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request


DEFAULT_PATHS = (
    "/connection/robot_list",
    "/connection/amr_1/status",
    "/connection/go2_1/status",
)


def login(base: str, user: str, password: str) -> str:
    request = urllib.request.Request(
        f"{base}/user/login",
        data=json.dumps({"user_name": user, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())["access_token"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin123")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--requests", type=int, default=25, help="per thread")
    parser.add_argument(
        "--path",
        action="append",
        default=None,
        help="path to hit (repeatable); defaults to the dashboard's three",
    )
    parser.add_argument("--no-auth", action="store_true")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    paths = args.path or list(DEFAULT_PATHS)

    token = ""
    if not args.no_auth and not all(path.startswith("/sim") for path in paths):
        try:
            token = login(base, args.user, args.password)
        except Exception as error:
            print(f"login failed: {error}")
            return 2

    lock = threading.Lock()
    results: dict[object, int] = {}

    def note(value: object) -> None:
        with lock:
            results[value] = results.get(value, 0) + 1

    def worker() -> None:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        for index in range(args.requests):
            path = paths[index % len(paths)]
            request = urllib.request.Request(f"{base}{path}", headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    response.read()
                    note(response.status)
            except urllib.error.HTTPError as error:
                error.read()
                note(error.code)
            except Exception as error:
                note(type(error).__name__)

    print(
        f"hitting {paths} with {args.threads} threads x {args.requests} requests "
        f"({args.threads * args.requests} total)"
    )

    started = time.time()
    threads = [threading.Thread(target=worker) for _ in range(args.threads)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    elapsed = time.time() - started
    summary = dict(sorted(results.items(), key=lambda item: str(item[0])))
    print(f"finished in {elapsed:.1f}s: {summary}")

    # Ask the server whether it is still there.
    alive = False
    try:
        with urllib.request.urlopen(f"{base}/openapi.json", timeout=5) as response:
            alive = response.status == 200
    except Exception:
        alive = False

    refused = sum(
        count
        for key, count in results.items()
        if key in ("ConnectionRefusedError", "URLError", "RemoteDisconnected")
    )
    server_errors = sum(
        count for key, count in results.items() if isinstance(key, int) and key >= 500
    )

    problems = []
    if refused:
        problems.append(f"{refused} connections failed outright (the server died mid-run)")
    if server_errors:
        problems.append(f"{server_errors} responses were 5xx")
    if not alive:
        problems.append("the server is not answering afterwards")

    if problems:
        print("\nFAIL")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "  On the real backend this usually means the sqlite cursor in\n"
            "  routers/auth.py is shared across FastAPI's threadpool threads:\n"
            "  make get_current_user async and give each thread its own connection."
        )
        return 1

    print("\nPASS: every request was answered and the server is still up")
    return 0


if __name__ == "__main__":
    sys.exit(main())
