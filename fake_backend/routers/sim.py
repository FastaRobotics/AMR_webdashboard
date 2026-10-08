"""Simulation helper API (``/sim``).

These endpoints do **not** exist in the real backend — nothing under the paths
the frontend uses is changed by them. They are here so a tester can drive the
simulation directly: teleport a robot, force a goal, drain the battery, kill a
connection to exercise the UI's error paths, or read any sensor topic that has
no WebSocket endpoint (imu, battery_state, point_cloud, compressed images).

They are unauthenticated on purpose (local test tooling) and can be switched off
with ``FAKE_ENABLE_SIM_API=0``.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from config import settings
from robot import RobotStatus
from routers.connection import ROBOTS, get_robot
from simulation.engine import get_engine
from simulation.imaging import png_encode
from simulation.state import ON_DEMAND_TOPICS, STREAM_TOPICS

router = APIRouter(prefix="/sim", tags=["simulation"])

ALL_TOPICS = sorted(set(STREAM_TOPICS) | set(ON_DEMAND_TOPICS))

#: (robot_id, source, downsample, map_revision) -> encoded PNG bytes.
_MAP_PNG_CACHE: dict[tuple[str, str, int, int], bytes] = {}

#: Named waypoints, inserted at import time from the world layout and then
#: editable, so the dashboard's waypoint list survives a page reload.
_WAYPOINTS: dict[str, dict] = {}


class WaypointRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    x: float
    y: float
    yaw: float = 0.0


class GoalRequest(BaseModel):
    x: float
    y: float
    yaw: float = 0.0


class TeleportRequest(BaseModel):
    x: float
    y: float
    yaw: float = 0.0


class BatteryRequest(BaseModel):
    percentage: float = Field(ge=0.0, le=1.0)


class FaultRequest(BaseModel):
    kind: str = Field(description="disconnect | estop | clear")


class PublishRequest(BaseModel):
    topic: str
    message: dict = Field(default_factory=dict)


class UnreachableHostsRequest(BaseModel):
    hosts: list[str] = Field(default_factory=list)


def _state(robot_id: str):
    if robot_id not in ROBOTS:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    return get_engine().state_for(robot_id)


# ── engine / configuration ────────────────────────────────────────────────────


@router.get("/health")
async def sim_health():
    """Engine status plus a ready-made summary of the simulated fleet."""

    engine = get_engine()
    info = engine.info()
    info["webrtc_available"] = _webrtc_available()
    info["robots"] = {
        robot_id: engine.state_for(robot_id).as_dict() for robot_id in settings.robots
    }
    return info


@router.get("/config")
async def sim_config():
    return settings.as_dict()


@router.get("/waypoints")
async def sim_waypoints():
    """The named waypoints the world was built with, plus any the UI saved.

    The real backend has no waypoint store: the Navigation page's list is
    hardcoded there. Seeding from ``world.waypoints`` keeps the names the
    simulation was designed around (``charging_station``, ``loading_dock``, …)
    while letting the dashboard save its own.
    """

    if not _WAYPOINTS:
        _WAYPOINTS.update(
            {
                name: {"name": name, "x": x, "y": y, "yaw": yaw, "source": "world"}
                for name, (x, y, yaw) in get_engine().world.waypoints.items()
            }
        )

    return sorted(_WAYPOINTS.values(), key=lambda item: item["name"])


@router.post("/waypoints")
async def sim_save_waypoint(body: WaypointRequest):
    """Create or overwrite a named waypoint (or save the robot's current pose)."""

    if not _WAYPOINTS:
        await sim_waypoints()

    _WAYPOINTS[body.name] = {
        "name": body.name,
        "x": body.x,
        "y": body.y,
        "yaw": body.yaw,
        "source": "dashboard",
        "saved_at": time.time(),
    }
    return _WAYPOINTS[body.name]


@router.delete("/waypoints/{name}")
async def sim_delete_waypoint(name: str):
    if not _WAYPOINTS:
        await sim_waypoints()

    removed = _WAYPOINTS.pop(name, None)
    if removed is None:
        raise HTTPException(status_code=404, detail=f"waypoint '{name}' not found")
    return {"message": f"waypoint '{name}' deleted", "waypoint": removed}


@router.post("/engine/reset")
async def sim_reset(robot_id: str | None = Query(default=None)):
    engine = get_engine()
    engine.reset(robot_id)
    if robot_id:
        robot = ROBOTS.get(robot_id)
        if robot is not None:
            robot.set_status(
                RobotStatus.IDLE if robot.is_connected() else RobotStatus.OFFLINE
            )
    else:
        for robot in ROBOTS.values():
            robot.set_status(
                RobotStatus.IDLE if robot.is_connected() else RobotStatus.OFFLINE
            )
    return {"message": "simulation reset", "robot_id": robot_id}


@router.post("/faults/unreachable_hosts")
async def sim_unreachable_hosts(body: UnreachableHostsRequest):
    """Make specific rosbridge hosts refuse to connect (UI error paths)."""

    settings.unreachable_hosts = list(body.hosts)
    return {"unreachable_hosts": settings.unreachable_hosts}


# ── per robot ─────────────────────────────────────────────────────────────────


@router.get("/robots")
async def sim_robots():
    engine = get_engine()
    return [engine.state_for(robot_id).as_dict() for robot_id in settings.robots]


@router.get("/robots/{robot_id}")
async def sim_robot(robot_id: str):
    state = _state(robot_id).as_dict()
    robot = ROBOTS.get(robot_id)
    state["connected"] = bool(robot and robot.is_connected())
    state["connection_address"] = (
        {"host": robot.connected_host, "port": robot.connected_port} if robot else None
    )
    state["subscriptions"] = robot.subscription_count() if robot else 0
    return state


@router.get("/robots/{robot_id}/world")
async def sim_world(robot_id: str):
    """Ground-truth occupancy grid, for comparison with the SLAM map."""

    _state(robot_id)
    world = get_engine().world
    return {
        "resolution": world.resolution,
        "width": world.width,
        "height": world.height,
        "origin": list(world.origin),
        "cells": world.to_list(),
        "waypoints": {
            name: list(value) for name, value in world.waypoints.items()
        },
    }


@router.get("/robots/{robot_id}/telemetry/{topic}")
async def sim_telemetry(robot_id: str, topic: str):
    """Any topic, including those the WebSocket API does not expose."""

    state = _state(robot_id)
    if topic not in ALL_TOPICS and topic not in state.published:
        raise HTTPException(
            status_code=404,
            detail=f"unknown topic '{topic}'; known topics: {', '.join(ALL_TOPICS)}",
        )
    return {
        "robot_id": robot_id,
        "topic": topic,
        "generated_at": time.time(),
        "message": state.snapshot(topic),
    }


@router.get("/robots/{robot_id}/map.png")
async def sim_map_png(
    robot_id: str,
    source: str = Query(default="slam", pattern="^(slam|world)$"),
    downsample: int = Query(default=1, ge=1, le=16),
):
    """Render the SLAM map (or the ground truth) as a PNG for eyeballing.

    The dashboard mounts this as a background layer, so generation is cached
    per (robot, source, downsample, map revision) — row 0 of the grid is the
    BOTTOM of the map, which is the orientation the canvas expects, and the
    SLAM map changes at 5 Hz while this is polled far more slowly.
    """

    state = _state(robot_id)
    world = get_engine().world

    key = (robot_id, source, downsample, int(getattr(state, "map_revision", 0)))
    cached = _MAP_PNG_CACHE.get(key)
    if cached is None:
        cached = _render_map_png(world, state, source, downsample)
        _MAP_PNG_CACHE[key] = cached
        # Keep the cache small: a long session only ever revisits recent maps.
        while len(_MAP_PNG_CACHE) > 24:
            _MAP_PNG_CACHE.pop(next(iter(_MAP_PNG_CACHE)))

    return Response(
        content=cached,
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache",
            "ETag": f'W/"map-{source}-{downsample}-{key[3]}"',
        },
    )


def _render_map_png(world, state, source: str, step: int) -> bytes:
    """Render a grid as greyscale PNG, one output row per grid row.

    Row 0 of a ``nav_msgs/OccupancyGrid`` is the BOTTOM of the map, so the raw
    PNG has the map upside-down compared with how a canvas would draw it (and
    with how ROS's own ``map_saver`` writes it). That is deliberate: the image is
    a faithful dump of the grid, which is what it is useful for.

    The robot is **not** drawn into it. The image is cached by map revision, and
    the robot moves without a revision change, so a baked-in marker would go
    stale the moment the robot drives away. Callers that want the robot draw it
    themselves from the pose.
    """

    cells = list(state.known) if source == "slam" else world.to_list()

    width = world.width // step
    height = world.height // step
    rgb = bytearray(width * height * 3)

    for row in range(height):
        for column in range(width):
            value = cells[(row * step) * world.width + column * step]
            if value == 100:
                shade = 30
            elif value == 0:
                shade = 235
            else:
                shade = 115
            index = (row * width + column) * 3
            rgb[index] = shade
            rgb[index + 1] = shade
            rgb[index + 2] = shade

    return png_encode(width, height, bytes(rgb))


@router.post("/robots/{robot_id}/goal")
async def sim_goal(robot_id: str, body: GoalRequest):
    state = _state(robot_id)
    robot = ROBOTS[robot_id]
    goal = state.set_goal(body.x, body.y, body.yaw)
    if robot.is_connected():
        robot.set_status(RobotStatus.RUN_TASK)
    return {
        "message": "goal set",
        "robot_id": robot_id,
        "goal": {"x": goal[0], "y": goal[1], "yaw": goal[2]},
        "connected": robot.is_connected(),
    }


@router.post("/robots/{robot_id}/teleport")
async def sim_teleport(robot_id: str, body: TeleportRequest):
    state = _state(robot_id)
    state.teleport(body.x, body.y, body.yaw)
    return {"message": "teleported", "pose": state.as_dict()["pose"]}


@router.post("/robots/{robot_id}/battery")
async def sim_battery(robot_id: str, body: BatteryRequest):
    state = _state(robot_id)
    state.battery_percentage = body.percentage
    state.battery_voltage = 22.2 + 3.6 * body.percentage
    return {"message": "battery set", "percentage": body.percentage}


@router.post("/robots/{robot_id}/map/reveal_all")
async def sim_reveal_all(robot_id: str):
    """Materialise a fully known map, as if SLAM had already covered the site."""

    state = _state(robot_id)
    state.reveal_all()
    return {
        "message": "map revealed",
        "map_revision": state.map_revision,
        "mapped_ratio": round(state.mapped_ratio, 4),
    }


@router.post("/robots/{robot_id}/fault")
async def sim_fault(robot_id: str, body: FaultRequest):
    """Inject a fault so the dashboard's error handling can be tested."""

    state = _state(robot_id)
    robot = ROBOTS[robot_id]
    kind = body.kind.lower()

    if kind == "disconnect":
        robot.disconnect()
        return {"message": "robot disconnected", "status": robot.status.value}

    if kind == "estop":
        if not robot.is_connected():
            raise HTTPException(status_code=409, detail=f"Robot '{robot_id}' is not connected")
        robot.publish_emergency_stop(True)
        return {"message": "emergency stop engaged", "status": robot.status.value}

    if kind == "clear":
        state.emergency_stopped = False
        state.task = None
        state.stop_motion()
        if robot.is_connected():
            robot.set_status(RobotStatus.IDLE)
        return {"message": "faults cleared", "status": robot.status.value}

    raise HTTPException(status_code=400, detail="kind must be disconnect, estop or clear")


@router.post("/robots/{robot_id}/publish")
async def sim_publish(robot_id: str, body: PublishRequest):
    """Publish on any topic the robot's enum allows (e.g. ``goal_pose``)."""

    robot = ROBOTS.get(robot_id)
    if robot is None:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    if not robot.is_connected():
        raise HTTPException(status_code=409, detail=f"Robot '{robot_id}' is not connected")

    try:
        return robot.publish(body.topic, body.message)
    except KeyError as error:
        raise HTTPException(
            status_code=400,
            detail=f"topic not publishable on {robot_id}: {error}",
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


def _webrtc_available() -> bool:
    from routers.streaming import AIORTC_AVAILABLE

    return AIORTC_AVAILABLE
