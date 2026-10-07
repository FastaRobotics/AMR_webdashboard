"""Path planning over the occupancy grid, for exploring and navigation.

Planning happens on a coarsened grid (``STRIDE`` cells per node) which keeps
A* fast enough to re-plan while the simulation loop is running, and gives the
robot a natural 0.2 m-scale path instead of a stair-step along individual cells.

Two occupancy sources are supported:

* the ground truth (``World.cells``) — what a navigation stack uses once it has
  loaded a map;
* the robot's own SLAM map (``array('b')`` with ``-1`` for unknown) — what an
  exploring robot uses, so it never plans through cells it has not seen.
"""

from __future__ import annotations

import heapq
import math
from array import array

from simulation.world import OCCUPIED, UNKNOWN, World


STRIDE = 4
SQRT2 = math.sqrt(2.0)


def _node_of(i: int, j: int) -> tuple[int, int]:
    return i // STRIDE, j // STRIDE


def _node_free(
    source: array | list[int],
    width: int,
    height: int,
    node: tuple[int, int],
    unknown_is_free: bool = False,
) -> bool:
    """A coarse node counts as free when every fine cell in it is passable."""

    ni, nj = node
    for j in range(nj * STRIDE, nj * STRIDE + STRIDE):
        for i in range(ni * STRIDE, ni * STRIDE + STRIDE):
            if not (0 <= i < width and 0 <= j < height):
                return False
            value = source[j * width + i]
            if value == OCCUPIED:
                return False
            if value == UNKNOWN and not unknown_is_free:
                return False
    return True


def nearest_free_cell(
    world: World, x: float, y: float, max_radius_cells: int = 40
) -> tuple[int, int] | None:
    """Snap a world point to the closest free cell (spiral search)."""

    i0, j0 = world.world_to_cell(x, y)
    if world.value(i0, j0) != OCCUPIED:
        return i0, j0

    for radius in range(1, max_radius_cells + 1):
        for di in range(-radius, radius + 1):
            for dj in (-radius, radius):
                if world.value(i0 + di, j0 + dj) != OCCUPIED:
                    return i0 + di, j0 + dj
        for dj in range(-radius + 1, radius):
            for di in (-radius, radius):
                if world.value(i0 + di, j0 + dj) != OCCUPIED:
                    return i0 + di, j0 + dj
    return None


def astar(
    source: array | list[int],
    width: int,
    height: int,
    start_xy: tuple[float, float],
    goal_xy: tuple[float, float],
    origin: tuple[float, float],
    resolution: float,
    *,
    unknown_is_free: bool = False,
    max_expansions: int = 20000,
) -> list[tuple[float, float]]:
    """Return a list of world-space waypoints, or ``[]`` when unreachable."""

    def to_node(x: float, y: float) -> tuple[int, int]:
        i = int(math.floor((x - origin[0]) / resolution))
        j = int(math.floor((y - origin[1]) / resolution))
        return _node_of(i, j)

    start = to_node(*start_xy)
    goal = to_node(*goal_xy)

    if start == goal:
        return [goal_xy]

    def heuristic(node: tuple[int, int]) -> float:
        return math.hypot(node[0] - goal[0], node[1] - goal[1])

    open_heap: list[tuple[float, tuple[int, int]]] = [(heuristic(start), start)]
    came_from: dict[tuple[int, int], tuple[int, int]] = {}
    cost: dict[tuple[int, int], float] = {start: 0.0}
    seen: set[tuple[int, int]] = {start}
    expansions = 0

    while open_heap:
        _, current = heapq.heappop(open_heap)
        if current == goal:
            break

        expansions += 1
        if expansions > max_expansions:
            return []

        ci, cj = current
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if di == 0 and dj == 0:
                    continue
                neighbour = (ci + di, cj + dj)
                if not _node_free(source, width, height, neighbour, unknown_is_free):
                    continue
                if di != 0 and dj != 0:
                    # Do not cut corners diagonally past a blocked node.
                    if not _node_free(
                        source, width, height, (ci + di, cj), unknown_is_free
                    ) or not _node_free(
                        source, width, height, (ci, cj + dj), unknown_is_free
                    ):
                        continue

                step_cost = SQRT2 if (di != 0 and dj != 0) else 1.0
                tentative = cost[current] + step_cost
                if tentative < cost.get(neighbour, math.inf):
                    cost[neighbour] = tentative
                    came_from[neighbour] = current
                    if neighbour not in seen:
                        seen.add(neighbour)
                        heapq.heappush(
                            open_heap, (tentative + heuristic(neighbour), neighbour)
                        )

    if goal not in came_from:
        return []

    nodes = [goal]
    while nodes[-1] != start:
        nodes.append(came_from[nodes[-1]])
    nodes.reverse()

    waypoints: list[tuple[float, float]] = []
    for node in nodes:
        x = origin[0] + (node[0] * STRIDE + STRIDE / 2.0) * resolution
        y = origin[1] + (node[1] * STRIDE + STRIDE / 2.0) * resolution
        waypoints.append((x, y))
    waypoints[-1] = goal_xy
    return waypoints


def frontier_target(
    known: array | list[int],
    width: int,
    height: int,
    origin: tuple[float, float],
    resolution: float,
    pose_xy: tuple[float, float],
    *,
    min_leg_m: float = 1.5,
    exclude: list[tuple[float, float]] | None = None,
    exclude_radius_m: float = 1.2,
    max_visit_cells: int = 12000,
) -> tuple[float, float] | None:
    """Pick the next exploration goal: a *mapped* cell on the frontier.

    Breadth-first from the robot over the cells it has already mapped, so the
    distance used is a walking distance, not a straight line through walls, and
    the returned cell is always reachable (it is mapped free space).

    Among the frontiers at least ``min_leg_m`` away the furthest one is chosen,
    which keeps the robot driving useful legs instead of inching along the edge
    of its own map. Points near ``exclude`` (targets that already proved
    unreachable) are skipped so a wall the map has not caught up with cannot
    trap the robot in a plan/abandon loop.
    """

    start_i = int(math.floor((pose_xy[0] - origin[0]) / resolution))
    start_j = int(math.floor((pose_xy[1] - origin[1]) / resolution))
    if not (0 <= start_i < width and 0 <= start_j < height):
        return None

    start = start_j * width + start_i
    if known[start] == OCCUPIED:
        return None

    min_leg_cells = max(1, int(round(min_leg_m / resolution)))
    excluded = list(exclude or [])
    radius_sq = exclude_radius_m * exclude_radius_m

    def is_excluded(point: tuple[float, float]) -> bool:
        for ex, ey in excluded:
            if (point[0] - ex) ** 2 + (point[1] - ey) ** 2 <= radius_sq:
                return True
        return False

    queue = [start]
    visited = bytearray(width * height)
    visited[start] = 1
    depth: dict[int, int] = {start: 0}
    head = 0

    nearest: tuple[float, float] | None = None
    farthest: tuple[float, float] | None = None
    farthest_depth = -1

    while head < len(queue) and head < max_visit_cells:
        current = queue[head]
        head += 1
        current_depth = depth[current]
        ci = current % width
        cj = current // width

        for ni, nj in ((ci + 1, cj), (ci - 1, cj), (ci, cj + 1), (ci, cj - 1)):
            if not (0 <= ni < width and 0 <= nj < height):
                continue
            n_index = nj * width + ni
            if visited[n_index]:
                continue
            visited[n_index] = 1
            value = known[n_index]

            if value == OCCUPIED:
                continue

            if value == UNKNOWN:
                # `current` is the mapped cell bordering the unknown space; it is
                # somewhere the robot can actually stand.
                point = (
                    origin[0] + (ci + 0.5) * resolution,
                    origin[1] + (cj + 0.5) * resolution,
                )
                if is_excluded(point):
                    continue
                if nearest is None:
                    nearest = point
                if current_depth >= min_leg_cells and current_depth > farthest_depth:
                    farthest_depth = current_depth
                    farthest = point
                continue

            depth[n_index] = current_depth + 1
            queue.append(n_index)

    return farthest or nearest
