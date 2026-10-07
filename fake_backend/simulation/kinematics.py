"""Motion primitives shared by the simulated robots."""

from __future__ import annotations

import math
from dataclasses import dataclass

from simulation.world import World


@dataclass
class Pose:
    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.yaw)

    def copy(self) -> "Pose":
        return Pose(self.x, self.y, self.yaw)


def wrap_angle(angle: float) -> float:
    """Normalise to (-pi, pi]."""
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def quaternion_from_yaw(yaw: float) -> tuple[float, float, float, float]:
    """``(x, y, z, w)`` for a rotation about Z only."""
    half = yaw / 2.0
    return (0.0, 0.0, math.sin(half), math.cos(half))


def yaw_from_quaternion(x: float, y: float, z: float, w: float) -> float:
    siny_cosp = 2.0 * (w * z + x * y)
    cosy_cosp = 1.0 - 2.0 * (y * y + z * z)
    return math.atan2(siny_cosp, cosy_cosp)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def step_pose(
    pose: Pose,
    linear: float,
    angular: float,
    dt: float,
    world: World,
    *,
    allow_slide: bool = True,
) -> Pose:
    """Integrate a unicycle model for ``dt`` seconds, refusing to drive into
    occupied cells.

    A blocked robot keeps its orientation change (so it can rotate out of a
    corner) but loses its forward velocity, which is what a real base does when
    its bumper/obstacle layer triggers.
    """

    yaw = wrap_angle(pose.yaw + angular * dt)
    moved = linear * dt

    if moved == 0.0:
        return Pose(pose.x, pose.y, yaw)

    nx = pose.x + math.cos(yaw) * moved
    ny = pose.y + math.sin(yaw) * moved

    if world.is_free_xy(nx, ny):
        return Pose(nx, ny, yaw)

    if allow_slide:
        # Try to slide along X only, then Y only (classic 2-axis unstick).
        if world.is_free_xy(nx, pose.y):
            return Pose(nx, pose.y, yaw)
        if world.is_free_xy(pose.x, ny):
            return Pose(pose.x, ny, yaw)

    return Pose(pose.x, pose.y, yaw)


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])
