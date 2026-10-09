"""Builders for ROS-shaped message payloads.

Every function returns a plain ``dict`` with exactly the field names a ROS
message has, because the real backend hands ``roslibpy`` messages straight to
``websocket.send_json`` — the UI therefore sees the raw ROS serialisation, not
a tidied-up DTO. The shapes here are the ones the frontend types declare in
``Dashboard_UI/src/api/types.ts``:

* ``nav_msgs/msg/Odometry``
* ``tf2_msgs/msg/TFMessage``
* ``nav_msgs/msg/OccupancyGrid``
* ``diagnostic_msgs/msg/DiagnosticArray``
* ``nav_msgs/msg/Path``
* ``sensor_msgs/msg/Imu`` / ``BatteryState`` / ``PointCloud2`` / ``CompressedImage``
* ``std_msgs/msg/Int32``

Stamps are ROS1 style (``{"secs": …, "nsecs": …}``) which is what roslibpy
speaks and what the frontend's ``RosTime`` expects.
"""

from __future__ import annotations

import time

from simulation.imaging import png_encode, render_camera_rgb, render_depth_rgb
from simulation.kinematics import quaternion_from_yaw


#: datatype codes from sensor_msgs/PointField
FLOAT32 = 7
UINT8 = 2


def stamp(when: float | None = None) -> dict:
    when = time.time() if when is None else when
    secs = int(when)
    return {"secs": secs, "nsecs": int((when - secs) * 1e9)}


def header(seq: int, frame_id: str, when: float | None = None) -> dict:
    return {"seq": seq, "stamp": stamp(when), "frame_id": frame_id}


def _diag_covariance(variances: list[float]) -> list[float]:
    """36-element row-major covariance with the given diagonal."""

    covariance = [0.0] * 36
    for axis, variance in enumerate(variances):
        covariance[axis * 6 + axis] = variance
    return covariance


def _vector3(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> dict:
    return {"x": x, "y": y, "z": z}


def pose_dict(x: float, y: float, z: float, yaw: float, pitch: float = 0.0) -> dict:
    qx, qy, qz, qw = quaternion_from_yaw(yaw)
    return {
        "position": _vector3(x, y, z),
        "orientation": {"x": qx, "y": qy, "z": qz, "w": qw},
    }


# ─── odometry, tf ─────────────────────────────────────────────────────────────


def make_odom(state) -> dict:
    pose = pose_dict(state.pose.x, state.pose.y, state.body_height, state.pose.yaw)
    return {
        "header": header(state.next_seq("odom"), "odom"),
        "child_frame_id": "base_link",
        "pose": {
            "pose": pose,
            "covariance": _diag_covariance(
                [0.0005, 0.0005, 0.0001, 0.0001, 0.0001, 0.0008]
            ),
        },
        "twist": {
            "twist": {
                "linear": _vector3(state.linear_velocity, 0.0, 0.0),
                "angular": _vector3(0.0, 0.0, state.angular_velocity),
            },
            "covariance": _diag_covariance(
                [0.0002, 0.0002, 0.0001, 0.0001, 0.0001, 0.0004]
            ),
        },
    }


def make_tf(state) -> dict:
    """Static-ish tree, re-stamped every tick like a real /tf broadcaster."""

    seq = state.next_seq("tf")
    now = time.time()
    qx, qy, qz, qw = quaternion_from_yaw(state.pose.yaw)

    transforms = [
        {
            "header": header(seq, "odom", now),
            "child_frame_id": "base_link",
            "transform": {
                "translation": _vector3(state.pose.x, state.pose.y, state.body_height),
                "rotation": {"x": qx, "y": qy, "z": qz, "w": qw},
            },
        },
        {
            "header": header(seq, "base_link", now),
            "child_frame_id": "laser_link",
            "transform": {
                "translation": _vector3(0.25, 0.0, 0.35),
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            },
        },
        {
            "header": header(seq, "base_link", now),
            "child_frame_id": "camera_link",
            "transform": {
                "translation": _vector3(0.30, 0.0, 0.55),
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            },
        },
        {
            "header": header(seq, "base_link", now),
            "child_frame_id": "imu_link",
            "transform": {
                "translation": _vector3(0.0, 0.0, 0.15),
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            },
        },
    ]
    return {"transforms": transforms}


# ─── map ──────────────────────────────────────────────────────────────────────


def make_occupancy_grid(state, world) -> dict:
    return {
        "header": header(state.next_seq("map"), "map", state.map_stamp),
        "info": {
            "map_load_time": stamp(state.map_stamp),
            "resolution": world.resolution,
            "width": world.width,
            "height": world.height,
            "origin": {
                "position": _vector3(world.origin[0], world.origin[1], 0.0),
                "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            },
        },
        # A fresh list each frame: this is what the real backend serialises too.
        "data": state.known_map_data(),
    }


# ─── diagnostics ──────────────────────────────────────────────────────────────


def _entry(
    level: int,
    name: str,
    message: str,
    hardware_id: str,
    values: dict[str, str] | None = None,
) -> dict:
    return {
        "level": level,
        "name": name,
        "message": message,
        "hardware_id": hardware_id,
        "values": [
            {"key": key, "value": str(value)} for key, value in (values or {}).items()
        ],
    }


def make_diagnostics(state) -> dict:
    """Service health, the way a real robot's diagnostic_aggregator reports it.

    Levels: 0 OK, 1 WARN, 2 ERROR, 3 STALE — exactly the mapping the UI's
    Dashboard and Robot Connection pages render.
    """

    now = time.time()
    hw = f"{state.robot_id}/{state.kind.lower()}"
    battery_pct = max(0.0, min(1.0, state.battery_percentage))
    entries: list[dict] = []

    scan_age = now - state.last_scan_at if state.last_scan_at else None
    lidar_level = 3 if scan_age is None or scan_age > 1.0 else 0
    entries.append(
        _entry(
            lidar_level,
            "lidar_node",
            "operational" if lidar_level == 0 else "no scan received",
            f"{hw}/lidar",
            {
                "scan_rate": f"{state.scan_rate_hz:.1f} Hz",
                "range": f"{state.sensor_range_m:.1f} m",
                "rays": state.lidar_rays,
            },
        )
    )

    if state.mapping_available:
        mapping_level = 0 if state.task == "mapping" else 3
        entries.append(
            _entry(
                mapping_level,
                "slam_toolbox",
                "building map" if state.task == "mapping" else "idle",
                f"{hw}/slam",
                {
                    "loop_closures": state.loop_closures,
                    "mapped_cells": f"{state.mapped_ratio * 100:.1f} %",
                    "map_revision": state.map_revision,
                },
            )
        )

    nav_level = 0 if state.task == "navigation" else 3
    entries.append(
        _entry(
            nav_level,
            "navigation_stack",
            "following path" if state.task == "navigation" else "idle",
            f"{hw}/nav2",
            {
                "goal": state.goal_text,
                "distance_remaining_m": f"{state.distance_remaining:.2f}",
                "path_points": len(state.plan),
            },
        )
    )

    controller_level = 0
    entries.append(
        _entry(
            controller_level,
            "controller_server",
            "publishing cmd_vel" if state.velocity_active else "holding zero",
            f"{hw}/controller",
            {
                "commanded_linear_x": f"{state.linear_velocity:.3f}",
                "commanded_angular_z": f"{state.angular_velocity:.3f}",
                "deadman_timeout_s": state.cmd_vel_timeout_s,
            },
        )
    )

    entries.append(
        _entry(
            0,
            "zed_camera",
            f"{state.camera_fps} FPS",
            f"{hw}/zed2i",
            {"resolution": state.camera_resolution, "latency_ms": 42},
        )
    )

    if state.battery_percentage < 0.30:
        battery_level, battery_message = 1, f"low battery ({battery_pct * 100:.0f} %)"
    elif state.battery_percentage < 0.12:
        battery_level, battery_message = 2, f"critical battery ({battery_pct * 100:.0f} %)"
    else:
        battery_level, battery_message = 0, f"{battery_pct * 100:.0f} % remaining"

    entries.append(
        _entry(
            battery_level,
            "battery_manager",
            battery_message,
            f"{hw}/bms",
            {
                "voltage_v": f"{state.battery_voltage:.2f}",
                "current_a": f"{state.battery_current:.2f}",
                "temperature_c": f"{state.battery_temperature:.1f}",
            },
        )
    )

    entries.append(
        _entry(
            0,
            "motor_driver",
            "engaged" if state.velocity_active else "standby",
            f"{hw}/motors",
            {
                "left_encoder": state.left_encoder,
                "right_encoder": state.right_encoder,
                "motor_temp_c": f"{state.motor_temperature:.1f}",
            },
        )
    )

    entries.append(
        _entry(
            2 if state.emergency_stopped else 0,
            "emergency_stop",
            "ENGAGED" if state.emergency_stopped else "released",
            f"{hw}/safety",
            {"source": "web dashboard" if state.emergency_stopped else "—"},
        )
    )

    if state.recording:
        entries.append(
            _entry(
                0,
                "rosbag_recorder",
                f"recording {state.recording_name}",
                f"{hw}/recorder",
                {"duration_s": f"{now - (state.recording_started_at or now):.1f}"},
            )
        )
    else:
        entries.append(
            _entry(3, "rosbag_recorder", "idle", f"{hw}/recorder", {"bags": len(state.rosbags)})
        )

    entries.append(
        _entry(
            0,
            "webrtc_streamer",
            "streaming",
            f"{hw}/webrtc",
            {"peers": state.webrtc_peers, "codec": "H264"},
        )
    )

    entries.append(
        _entry(
            0,
            "cpu_monitor",
            "nominal",
            f"{hw}/sbc",
            {
                "load_1m": f"{state.cpu_load:.2f}",
                "temperature_c": f"{state.cpu_temperature:.1f}",
                "uptime_s": f"{now - state.created_at:.0f}",
            },
        )
    )

    return {"header": header(state.next_seq("diagnostics"), ""), "status": entries}


# ─── path ─────────────────────────────────────────────────────────────────────


def make_path(state) -> dict:
    now = time.time()
    seq = state.next_seq("path")
    poses = []
    for index, (x, y) in enumerate(state.plan):
        yaw = state.pose.yaw
        if index + 1 < len(state.plan):
            nx, ny = state.plan[index + 1]
            yaw = _yaw_between((x, y), (nx, ny))
        poses.append(
            {
                "header": header(seq, "map", now),
                "pose": pose_dict(x, y, 0.0, yaw),
            }
        )
    return {"header": header(seq, "map", now), "poses": poses}


def _yaw_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math

    return math.atan2(b[1] - a[1], b[0] - a[0])


# ─── sensors (available through the simulator API, not streamed by the API) ───


def make_imu(state) -> dict:
    return {
        "header": header(state.next_seq("imu"), "imu_link"),
        "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
        "orientation_covariance": [0.001, 0.0, 0.0, 0.0, 0.001, 0.0, 0.0, 0.0, 0.001],
        "angular_velocity": _vector3(0.0, 0.0, state.angular_velocity),
        "angular_velocity_covariance": [0.0002] * 9,
        "linear_acceleration": _vector3(
            state.linear_velocity * 0.4, 0.0, 9.81 + state.body_vertical_acceleration
        ),
        "linear_acceleration_covariance": [0.0017] * 9,
    }


def make_battery_state(state) -> dict:
    cells = 6
    per_cell = state.battery_voltage / cells
    return {
        "header": header(state.next_seq("battery"), "base_link"),
        "voltage": state.battery_voltage,
        "temperature": state.battery_temperature,
        "current": state.battery_current,
        "charge": state.battery_percentage * 20.0,
        "capacity": 20.0,
        "design_capacity": 20.0,
        "percentage": state.battery_percentage,
        "power_supply_status": 3 if state.battery_current < 0 else 2,
        "power_supply_health": 1,
        "power_supply_technology": 2,
        "present": True,
        "cell_voltage": [round(per_cell, 3)] * cells,
        "cell_temperature": [state.battery_temperature] * cells,
        "location": "base",
        "serial_number": f"{state.robot_id}-batt-001",
    }


def make_point_cloud(state, world) -> dict:
    """A sparse ring of lidar returns in the ``laser_link`` frame."""

    import math

    points: list[tuple[float, float, float, float]] = []
    rays = max(24, state.lidar_rays // 2)
    for index in range(rays):
        angle = state.pose.yaw + (2.0 * math.pi * index / rays)
        free_cells, hit, distance = world.raycast(
            state.pose.x, state.pose.y, angle, state.sensor_range_m
        )
        if hit is None:
            continue
        hx, hy = world.cell_center(*hit)
        dx = hx - state.pose.x
        dy = hy - state.pose.y
        cos_yaw = math.cos(state.pose.yaw)
        sin_yaw = math.sin(state.pose.yaw)
        local_x = cos_yaw * dx + sin_yaw * dy
        local_y = -sin_yaw * dx + cos_yaw * dy
        intensity = max(0.0, 1.0 - distance / max(state.sensor_range_m, 1e-6))
        points.append((local_x, local_y, 0.0, intensity))

    data: list[int] = []
    for x, y, z, intensity in points:
        data.extend(_float32_bytes(x))
        data.extend(_float32_bytes(y))
        data.extend(_float32_bytes(z))
        data.extend(_float32_bytes(intensity))

    return {
        "header": header(state.next_seq("point_cloud"), "laser_link"),
        "height": 1,
        "width": len(points),
        "fields": [
            {"name": "x", "offset": 0, "datatype": FLOAT32, "count": 1},
            {"name": "y", "offset": 4, "datatype": FLOAT32, "count": 1},
            {"name": "z", "offset": 8, "datatype": FLOAT32, "count": 1},
            {"name": "intensity", "offset": 12, "datatype": FLOAT32, "count": 1},
        ],
        "is_bigendian": False,
        "point_step": 16,
        "row_step": 16 * len(points),
        "data": data,
        "is_dense": True,
    }


def _float32_bytes(value: float) -> list[int]:
    import struct

    return list(struct.pack("<f", float(value)))


def make_compressed_image(state, depth: bool = False) -> dict:
    width, height = (160, 90) if depth else (320, 180)
    if depth:
        rgb = render_depth_rgb(state, width, height)
        frame_id = "camera_depth_optical_frame"
        key = "depth_image_compressed"
    else:
        rgb = render_camera_rgb(state, width, height)
        frame_id = "camera_optical_frame"
        key = "image_compressed"

    return {
        "header": header(state.next_seq(key), frame_id),
        "format": "png",
        "data": list(png_encode(width, height, rgb)),
    }


def make_wheel_encoder(state, side: str) -> int:
    return state.left_encoder if side == "left" else state.right_encoder
