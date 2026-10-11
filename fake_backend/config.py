"""Runtime configuration for the fake backend.

Everything the fake backend needs is read from the environment here, in one
place, with defaults that match the real deployment (backend/api.py served by
uvicorn on port 8000, JWT secret "CHANGE_ME", robots amr_1 on 192.168.1.219:9090
and go2_1 on 192.168.1.220:7070).

The simulation knobs live here too so the whole behaviour of the harness can be
tuned without touching code:

    FAKE_PORT=8000                  HTTP port (frontend .env expects 8000)
    FAKE_TICK_HZ=50                 simulation loop rate
    FAKE_MAP_RESOLUTION=0.05        SLAM map resolution (m/cell)
    FAKE_WORLD_WIDTH_M=16           simulated warehouse size
    FAKE_WORLD_HEIGHT_M=10
    FAKE_SENSOR_RANGE_M=6           lidar range used to reveal the map
    FAKE_LIDAR_RAYS=72              rays per simulated scan
    FAKE_CMD_VEL_TIMEOUT_S=0.5      deadman switch for /cmd_vel
    FAKE_BATTERY_START=0.87         initial state of charge (0..1)
    FAKE_BATTERY_DRAIN_PER_MIN=0.4  percent of charge lost per minute
    FAKE_CONNECT_LATENCY_MS=150     simulated rosbridge handshake time
    FAKE_SERVICE_LATENCY_MS=40      simulated ROS service round trip
    FAKE_UNREACHABLE_HOSTS=         comma separated hosts that fail to connect
    FAKE_SEED_USERS=admin:admin123  comma separated user:password pairs
    FAKE_ENABLE_SIM_API=1           expose the /sim helper endpoints
"""

from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent


def env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip()


def env_int(name: str, default: int) -> int:
    try:
        return int(env_str(name, str(default)))
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    try:
        return float(env_str(name, str(default)))
    except ValueError:
        return default


def env_bool(name: str, default: bool) -> bool:
    raw = env_str(name, "1" if default else "0").lower()
    return raw in {"1", "true", "yes", "on"}


def env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


class Settings:
    """Snapshot of the environment, read once at import time."""

    def __init__(self) -> None:
        # ── HTTP ────────────────────────────────────────────────────────────
        self.host: str = env_str("FAKE_HOST", "0.0.0.0")
        self.port: int = env_int("FAKE_PORT", 8000)
        self.reload: bool = env_bool("FAKE_RELOAD", False)
        self.log_level: str = env_str("FAKE_LOG_LEVEL", "info")
        #: Echo the mirrored modules' per-command chatter (the real backend prints
        #: it; at joystick rates it floods the console).
        self.verbose: bool = env_bool("FAKE_VERBOSE", False)

        # ── Auth (mirrors backend/routers/auth.py) ──────────────────────────
        self.secret_key: str = env_str("SECRET_KEY", "CHANGE_ME")
        self.algorithm: str = "HS256"
        self.access_token_expire_minutes: int = env_int(
            "FAKE_TOKEN_EXPIRE_MINUTES", 60
        )
        self.db_path: Path = Path(
            env_str("FAKE_DB_PATH", str(BASE_DIR / "database" / "users.db"))
        )
        self.seed_users: list[tuple[str, str]] = self._parse_seed_users(
            env_str(
                "FAKE_SEED_USERS",
                "admin:admin123,operator:operator123,demo:demo123",
            )
        )

        # ── Robot registry (mirrors backend/routers/connection.py) ──────────
        self.robots: dict[str, dict[str, object]] = {
            "amr_1": {
                "kind": "AMR",
                "host": env_str("FAKE_AMR_HOST", "192.168.1.219"),
                "port": env_int("FAKE_AMR_PORT", 9090),
            },
            "go2_1": {
                "kind": "Go2",
                "host": env_str("FAKE_GO2_HOST", "192.168.1.220"),
                "port": env_int("FAKE_GO2_PORT", 7070),
            },
        }

        # ── Simulated rosbridge ─────────────────────────────────────────────
        self.connect_latency_ms: int = env_int("FAKE_CONNECT_LATENCY_MS", 150)
        self.service_latency_ms: int = env_int("FAKE_SERVICE_LATENCY_MS", 40)
        #: Hosts that always refuse the connection, so the UI's error paths can
        #: be exercised. "0.0.0.0" and "" mean "use the robot's own address",
        #: which is what the real Robot.connect(host=host or self.host) does.
        self.unreachable_hosts: list[str] = env_list("FAKE_UNREACHABLE_HOSTS", [])

        # ── Simulation engine ───────────────────────────────────────────────
        self.tick_hz: float = env_float("FAKE_TICK_HZ", 50.0)
        self.map_resolution: float = env_float("FAKE_MAP_RESOLUTION", 0.05)
        self.world_width_m: float = env_float("FAKE_WORLD_WIDTH_M", 16.0)
        self.world_height_m: float = env_float("FAKE_WORLD_HEIGHT_M", 10.0)
        self.sensor_range_m: float = env_float("FAKE_SENSOR_RANGE_M", 6.0)
        self.lidar_rays: int = env_int("FAKE_LIDAR_RAYS", 72)
        #: Shortest exploration leg: frontiers closer than this are only used when
        #: nothing further is known, which stops the robot inching along the edge
        #: of its own map.
        self.frontier_min_leg_m: float = env_float("FAKE_FRONTIER_MIN_LEG_M", 1.5)
        self.scan_interval_s: float = env_float("FAKE_SCAN_INTERVAL_S", 0.1)
        self.odom_rate_hz: float = env_float("FAKE_ODOM_RATE_HZ", 20.0)
        self.imu_rate_hz: float = env_float("FAKE_IMU_RATE_HZ", 20.0)
        self.battery_rate_hz: float = env_float("FAKE_BATTERY_RATE_HZ", 1.0)
        self.diagnostics_rate_hz: float = env_float("FAKE_DIAGNOSTICS_RATE_HZ", 2.0)
        self.path_rate_hz: float = env_float("FAKE_PATH_RATE_HZ", 2.0)
        self.cmd_vel_timeout_s: float = env_float("FAKE_CMD_VEL_TIMEOUT_S", 0.5)
        self.battery_start: float = env_float("FAKE_BATTERY_START", 0.87)
        self.battery_drain_per_min: float = env_float(
            "FAKE_BATTERY_DRAIN_PER_MIN", 0.4
        )
        self.max_linear_speed: float = env_float("FAKE_MAX_LINEAR_SPEED", 0.6)
        self.max_angular_speed: float = env_float("FAKE_MAX_ANGULAR_SPEED", 1.2)
        self.start_pose: tuple[float, float, float] = (
            env_float("FAKE_START_X", -6.2),
            env_float("FAKE_START_Y", -3.2),
            env_float("FAKE_START_YAW", 0.0),
        )
        self.default_goal_name: str = env_str(
            "FAKE_DEFAULT_GOAL", "charging_station"
        )

        # ── Optional helper API ─────────────────────────────────────────────
        self.enable_sim_api: bool = env_bool("FAKE_ENABLE_SIM_API", True)

        # ── WebRTC ──────────────────────────────────────────────────────────
        #: Skip importing aiortc/av entirely (lighter process, no ffmpeg DLLs).
        #: /streaming/offer/* then answer 501.
        self.disable_webrtc: bool = env_bool("FAKE_DISABLE_WEBRTC", False)
        #: Attach a synthetic camera track to the streaming pipeline so the
        #: WebRTC endpoints have something real to negotiate (there is no robot
        #: pushing a camera track in the fake setup).
        self.synthetic_camera: bool = env_bool("FAKE_SYNTHETIC_CAMERA", True)
        self.camera_robot: str = env_str("FAKE_CAMERA_ROBOT", "amr_1")
        self.camera_fps: int = env_int("FAKE_CAMERA_FPS", 12)

    @staticmethod
    def _parse_seed_users(raw: str) -> list[tuple[str, str]]:
        users: list[tuple[str, str]] = []
        for chunk in raw.split(","):
            chunk = chunk.strip()
            if not chunk or ":" not in chunk:
                continue
            user_name, password = chunk.split(":", 1)
            users.append((user_name.strip(), password))
        return users

    def robot_endpoint(self, robot_id: str) -> tuple[str, int]:
        entry = self.robots[robot_id]
        return str(entry["host"]), int(entry["port"])  # type: ignore[arg-type]

    def as_dict(self) -> dict[str, object]:
        """Effective configuration, minus secrets; used by GET /sim/config."""

        return {
            "host": self.host,
            "port": self.port,
            "token_expire_minutes": self.access_token_expire_minutes,
            "db_path": str(self.db_path),
            "robots": self.robots,
            "connect_latency_ms": self.connect_latency_ms,
            "service_latency_ms": self.service_latency_ms,
            "unreachable_hosts": self.unreachable_hosts,
            "tick_hz": self.tick_hz,
            "map_resolution": self.map_resolution,
            "world_width_m": self.world_width_m,
            "world_height_m": self.world_height_m,
            "sensor_range_m": self.sensor_range_m,
            "lidar_rays": self.lidar_rays,
            "frontier_min_leg_m": self.frontier_min_leg_m,
            "cmd_vel_timeout_s": self.cmd_vel_timeout_s,
            "battery_start": self.battery_start,
            "battery_drain_per_min": self.battery_drain_per_min,
            "max_linear_speed": self.max_linear_speed,
            "max_angular_speed": self.max_angular_speed,
            "start_pose": self.start_pose,
            "default_goal_name": self.default_goal_name,
            "enable_sim_api": self.enable_sim_api,
            "seed_users": [user for user, _ in self.seed_users],
        }


settings = Settings()
