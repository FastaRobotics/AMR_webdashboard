"""Per-robot simulated state: motion, tasks, map, sensors and services.

One ``SimRobotState`` stands in for the whole robot side of the cable: the SLAM
node, the navigation stack, the sensor drivers, the diagnostic aggregator and
the rosbag recorder. ``SimulationEngine`` ticks every robot at a fixed rate and
publishes the resulting ROS messages to whatever ``RosSubscriber``-style
callbacks are attached, exactly like rosbridge would push them.
"""

from __future__ import annotations

import math
import time
from array import array
from dataclasses import dataclass, field

from simulation import telemetry
from simulation.kinematics import (
    Pose,
    clamp,
    distance,
    step_pose,
    wrap_angle,
    yaw_from_quaternion,
)
from simulation.planning import astar, frontier_target, nearest_free_cell
from simulation.world import FREE, OCCUPIED, UNKNOWN, World


#: Topics the streaming WebSocket can serve, and how often the "robot" publishes.
STREAM_TOPICS: dict[str, float] = {
    "odom": 1 / 20,
    "tf": 1 / 20,
    "diagnostics": 1 / 2,
    "path": 1 / 2,
    "map": 1 / 5,
}

#: Extra topics that exist on the robot but have no WebSocket endpoint; they are
#: generated on demand (see ``snapshot``) — exactly the topics the real backend
#: can subscribe to but never exposes.
ON_DEMAND_TOPICS = (
    "imu",
    "battery_state",
    "point_cloud",
    "image_compressed",
    "depth_image_compressed",
    "left_wheel_encoder",
    "right_wheel_encoder",
)

TWIST_TOPICS = (
    "cmd_vel",
    "cmd_vel_joy",
    "cmd_vel_nav",
    "cmd_vel_out",
    "cmd_vel_filtered",
    "cmd_vel_doc",
)

WHEEL_TICKS_PER_METRE = 4000.0
WHEEL_SEPARATION_M = 0.44


@dataclass
class MapRecord:
    """A map saved on the robot (what ``load_map_by_name`` reads back)."""

    name: str
    resolution: float
    width: int
    height: int
    origin: tuple[float, float]
    cells: array
    created_at: float
    loop_closures: int = 0
    path: str = ""

    @property
    def size_bytes(self) -> int:
        return len(self.cells)


@dataclass
class RosbagRecord:
    name: str
    created_at: float
    topics: list[str] = field(default_factory=list)
    finished_at: float | None = None
    message_count: int = 0

    @property
    def duration_s(self) -> float:
        end = self.finished_at or time.time()
        return max(0.0, end - self.created_at)

    @property
    def size_bytes(self) -> int:
        # ~1.1 MB/s is a realistic rosbag write rate for this topic set.
        return int(self.duration_s * 1_100_000) + 4096


class SimRobotState:
    """Everything the simulation knows about one robot."""

    def __init__(
        self,
        robot_id: str,
        kind: str,
        settings,
        world: World,
    ) -> None:
        self.robot_id = robot_id
        self.kind = kind
        self.settings = settings
        self.world = world

        self.created_at = time.time()
        self.sim_time = 0.0
        self.robot_status = "offline"

        spawn = tuple(settings.start_pose)
        if not world.is_free_xy(spawn[0], spawn[1]):
            snapped = nearest_free_cell(world, spawn[0], spawn[1])
            if snapped:
                x, y = world.cell_center(*snapped)
                spawn = (x, y, spawn[2])
        self.pose = Pose(*spawn)

        # Motion
        self.linear_velocity = 0.0
        self.angular_velocity = 0.0
        self.body_height = 0.32 if kind == "Go2" else 0.0
        self.body_vertical_acceleration = 0.0
        self.emergency_stopped = False
        self.cmd_linear = 0.0
        self.cmd_angular = 0.0
        self.cmd_stamp = 0.0
        self.velocity_active = False
        self._was_manual = False

        # Tasks
        self.task: str | None = None
        self.goal: tuple[float, float, float] | None = None
        self.plan: list[tuple[float, float]] = []
        self.plan_index = 0
        self.replan_at = 0.0
        self._stuck_time = 0.0
        #: Exploration targets that turned out to be unreachable, with the time
        #: they failed: (x, y, sim_time).
        self.blocked_frontiers: list[tuple[float, float, float]] = []
        self._plan_best_distance: float | None = None
        self.exploring_complete = False
        self.last_navigation_result = "idle"
        self.path_started = False

        # Capabilities (mirror the real per-robot topic/service enums)
        self.mapping_available = kind == "AMR"
        self.map_topic_available = kind == "AMR"
        self.path_topic_available = kind == "AMR"
        self.diagnostics_topic_available = kind == "AMR"
        self.camera_fps = 30
        self.camera_resolution = "1920x1080" if kind == "AMR" else "1280x720"

        # SLAM map: array('b') because OccupancyGrid data is -1/0/100.
        self.known: array = array("b", [UNKNOWN]) * (world.width * world.height)
        self.map_revision = 0
        self.map_stamp = time.time()
        self.map_active = False
        self.loaded_map_name: str | None = None
        self.last_scan_at = 0.0
        self.scan_rate_hz = 0.0
        self.sensor_range_m = settings.sensor_range_m
        self.lidar_rays = settings.lidar_rays
        self.loop_closures = 0
        self._known_list: list[int] | None = None
        self._known_list_revision = -1

        self.saved_maps: dict[str, MapRecord] = {}
        self._seed_maps()

        # Recording
        self.recording = False
        self.recording_name: str | None = None
        self.recording_started_at: float | None = None
        self.rosbags: dict[str, RosbagRecord] = {}

        # Power, hardware health
        self.battery_percentage = settings.battery_start
        self.battery_voltage = 22.2 + 3.6 * self.battery_percentage
        self.battery_current = -0.8
        self.battery_temperature = 28.0
        self.left_encoder = 0
        self.right_encoder = 0
        self.motor_temperature = 34.0
        self.cpu_load = 0.24
        self.cpu_temperature = 46.0
        self.webrtc_peers = 0

        # Books
        self._sequences: dict[str, int] = {}
        self._due: dict[str, float] = {}
        self.last_messages: dict[str, dict | None] = {}
        self.published: dict[str, dict] = {}
        self.cmd_vel_timeout_s = settings.cmd_vel_timeout_s
        #: Set when a task finishes on its own; the engine turns it into a
        #: robot status change ("the robot went back to idle").
        self.pending_status: str | None = None

    # ── housekeeping ────────────────────────────────────────────────────────

    def _seed_maps(self) -> None:
        """Pre-load the maps a real robot would already have on disk."""

        if not self.mapping_available:
            return
        ground_truth = array("b", self.world.cells)
        names = (
            "latest",
            "warehouse_level_1",
            "office_floor_2",
            "factory_zone_a",
        )
        for index, name in enumerate(names):
            self.saved_maps[name] = MapRecord(
                name=name,
                resolution=self.world.resolution,
                width=self.world.width,
                height=self.world.height,
                origin=self.world.origin,
                cells=array("b", ground_truth),
                created_at=time.time() - 86400 * (index + 1),
                loop_closures=3 + index,
                path=f"/root/amr_ws/maps/{name}.yaml",
            )

    def next_seq(self, key: str) -> int:
        self._sequences[key] = self._sequences.get(key, 0) + 1
        return self._sequences[key]

    def take_pending_status(self) -> str | None:
        """Consume a self-reported status change (see ``pending_status``)."""

        value = self.pending_status
        self.pending_status = None
        return value

    def due(self, topic: str, interval: float) -> bool:
        now = self.sim_time
        if now >= self._due.get(topic, 0.0):
            # Schedule the next emission slightly ahead to keep a stable rate.
            self._due[topic] = now + interval
            return True
        return False

    def reset(self) -> None:
        self.__init__(self.robot_id, self.kind, self.settings, self.world)

    # ── map ─────────────────────────────────────────────────────────────────

    @property
    def mapped_ratio(self) -> float:
        known = sum(1 for value in self.known if value != UNKNOWN)
        return known / float(len(self.known))

    def known_map_data(self) -> list[int]:
        if self._known_list is None or self._known_list_revision != self.map_revision:
            self._known_list = list(self.known)
            self._known_list_revision = self.map_revision
        return self._known_list

    def scan(self) -> None:
        """One simulated lidar sweep, fused into the SLAM map."""

        if not self.map_active:
            return

        rays = self.lidar_rays
        changed = False
        field = self.known
        width = self.world.width

        for index in range(rays):
            angle = self.pose.yaw + 2.0 * math.pi * index / rays
            free_cells, hit, _ = self.world.raycast(
                self.pose.x, self.pose.y, angle, self.sensor_range_m
            )
            for i, j in free_cells:
                cell = j * width + i
                if field[cell] == UNKNOWN:
                    field[cell] = FREE
                    changed = True
            if hit is not None:
                cell = hit[1] * width + hit[0]
                if field[cell] != OCCUPIED:
                    field[cell] = OCCUPIED
                    changed = True

        now = time.time()
        if self.last_scan_at:
            self.scan_rate_hz = 1.0 / max(now - self.last_scan_at, 1e-6)
        self.last_scan_at = now

        if changed:
            self.map_revision += 1
            self.map_stamp = now
            if self.task == "mapping" and self.map_revision % 400 == 0:
                self.loop_closures += 1
        elif self.task == "mapping":
            # Even without new cells SLAM keeps stamping/animation alive.
            self.map_stamp = now

    def reveal_all(self) -> None:
        self.known = array("b", self.world.cells)
        self.map_active = True
        self.map_revision += 1
        self.map_stamp = time.time()

    def save_map(self, name: str) -> MapRecord:
        record = MapRecord(
            name=name,
            resolution=self.world.resolution,
            width=self.world.width,
            height=self.world.height,
            origin=self.world.origin,
            cells=array("b", self.known),
            created_at=time.time(),
            loop_closures=self.loop_closures,
            path=f"/root/{self.robot_id}_ws/maps/{name}.yaml",
        )
        self.saved_maps[name] = record
        return record

    def load_map(self, name: str) -> MapRecord | None:
        record = self.saved_maps.get(name)
        if record is None:
            return None
        self.known = array("b", record.cells)
        self.map_revision += 1
        self.map_stamp = time.time()
        self.map_active = True
        self.loaded_map_name = name
        return record

    # ── motion and tasks ────────────────────────────────────────────────────

    @property
    def goal_text(self) -> str:
        if self.goal is None:
            return "none"
        return f"({self.goal[0]:.2f}, {self.goal[1]:.2f})"

    @property
    def distance_remaining(self) -> float:
        if self.goal is None:
            return 0.0
        return distance((self.pose.x, self.pose.y), (self.goal[0], self.goal[1]))

    def set_goal(self, x: float, y: float, yaw: float = 0.0) -> tuple[float, float, float]:
        snapped = nearest_free_cell(self.world, x, y)
        if snapped is not None:
            x, y = self.world.cell_center(*snapped)
        self.goal = (x, y, yaw)
        self.plan = []
        self.plan_index = 0
        self.path_started = True
        self.task = "navigation"
        self.last_navigation_result = "navigating"
        self.emergency_stopped = False
        return self.goal

    def set_twist(self, linear: float, angular: float) -> None:
        self.cmd_linear = clamp(
            linear, -self.settings.max_linear_speed, self.settings.max_linear_speed
        )
        self.cmd_angular = clamp(
            angular, -self.settings.max_angular_speed, self.settings.max_angular_speed
        )
        self.cmd_stamp = self.sim_time

    def stop_motion(self) -> None:
        self.cmd_linear = 0.0
        self.cmd_angular = 0.0
        self.linear_velocity = 0.0
        self.angular_velocity = 0.0

    def _live_blocked_frontiers(self) -> list[tuple[float, float]]:
        """Exploration targets that recently failed, still worth avoiding."""

        now = self.sim_time
        self.blocked_frontiers = [
            entry for entry in self.blocked_frontiers if now - entry[2] < 60.0
        ]
        return [(x, y) for x, y, _ in self.blocked_frontiers]

    def _note_blocked_frontier(self, point: tuple[float, float]) -> None:
        self.blocked_frontiers.append((point[0], point[1], self.sim_time))
        del self.blocked_frontiers[:-8]

    def _plan_to(
        self,
        x: float,
        y: float,
        use_known_map: bool,
        unknown_is_free: bool = False,
    ) -> list[tuple[float, float]]:
        """A* over the SLAM map (or the ground truth) to ``(x, y)``.

        ``unknown_is_free`` lets a frontier-exploration plan aim *into* the
        unmapped region; navigation plans only through cells that are known to
        be free.
        """

        source = self.known if use_known_map else self.world.cells
        return astar(
            source,
            self.world.width,
            self.world.height,
            (self.pose.x, self.pose.y),
            (x, y),
            self.world.origin,
            self.world.resolution,
            unknown_is_free=unknown_is_free or not use_known_map,
        )

    def _follow_plan(self, dt: float) -> None:
        if self.plan_index >= len(self.plan):
            return

        lookahead = 0.45
        target = self.plan[self.plan_index]
        while (
            self.plan_index + 1 < len(self.plan)
            and distance((self.pose.x, self.pose.y), target) < lookahead
        ):
            self.plan_index += 1
            target = self.plan[self.plan_index]

        heading = math.atan2(target[1] - self.pose.y, target[0] - self.pose.x)
        error = wrap_angle(heading - self.pose.yaw)
        max_linear = self.settings.max_linear_speed
        max_angular = self.settings.max_angular_speed

        if abs(error) > 1.2:
            self.cmd_linear = 0.0
            self.cmd_angular = math.copysign(max_angular * 0.6, error)
        else:
            self.cmd_linear = max_linear * (1.0 - abs(error) / 1.6)
            self.cmd_angular = clamp(1.8 * error, -max_angular, max_angular)

        is_last = self.plan_index == len(self.plan) - 1
        if is_last and distance((self.pose.x, self.pose.y), target) < 0.25:
            if self.task != "navigation":
                # Reached the current frontier: drop the plan so the next tick
                # picks the next one (exploration only ends when none is left).
                self.plan = []
                self.plan_index = 0
                self.stop_motion()
                return
            # Final orientation alignment, then stop.
            goal_yaw = self.goal[2] if self.goal else self.pose.yaw
            yaw_error = wrap_angle(goal_yaw - self.pose.yaw)
            if abs(yaw_error) > 0.15:
                self.cmd_linear = 0.0
                self.cmd_angular = clamp(1.5 * yaw_error, -max_angular, max_angular)
            else:
                self._finish_navigation()

    def _finish_navigation(self) -> None:
        self.stop_motion()
        self.plan = []
        self.plan_index = 0
        self.task = None
        self.last_navigation_result = "goal reached"
        self.pending_status = "idle"

    def _update_task(self, dt: float) -> None:
        """Task state machine.

        Only called while the operator is *not* driving: a live ``/cmd_vel``
        stream always wins over the autonomous behaviour.
        """

        if self.task == "exploring":
            if not self.plan or self.plan_index >= len(self.plan):
                target = frontier_target(
                    self.known,
                    self.world.width,
                    self.world.height,
                    self.world.origin,
                    self.world.resolution,
                    (self.pose.x, self.pose.y),
                    min_leg_m=self.settings.frontier_min_leg_m,
                    exclude=self._live_blocked_frontiers(),
                )
                if target is None:
                    self.exploring_complete = True
                    self.stop_motion()
                    self.task = None
                    self.last_navigation_result = "exploration complete"
                    self.pending_status = "idle"
                    return
                # Frontier plans are allowed to aim into unmapped space.
                self.plan = self._plan_to(
                    target[0], target[1], use_known_map=True, unknown_is_free=True
                )
                self.plan_index = 0
                if not self.plan:
                    self.exploring_complete = True
                    self.stop_motion()
                    self.task = None
                    return
            self.exploring_complete = False
            self._follow_plan(dt)

        elif self.task == "navigation":
            if not self.map_active and self.mapping_available:
                # A navigation launch file always brings a map with it.
                self.load_map("latest")
            if not self.plan:
                if self.goal is None:
                    self.task = None
                    return
                self.plan = self._plan_to(self.goal[0], self.goal[1], use_known_map=True)
                if not self.plan:
                    # Harness convenience: fall back to the ground-truth grid so a
                    # test never dead-ends on an incomplete SLAM map.
                    self.plan = self._plan_to(
                        self.goal[0], self.goal[1], use_known_map=False
                    )
                self.plan_index = 0
                if not self.plan:
                    self.stop_motion()
                    self.task = None
                    self.last_navigation_result = "goal unreachable"
                    return
            self._follow_plan(dt)

    def advance(self, dt: float) -> None:
        """One simulation step for this robot."""

        self.sim_time += dt
        now = self.sim_time

        # The operator's /cmd_vel has a deadman switch (a real base zeroes out
        # when the commands stop). A running task only gets to drive while no
        # recent operator command is in force.
        manual_active = (now - self.cmd_stamp) < self.cmd_vel_timeout_s
        if self._was_manual and not manual_active:
            # The deadman fired: the controller commands zero, so the base stops
            # instead of coasting.
            self.linear_velocity = 0.0
            self.angular_velocity = 0.0
        self._was_manual = manual_active

        if self.emergency_stopped:
            self.stop_motion()
        elif manual_active:
            pass  # the operator's command is already in cmd_linear/cmd_angular
        else:
            self.cmd_linear = 0.0
            self.cmd_angular = 0.0
            self._update_task(dt)

        if self.emergency_stopped:
            self.linear_velocity = 0.0
            self.angular_velocity = 0.0
        else:
            target_linear = self.cmd_linear
            target_angular = self.cmd_angular
            # First-order velocity ramp so odom/twist look like a real controller.
            ramp = min(1.0, dt * 6.0)
            self.linear_velocity += (target_linear - self.linear_velocity) * ramp
            self.angular_velocity += (target_angular - self.angular_velocity) * ramp
            if self.linear_velocity < 0.005:
                self.linear_velocity = 0.0
            if abs(self.angular_velocity) < 0.005:
                self.angular_velocity = 0.0

        self.velocity_active = bool(
            abs(self.linear_velocity) > 1e-3 or abs(self.angular_velocity) > 1e-3
        )

        previous_height = self.body_height
        self.pose = step_pose(
            self.pose, self.linear_velocity, self.angular_velocity, dt, self.world
        )

        # Progress watchdog: when a task's goal stops getting closer — typically a
        # wall the SLAM map has not caught up with — drop the plan and remember
        # the target so the next tick plans somewhere else.
        if self.task in {"navigation", "exploring"} and self.plan:
            remaining = distance((self.pose.x, self.pose.y), self.plan[-1])
            if self._plan_best_distance is None or remaining < self._plan_best_distance - 0.02:
                self._plan_best_distance = remaining
                self._stuck_time = 0.0
            else:
                self._stuck_time += dt
                if self._stuck_time > 2.5:
                    if self.task == "exploring":
                        self._note_blocked_frontier(self.plan[-1])
                    self.plan = []
                    self.plan_index = 0
                    self._plan_best_distance = None
                    self._stuck_time = 0.0
        else:
            self._stuck_time = 0.0
            self._plan_best_distance = None

        if self.kind == "Go2":
            speed = abs(self.linear_velocity) + abs(self.angular_velocity) * 0.3
            stride = math.sin(self.sim_time * 2.0 * math.pi * 1.2)
            self.body_height = 0.32 + 0.02 * stride * min(1.0, speed * 3.0)
            self.body_vertical_acceleration = (
                (self.body_height - previous_height) / max(dt, 1e-6) * 2.0
            )

        # Wheel odometry counters.
        left_speed = self.linear_velocity - self.angular_velocity * WHEEL_SEPARATION_M / 2
        right_speed = self.linear_velocity + self.angular_velocity * WHEEL_SEPARATION_M / 2
        self.left_encoder += int(left_speed * dt * WHEEL_TICKS_PER_METRE)
        self.right_encoder += int(right_speed * dt * WHEEL_TICKS_PER_METRE)

        # Mapping is a SLAM-node capability: it only consumes scans when running.
        if self.map_active and self.due("__scan", self.settings.scan_interval_s):
            self.scan()

        self._update_power(dt)
        self._update_hardware(dt)

    def _update_power(self, dt: float) -> None:
        if self.recording or self.velocity_active:
            drain = 1.6
        else:
            drain = 1.0
        self.battery_percentage = max(
            0.0,
            self.battery_percentage
            - (self.settings.battery_drain_per_min / 100.0) * (dt / 60.0) * drain,
        )
        load = abs(self.linear_velocity) * 1.4 + abs(self.angular_velocity) * 0.6
        self.battery_current = -(0.6 + load + 0.15 * math.sin(self.sim_time * 0.5))
        self.battery_voltage = (
            22.2 + 3.6 * self.battery_percentage + self.battery_current * 0.05
        )
        self.battery_temperature = (
            28.0 + 8.0 * (1.0 - self.battery_percentage) + 2.0 * load
        )

    def _update_hardware(self, dt: float) -> None:
        wobble = 0.06 * math.sin(self.sim_time * 0.7) + 0.04 * math.sin(
            self.sim_time * 2.3
        )
        base_load = 0.22 + 0.12 * abs(self.linear_velocity)
        if self.task == "mapping":
            base_load += 0.18
        if self.task in {"navigation", "exploring"}:
            base_load += 0.10
        self.cpu_load = max(0.02, min(0.99, base_load + wobble))
        self.cpu_temperature = 44.0 + 22.0 * self.cpu_load + 1.5 * math.sin(
            self.sim_time * 0.3
        )
        self.motor_temperature = 32.0 + 10.0 * abs(self.linear_velocity) + 1.0 * math.sin(
            self.sim_time * 0.9
        )

    # ── services ────────────────────────────────────────────────────────────

    def handle_service(self, handler: str, request: dict) -> dict:
        method = getattr(self, handler, None)
        if method is None:
            return {"success": False, "message": f"service {handler} is not implemented"}
        return method(request or {})

    def svc_start_mapping(self, request: dict) -> dict:
        self.task = "mapping"
        self.map_active = True
        self.stop_motion()
        return {
            "success": True,
            "message": "slam_toolbox started",
            "algorithm": "slam_toolbox",
        }

    def svc_stop_mapping(self, request: dict) -> dict:
        name = str(request.get("map_name") or "latest")
        record = self.save_map(name)
        self.task = None
        self.stop_motion()
        return {
            "success": True,
            "message": f"map saved as '{name}'",
            "map_name": name,
            "path": record.path,
            "size_bytes": record.size_bytes,
            "loop_closures": record.loop_closures,
        }

    def svc_load_map_by_name(self, request: dict) -> dict:
        name = str(request.get("map_name") or "latest")
        record = self.load_map(name)
        if record is None:
            return {
                "success": False,
                "message": f"map '{name}' not found",
                "available_maps": sorted(self.saved_maps),
            }
        return {
            "success": True,
            "message": f"map '{name}' loaded",
            "map_name": name,
            "path": record.path,
            "localized": bool(request.get("localize_after_load", True)),
        }

    def svc_delete_mapping(self, request: dict) -> dict:
        name = str(request.get("map_name") or "latest")
        if name in self.saved_maps:
            del self.saved_maps[name]
            return {"success": True, "message": f"map '{name}' deleted", "map_name": name}
        return {"success": False, "message": f"map '{name}' not found"}

    def svc_start_exploring(self, request: dict) -> dict:
        self.task = "exploring"
        self.map_active = True
        self.exploring_complete = False
        self.plan = []
        self.plan_index = 0
        self.blocked_frontiers.clear()
        self._plan_best_distance = None
        return {"success": True, "message": "frontier exploration started"}

    def svc_stop_exploring(self, request: dict) -> dict:
        self.task = None
        self.stop_motion()
        return {"success": True, "message": "frontier exploration stopped"}

    def svc_start_navigation(self, request: dict) -> dict:
        if not self.map_active and self.mapping_available:
            record = self.load_map("latest")
            if record is None:
                return {"success": False, "message": "no map available to navigate with"}
        self.task = "navigation"
        if self.goal is None:
            self._default_goal()
        self.plan = []
        self.plan_index = 0
        self.path_started = True
        self.emergency_stopped = False
        self.last_navigation_result = "navigating"
        return {
            "success": True,
            "message": "navigation started",
            "goal": self.goal_text,
        }

    def svc_start_navigation_with_map(self, request: dict) -> dict:
        name = str(request.get("map_name") or "latest")
        record = self.load_map(name)
        if record is None:
            return {"success": False, "message": f"map '{name}' not found"}
        self.task = "navigation"
        if self.goal is None:
            self._default_goal()
        self.plan = []
        self.plan_index = 0
        self.path_started = True
        self.emergency_stopped = False
        self.last_navigation_result = "navigating"
        return {
            "success": True,
            "message": f"navigation started with map '{name}'",
            "map_name": name,
            "localized": bool(request.get("localize_after_load", True)),
            "goal": self.goal_text,
        }

    def svc_stop_navigation(self, request: dict) -> dict:
        self.task = None
        self.plan = []
        self.plan_index = 0
        self.stop_motion()
        self.last_navigation_result = "stopped"
        return {"success": True, "message": "navigation stopped"}

    def svc_webrtc_start(self, request: dict) -> dict:
        self.webrtc_peers = max(1, self.webrtc_peers)
        return {"success": True, "message": "webrtc stream started"}

    def svc_start_recording(self, request: dict) -> dict:
        name = str(request.get("log_file_name") or request.get("rosbag_name") or "latest")
        if self.recording:
            return {
                "success": False,
                "message": f"already recording '{self.recording_name}'",
            }
        record = RosbagRecord(
            name=name,
            created_at=time.time(),
            topics=sorted(ON_DEMAND_TOPICS) + ["odom", "tf", "map"],
        )
        self.rosbags[name] = record
        self.recording = True
        self.recording_name = name
        self.recording_started_at = record.created_at
        return {
            "success": True,
            "message": f"recording started: {name}",
            "rosbag_name": name,
            "path": f"/root/{self.robot_id}_ws/bags/{name}.bag",
        }

    def svc_stop_recording(self, request: dict) -> dict:
        if not self.recording or self.recording_name is None:
            return {"success": False, "message": "not recording"}
        name = self.recording_name
        record = self.rosbags.get(name)
        if record is not None:
            record.finished_at = time.time()
            record.message_count = int(record.duration_s * 420)
        self.recording = False
        self.recording_name = None
        self.recording_started_at = None
        return {
            "success": True,
            "message": f"rosbag saved: {name}",
            "rosbag_name": name,
            "duration_s": round(record.duration_s, 2) if record else 0.0,
        }

    def svc_recording_status(self, request: dict) -> dict:
        """Clean status payload.

        The real backend chops the service message with ``.split(" ")[0]``,
        which throws away everything after the first word; here the state is
        reported as structured fields while keeping ``success``/``message``.
        """

        duration = 0.0
        if self.recording and self.recording_started_at:
            duration = time.time() - self.recording_started_at
        return {
            "success": True,
            "message": "recording" if self.recording else "idle",
            "recording": self.recording,
            "rosbag_name": self.recording_name,
            "duration_s": round(duration, 2),
            "rosbags": [
                {
                    "name": bag.name,
                    "size_bytes": bag.size_bytes,
                    "duration_s": round(bag.duration_s, 2),
                    "created_at": bag.created_at,
                }
                for bag in sorted(self.rosbags.values(), key=lambda b: b.created_at)
            ],
        }

    def svc_delete_recording(self, request: dict) -> dict:
        name = str(request.get("log_file_name") or request.get("rosbag_name") or "")
        if name in self.rosbags:
            del self.rosbags[name]
            if self.recording_name == name:
                self.recording = False
                self.recording_name = None
                self.recording_started_at = None
            return {"success": True, "message": f"rosbag '{name}' deleted"}
        return {"success": False, "message": f"rosbag '{name}' not found"}

    # ── publishers ──────────────────────────────────────────────────────────

    def apply_publish(self, topic: str, message: dict) -> None:
        self.published[topic] = message

        if topic in TWIST_TOPICS:
            linear = message.get("linear", 0.0)
            angular = message.get("angular", 0.0)
            linear_x = linear.get("x", 0.0) if isinstance(linear, dict) else float(linear)
            angular_z = (
                angular.get("z", 0.0) if isinstance(angular, dict) else float(angular)
            )
            if self.emergency_stopped:
                # A real base would ignore motion while the safety topic is set.
                self.stop_motion()
                return
            self.set_twist(float(linear_x), float(angular_z))

        elif topic == "emergency_stop":
            value = message.get("data")
            self.emergency_stopped = bool(value)
            if self.emergency_stopped:
                self.stop_motion()
                self.cmd_stamp = 0.0
                self.last_navigation_result = "emergency stop"

        elif topic == "goal_pose":
            pose = message.get("pose", {})
            position = pose.get("position", {})
            orientation = pose.get("orientation", {})
            yaw = 0.0
            if orientation:
                yaw = yaw_from_quaternion(
                    orientation.get("x", 0.0),
                    orientation.get("y", 0.0),
                    orientation.get("z", 0.0),
                    orientation.get("w", 1.0),
                )
            self.set_goal(
                float(position.get("x", 0.0)), float(position.get("y", 0.0)), yaw
            )

        elif topic == "initialpose":
            pose = message.get("pose", {}).get("pose", {})
            position = pose.get("position", {})
            snapped = nearest_free_cell(
                self.world,
                float(position.get("x", 0.0)),
                float(position.get("y", 0.0)),
            )
            if snapped:
                x, y = self.world.cell_center(*snapped)
                orientation = pose.get("orientation", {})
                self.pose = Pose(
                    x,
                    y,
                    yaw_from_quaternion(
                        orientation.get("x", 0.0),
                        orientation.get("y", 0.0),
                        orientation.get("z", 0.0),
                        orientation.get("w", 1.0),
                    ),
                )

        elif topic == "point":
            position = message.get("position", {})
            snapped = nearest_free_cell(
                self.world,
                float(position.get("x", 0.0)),
                float(position.get("y", 0.0)),
            )
            if snapped:
                x, y = self.world.cell_center(*snapped)
                orientation = message.get("orientation", {})
                self.pose = Pose(
                    x,
                    y,
                    yaw_from_quaternion(
                        orientation.get("x", 0.0),
                        orientation.get("y", 0.0),
                        orientation.get("z", 0.0),
                        orientation.get("w", 1.0),
                    ),
                )

    def _default_goal(self) -> None:
        name = self.settings.default_goal_name
        waypoint = self.world.waypoints.get(name)
        if waypoint is None:
            waypoint = next(iter(self.world.waypoints.values()), (0.0, 0.0, 0.0))
        self.goal = waypoint

    def teleport(self, x: float, y: float, yaw: float = 0.0) -> None:
        snapped = nearest_free_cell(self.world, x, y)
        if snapped:
            x, y = self.world.cell_center(*snapped)
        self.pose = Pose(x, y, yaw)
        self.stop_motion()
        self.plan = []
        self.plan_index = 0

    # ── on-demand telemetry ────────────────────────────────────────────────

    def snapshot(self, topic: str) -> dict | None:
        """Current message for any topic, generating sensor data on the fly."""

        topic = str(getattr(topic, "value", topic))

        if topic == "odom":
            return telemetry.make_odom(self)
        if topic == "tf":
            return telemetry.make_tf(self)
        if topic == "map":
            if not (self.map_active and self.map_topic_available):
                return None
            return telemetry.make_occupancy_grid(self, self.world)
        if topic == "diagnostics":
            return telemetry.make_diagnostics(self)
        if topic == "path":
            if not self.path_started:
                return None
            return telemetry.make_path(self)
        if topic == "imu":
            return telemetry.make_imu(self)
        if topic == "battery_state":
            return telemetry.make_battery_state(self)
        if topic == "point_cloud":
            return telemetry.make_point_cloud(self, self.world)
        if topic == "image_compressed":
            return telemetry.make_compressed_image(self, depth=False)
        if topic == "depth_image_compressed":
            return telemetry.make_compressed_image(self, depth=True)
        if topic == "left_wheel_encoder":
            return {"data": telemetry.make_wheel_encoder(self, "left")}
        if topic == "right_wheel_encoder":
            return {"data": telemetry.make_wheel_encoder(self, "right")}
        if topic in self.published:
            return self.published[topic]
        return None

    def as_dict(self) -> dict:
        return {
            "robot_id": self.robot_id,
            "kind": self.kind,
            "status": self.robot_status,
            "task": self.task,
            "pose": {
                "x": round(self.pose.x, 3),
                "y": round(self.pose.y, 3),
                "yaw": round(self.pose.yaw, 3),
            },
            "velocity": {
                "linear_x": round(self.linear_velocity, 3),
                "angular_z": round(self.angular_velocity, 3),
            },
            "goal": list(self.goal) if self.goal else None,
            "goal_text": self.goal_text,
            "distance_remaining_m": round(self.distance_remaining, 3),
            "plan_points": len(self.plan),
            "plan_index": self.plan_index,
            "plan": [[round(x, 2), round(y, 2)] for x, y in self.plan],
            "exploring_complete": self.exploring_complete,
            "last_navigation_result": self.last_navigation_result,
            "emergency_stopped": self.emergency_stopped,
            "battery": {
                "percentage": round(self.battery_percentage, 4),
                "voltage": round(self.battery_voltage, 2),
                "current": round(self.battery_current, 2),
                "temperature": round(self.battery_temperature, 1),
            },
            "map": {
                "active": self.map_active,
                "topic_available": self.map_topic_available,
                "loaded_map": self.loaded_map_name,
                "revision": self.map_revision,
                "mapped_ratio": round(self.mapped_ratio, 4),
                "loop_closures": self.loop_closures,
                "size": [self.world.width, self.world.height],
                "resolution": self.world.resolution,
            },
            "recording": {
                "active": self.recording,
                "rosbag_name": self.recording_name,
                "rosbags": sorted(self.rosbags),
            },
            "saved_maps": sorted(self.saved_maps),
            "capabilities": {
                "mapping": self.mapping_available,
                "map_topic": self.map_topic_available,
                "path_topic": self.path_topic_available,
                "diagnostics_topic": self.diagnostics_topic_available,
            },
            "hardware": {
                "cpu_load": round(self.cpu_load, 3),
                "cpu_temperature": round(self.cpu_temperature, 1),
                "motor_temperature": round(self.motor_temperature, 1),
                "left_encoder": self.left_encoder,
                "right_encoder": self.right_encoder,
                "webrtc_peers": self.webrtc_peers,
            },
            "sim_time": round(self.sim_time, 2),
        }
