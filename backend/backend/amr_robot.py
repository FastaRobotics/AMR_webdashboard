import os
import subprocess
from enum import IntEnum
from pathlib import Path

from ros_bridge.AMR.publisher_available import *
from ros_bridge.AMR.subscriber_available import *
from ros_bridge.AMR.service_client_available import *
from ros_bridge.service_client import RosServiceClient
from robot import Robot, RobotStatus


class LifecycleCommand(IntEnum):
    STARTUP = 0
    PAUSE = 1
    RESUME = 2
    RESET = 3
    SHUTDOWN = 4


NAV2_SERVICE_TYPES = {
    "/map_server/load_map": "nav2_msgs/srv/LoadMap",
    "/lifecycle_manager_navigation/manage_nodes": "nav2_msgs/srv/ManageLifecycleNodes",
    "/lifecycle_manager_amcl/manage_nodes": "nav2_msgs/srv/ManageLifecycleNodes",
    "/lifecycle_manager_localization/manage_nodes": "nav2_msgs/srv/ManageLifecycleNodes",
}

NAV2_LIFECYCLE_MANAGERS = (
    "/lifecycle_manager_amcl/manage_nodes",
    "/lifecycle_manager_localization/manage_nodes",
    "/lifecycle_manager_navigation/manage_nodes",
)

DEFAULT_INITIAL_POSE_COVARIANCE = [
    0.25, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.25, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.06853891909122467,
]


class AMR(Robot):
    def __init__(self, robot_id: str, host: str, port: int):
        super().__init__(
            robot_id,
            port=port,
            host=host,
            PublishableTopics=PublishableTopics,
            PUBLISHABLE_TOPIC_MESSAGE_TYPES=PUBLISHABLE_TOPIC_MESSAGE_TYPES,
            SubscribableTopics=SubscribableTopics,
            SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES,
            AVAILABLE_SERVICES=AvailableServices,
            SERVICE_MESSAGE_TYPES=SERVICE_MESSAGE_TYPES,
        )

    def _has_fasta_navigation_services(self) -> bool:
        if not self.ros:
            return False
        return self.AVAILABLE_SERVICES.start_navigation_with_map.value in self.ros.get_services()

    def _call_nav2(self, service_name: str, request: dict) -> dict:
        if not self.ensure_connected():
            raise RuntimeError(f"[{self.robot_id}] Cannot call service: Not connected.")

        service_type = NAV2_SERVICE_TYPES.get(service_name)
        if not service_type:
            raise ValueError(f"[{self.robot_id}] Unknown Nav2 service {service_name}")

        if service_name not in self.services:
            self.services[service_name] = RosServiceClient(
                ros=self.ros,
                service_name=service_name,
                service_type=service_type,
            )

        response = self.services[service_name].call(request)
        try:
            return dict(response)
        except Exception:
            return response

    def _manage_nav2_lifecycle(self, command: LifecycleCommand) -> dict:
        results = {}
        available = set(self.ros.get_services()) if self.ros else set()
        for service_name in NAV2_LIFECYCLE_MANAGERS:
            if service_name not in available:
                continue
            try:
                results[service_name] = self._call_nav2(service_name, {"command": int(command)})
            except Exception as exc:
                results[service_name] = {"success": False, "error": str(exc)}
        return results

    def _resolve_map_url(self, map_name: str) -> str:
        if map_name.endswith(".yaml") and os.path.isabs(map_name):
            return map_name

        maps_dir = os.getenv("AMR_MAPS_DIR")
        if maps_dir:
            maps_path = Path(maps_dir)
            if map_name == "latest":
                default_map = os.getenv("AMR_DEFAULT_MAP")
                if default_map:
                    return default_map
                yaml_files = sorted(
                    maps_path.glob("*.yaml"),
                    key=lambda path: path.stat().st_mtime,
                    reverse=True,
                )
                if yaml_files:
                    return str(yaml_files[0])
            else:
                candidate = maps_path / f"{map_name}.yaml"
                if candidate.exists():
                    return str(candidate)

        if map_name == "latest":
            map_server_yaml = self._get_map_server_yaml()
            if map_server_yaml:
                return map_server_yaml

        if map_name.endswith(".yaml"):
            return map_name

        raise FileNotFoundError(
            f"[{self.robot_id}] Could not resolve map '{map_name}'. "
            "Set AMR_MAPS_DIR or AMR_DEFAULT_MAP, or pass an absolute .yaml path."
        )

    @staticmethod
    def _get_map_server_yaml() -> str | None:
        try:
            result = subprocess.run(
                ["ros2", "param", "get", "/map_server", "yaml_filename"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if result.returncode == 0 and ": " in result.stdout:
                return result.stdout.strip().split(": ", 1)[1]
        except Exception:
            return None
        return None

    def _publish_initial_pose(self, request: dict) -> dict:
        position = request.get("pose_hint_position_xyz", [0.0, 0.0, 0.0])
        orientation = request.get("pose_hint_orientation_xyzw", [0.0, 0.0, 0.0, 1.0])
        message = {
            "header": {"frame_id": "map", "stamp": {"sec": 0, "nanosec": 0}},
            "pose": {
                "pose": {
                    "position": {"x": position[0], "y": position[1], "z": position[2]},
                    "orientation": {
                        "x": orientation[0],
                        "y": orientation[1],
                        "z": orientation[2],
                        "w": orientation[3],
                    },
                },
                "covariance": DEFAULT_INITIAL_POSE_COVARIANCE,
            },
        }
        return self.publish(PublishableTopics.initialpose, message)

    @staticmethod
    def _compact_load_map_response(response: dict) -> dict:
        compact = dict(response)
        if "map" in compact:
            compact["map"] = "<loaded>"
        return compact

    def _publish_goal_pose(self, request: dict) -> dict:
        position = request.get("pose_hint_position_xyz", [0.0, 0.0, 0.0])
        orientation = request.get("pose_hint_orientation_xyzw", [0.0, 0.0, 0.0, 1.0])
        header = {"frame_id": "map", "stamp": {"sec": 0, "nanosec": 0}}
        pose = {
            "position": {"x": position[0], "y": position[1], "z": position[2]},
            "orientation": {
                "x": orientation[0],
                "y": orientation[1],
                "z": orientation[2],
                "w": orientation[3],
            },
        }
        return self.publish_goal_pose(header, pose)

    def _start_navigation_with_map_nav2(self, request: dict) -> dict:
        map_url = self._resolve_map_url(request.get("map_name", "latest"))
        load_response = self._compact_load_map_response(
            self._call_nav2("/map_server/load_map", {"map_url": map_url})
        )

        lifecycle_response = self._manage_nav2_lifecycle(LifecycleCommand.STARTUP)

        goal_pose_response = self._publish_goal_pose(request)

        self.status = RobotStatus.RUN_TASK
        return {
            "backend": "nav2",
            "map_url": map_url,
            "load_map": load_response,
            "lifecycle": lifecycle_response,
            "goal_pose": goal_pose_response,
        }

    def _start_navigation_nav2(self) -> dict:
        lifecycle_response = self._manage_nav2_lifecycle(LifecycleCommand.STARTUP)
        self.status = RobotStatus.RUN_TASK
        return {"backend": "nav2", "lifecycle": lifecycle_response}

    def _stop_navigation_nav2(self) -> dict:
        lifecycle_response = self._manage_nav2_lifecycle(LifecycleCommand.SHUTDOWN)
        self.status = RobotStatus.IDLE
        return {"backend": "nav2", "lifecycle": lifecycle_response}

    def start_navigation(self):
        if self._has_fasta_navigation_services():
            return super().start_navigation()
        return self._start_navigation_nav2()

    def start_navigation_with_map(self, request: dict):
        if self._has_fasta_navigation_services():
            return super().start_navigation_with_map(request)
        return self._start_navigation_with_map_nav2(request)

    def stop_navigation(self):
        if self._has_fasta_navigation_services():
            return super().stop_navigation()
        return self._stop_navigation_nav2()
