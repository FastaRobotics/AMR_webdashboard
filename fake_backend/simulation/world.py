"""Ground truth warehouse used by the simulation.

The world is a 2D occupancy grid in the ``map`` frame, stored exactly like a
``nav_msgs/msg/OccupancyGrid``: row-major, ``x`` fastest, cell (0, 0) at
``origin``. Cell values are ``0`` (free) and ``100`` (occupied); the robots'
SLAM maps additionally use ``-1`` for unknown.

The default layout is a warehouse that deliberately contains the four
waypoints the UI's Navigation page lists (charging station, loading dock,
storage area A, inspection point), reachable through 1.2 m aisles and a 1 m
doorway, so simulated navigation has something meaningful to do.
"""

from __future__ import annotations

import math
from array import array


OCCUPIED = 100
FREE = 0
UNKNOWN = -1

#: Waypoints mirrored from Dashboard_UI/src/pages/Navigation.tsx.
UI_WAYPOINTS: dict[str, tuple[float, float, float]] = {
    "charging_station": (2.5, 1.2, 0.0),
    "loading_dock": (-1.8, 3.4, 1.57),
    "storage_area_a": (4.2, -2.1, 3.14),
    "inspection_point": (0.5, -1.5, -1.57),
}


class World:
    """A 2D occupancy grid plus world<->cell conversions and ray casting."""

    def __init__(
        self,
        resolution: float,
        width: int,
        height: int,
        origin: tuple[float, float],
    ) -> None:
        self.resolution = resolution
        self.width = width
        self.height = height
        self.origin = origin
        self.cells: array = array("b", bytes(width * height))
        self.waypoints: dict[str, tuple[float, float, float]] = {}
        self.spawn: tuple[float, float, float] = (0.0, 0.0, 0.0)

    # ── geometry helpers ────────────────────────────────────────────────────

    @property
    def width_m(self) -> float:
        return self.width * self.resolution

    @property
    def height_m(self) -> float:
        return self.height * self.resolution

    def index(self, i: int, j: int) -> int:
        return j * self.width + i

    def in_bounds(self, i: int, j: int) -> bool:
        return 0 <= i < self.width and 0 <= j < self.height

    def world_to_cell(self, x: float, y: float) -> tuple[int, int]:
        i = int(math.floor((x - self.origin[0]) / self.resolution))
        j = int(math.floor((y - self.origin[1]) / self.resolution))
        return i, j

    def cell_center(self, i: int, j: int) -> tuple[float, float]:
        return (
            self.origin[0] + (i + 0.5) * self.resolution,
            self.origin[1] + (j + 0.5) * self.resolution,
        )

    def value(self, i: int, j: int) -> int:
        if not self.in_bounds(i, j):
            return OCCUPIED
        return self.cells[self.index(i, j)]

    def is_free_xy(self, x: float, y: float) -> bool:
        i, j = self.world_to_cell(x, y)
        return self.value(i, j) != OCCUPIED

    def to_list(self) -> list[int]:
        return list(self.cells)

    # ── construction ────────────────────────────────────────────────────────

    def fill_rect(
        self, x0: float, y0: float, x1: float, y1: float, value: int = OCCUPIED
    ) -> None:
        i0, j0 = self.world_to_cell(min(x0, x1), min(y0, y1))
        i1, j1 = self.world_to_cell(max(x0, x1), max(y0, y1))
        for j in range(max(j0, 0), min(j1, self.height - 1) + 1):
            base = j * self.width
            for i in range(max(i0, 0), min(i1, self.width - 1) + 1):
                self.cells[base + i] = value

    def fill_circle(self, x: float, y: float, radius: float, value: int = OCCUPIED) -> None:
        i0, j0 = self.world_to_cell(x - radius, y - radius)
        i1, j1 = self.world_to_cell(x + radius, y + radius)
        r2 = radius * radius
        for j in range(max(j0, 0), min(j1, self.height - 1) + 1):
            cy = self.origin[1] + (j + 0.5) * self.resolution
            for i in range(max(i0, 0), min(i1, self.width - 1) + 1):
                cx = self.origin[0] + (i + 0.5) * self.resolution
                if (cx - x) ** 2 + (cy - y) ** 2 <= r2:
                    self.cells[j * self.width + i] = value

    # ── lidar ───────────────────────────────────────────────────────────────

    def raycast(
        self, x: float, y: float, angle: float, max_range: float
    ) -> tuple[list[tuple[int, int]], tuple[int, int] | None, float]:
        """March along a ray.

        Returns ``(free_cells, hit_cell, hit_distance)`` where ``free_cells``
        are the traversed cells before the hit (or the whole ray when nothing
        is hit).
        """

        step = self.resolution
        dx = math.cos(angle) * step
        dy = math.sin(angle) * step
        cx, cy = x, y
        free_cells: list[tuple[int, int]] = []
        last: tuple[int, int] | None = None
        distance = 0.0

        while distance < max_range:
            cx += dx
            cy += dy
            distance += step
            i, j = self.world_to_cell(cx, cy)

            if not self.in_bounds(i, j):
                return free_cells, None, distance
            if (i, j) == last:
                continue
            last = (i, j)

            if self.value(i, j) == OCCUPIED:
                return free_cells, (i, j), distance
            free_cells.append((i, j))

        return free_cells, None, distance


def build_demo_world(
    resolution: float, width_m: float, height_m: float
) -> World:
    """A deterministic warehouse layout, centered on the map origin."""

    width = max(8, int(round(width_m / resolution)))
    height = max(8, int(round(height_m / resolution)))
    origin = (-width * resolution / 2.0, -height * resolution / 2.0)
    world = World(resolution, width, height, origin)

    x_min, y_min = origin
    x_max = x_min + world.width_m
    y_max = y_min + world.height_m

    # Outer walls, two cells (0.1 m at 0.05 m/cell) thick.
    thickness = 2 * resolution
    world.fill_rect(x_min, y_min, x_max, y_min + thickness)
    world.fill_rect(x_min, y_max - thickness, x_max, y_max)
    world.fill_rect(x_min, y_min, x_min + thickness, y_max)
    world.fill_rect(x_max - thickness, y_min, x_max, y_max)

    # Four storage racks with 1.2 m aisles: 0.8 m wide, 5 m long.
    for rack_x in (-5.0, -3.0, -1.0, 1.0):
        world.fill_rect(
            rack_x - 0.4, -3.6, rack_x + 0.4, 1.4, OCCUPIED
        )

    # Store room in the top-right corner with a 1 m doorway.
    room = (3.0, 0.5, 7.5, 4.5)
    world.fill_rect(room[0], room[1], room[2], room[1] + thickness, OCCUPIED)
    world.fill_rect(room[0], room[3] - thickness, room[2], room[3], OCCUPIED)
    world.fill_rect(room[0], room[1], room[0] + thickness, room[3], OCCUPIED)
    world.fill_rect(room[2] - thickness, room[1], room[2], room[3], OCCUPIED)
    world.fill_rect(4.6, room[1], 5.6, room[1] + thickness, FREE)  # doorway

    # Pillars and a charging dock (kept clear of the UI waypoints above).
    for pillar in ((2.6, -3.6), (6.5, -3.6), (-6.6, 3.6)):
        world.fill_circle(pillar[0], pillar[1], 0.25, OCCUPIED)
    world.fill_rect(-7.4, -0.3, -6.8, 0.3, OCCUPIED)  # charging dock marker

    world.waypoints = dict(UI_WAYPOINTS)
    world.spawn = (-6.2, -3.2, 0.0)
    return world
