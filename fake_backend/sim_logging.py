"""Print helper for the mirrored modules.

``backend/robot.py`` and ``backend/ros_bridge/*.py`` print on every publish,
subscribe and service call. That is fine at robot rates but drowns the console
when the dashboard holds a joystick at 20 Hz, so the fake backend routes those
messages here: they appear when ``FAKE_VERBOSE=1`` and stay quiet otherwise.

Errors are still printed directly — they should always be visible.
"""

from __future__ import annotations

from config import settings


def log(message: str) -> None:
    if settings.verbose:
        print(message, flush=True)
