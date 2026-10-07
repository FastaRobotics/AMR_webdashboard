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
    return {
        name: {"x": x, "y": y, "yaw": yaw}
        for name, (x, y, yaw) in get_engine().world.waypoints.items()
    }


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
    """Render the SLAM map (or the ground truth) as a PNG for eyeballing."""

    state = _state(robot_id)
    world = get_engine().world
    cells = (
        list(state.known)
        if source == "slam"
        else world.to_list()
    )

    step = downsample
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

    # Robot marker: a red block at the robot's cell.
    i, j = world.world_to_cell(state.pose.x, state.pose.y)
    for dj in range(2):
        for di in range(2):
            ci, cj = i // step + di, j // step + dj
            if 0 <= ci < width and 0 <= cj < height:
                index = (cj * width + ci) * 3
                rgb[index] = 255
                rgb[index + 1] = 40
                rgb[index + 2] = 40

    return Response(content=png_encode(width, height, bytes(rgb)), media_type="image/png")


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
