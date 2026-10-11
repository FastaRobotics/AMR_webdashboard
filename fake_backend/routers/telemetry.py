"""Read-only telemetry API — the topics the streaming sockets cannot carry.

The real backend subscribes to ``battery_state``, ``imu``, ``point_cloud`` and
the compressed images server-side (see ``ros_bridge/AMR/subscriber_available.py``)
but exposes **no** HTTP or WebSocket route for them: the five streaming sockets
only serve ``map``/``odom``/``tf``/``diagnostics``/``path``. The dashboard's
status bar therefore has no way to show a real battery level.

This router closes that gap without changing any path the dashboard already
uses:

    GET /telemetry/{robot_id}/{topic}

It answers with the same ROS message the robot publishes on that topic (the
exact dict ``sim_roslibpy`` would hand a ``roslibpy`` subscriber), wrapped in a
small envelope carrying the robot id and a generation timestamp. Any topic in
``simulation.state.ALL_TOPICS`` is accepted, so ``imu``, ``battery_state``,
``point_cloud``, ``image_compressed``, ``depth_image_compressed`` and the wheel
encoders are all readable.

``GET /telemetry/{robot_id}`` without a topic returns every on-demand topic at
once, which is what a dashboard poll wants: one request per refresh instead of
one per topic.

Nothing here exists in the real backend, so nothing that mirrors it changes.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException

from routers.auth import get_current_user
from routers.connection import ROBOTS
from simulation.engine import get_engine
from simulation.state import ON_DEMAND_TOPICS, STREAM_TOPICS

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

#: every topic the simulation can produce a message for.
KNOWN_TOPICS: tuple[str, ...] = tuple(
    sorted(set(STREAM_TOPICS) | set(ON_DEMAND_TOPICS))
)


def _state(robot_id: str):
    if robot_id not in ROBOTS:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    return get_engine().state_for(robot_id)


def _envelope(robot_id: str, topic: str, message) -> dict:
    robot = ROBOTS.get(robot_id)
    return {
        "robot_id": robot_id,
        "topic": topic,
        "generated_at": time.time(),
        "connected": bool(robot and robot.is_connected()),
        "message": message,
    }


@router.get("/{robot_id}")
async def robot_telemetry(
    robot_id: str,
    current_user=Depends(get_current_user),
):
    """Every on-demand topic for one robot in a single response.

    A topic the robot does not publish is reported as ``null`` rather than
    removed, so the caller can tell "not published" from "not requested".
    """

    state = _state(robot_id)
    messages = {topic: state.snapshot(topic) for topic in ON_DEMAND_TOPICS}
    robot = ROBOTS.get(robot_id)

    return {
        "robot_id": robot_id,
        "generated_at": time.time(),
        "connected": bool(robot and robot.is_connected()),
        "status": robot.status.value if robot else "offline",
        "topics": messages,
    }


@router.get("/{robot_id}/{topic}")
async def robot_telemetry_topic(
    robot_id: str,
    topic: str,
    current_user=Depends(get_current_user),
):
    """One topic. Streaming topics are latched messages, so they work too."""

    state = _state(robot_id)
    if topic not in KNOWN_TOPICS and topic not in state.published:
        raise HTTPException(
            status_code=404,
            detail=(
                f"unknown topic '{topic}' on robot '{robot_id}'; "
                f"known topics: {', '.join(KNOWN_TOPICS)}"
            ),
        )
    return _envelope(robot_id, topic, state.snapshot(topic))
