"""Mirror of backend/robot.py, wired to the simulation.

The class surface is unchanged (`connect`, `disconnect`, `publish_*`,
`subscribe_*`, `start_mapping`, `call`, ...) so the routers read exactly like the
real ones. The differences are deliberate and listed in README.md
("Deviations from the real backend"):

* ``Ros`` is ``sim_roslibpy.Ros``, which talks to the simulation instead of a
  rosbridge server, and receives ``robot_id`` so the simulation knows which
  robot it is talking about;
* ``ros.is_connected`` is read as the property roslibpy actually defines, so
  ``get_connection_status()`` returns a real answer instead of raising
  ``TypeError``;
* a task's status only flips when the service call reports success;
* a service that a robot does not expose raises a readable error;
* ``host="0.0.0.0"`` (the endpoint default) means "use the robot's configured
  address" rather than "connect to the wildcard address".
"""

from enum import Enum
import time

from sim_roslibpy import Ros
from sim_logging import log
from ros_bridge.publisher import RosPublisher
from ros_bridge.subscriber import RosSubscriber
from ros_bridge.service_client import RosServiceClient
from simulation.engine import get_engine

import base64
import io


class RobotStatus(Enum):
    OFFLINE = "offline"
    IDLE = "idle"
    RUN_TASK = "run_task"


class ServiceNotAvailable(RuntimeError):
    """Raised when a robot has no such service in its ``AvailableServices``."""


def _succeeded(response) -> bool:
    """Services report success in a ``success`` field; assume true if absent."""

    if isinstance(response, dict):
        return bool(response.get("success", True))
    return True


class Robot:
    def __init__(self,
                 robot_id: str,
                 port: int,
                 host: str,
                 PublishableTopics,
                 PUBLISHABLE_TOPIC_MESSAGE_TYPES,
                 SubscribableTopics,
                 SUBSCRIBABLE_TOPIC_MESSAGE_TYPES,
                 AVAILABLE_SERVICES,
                 SERVICE_MESSAGE_TYPES):
        self.robot_id = robot_id
        self.host = host
        self.port = port
        self.status = RobotStatus.OFFLINE
        self.ros: Ros | None = None
        self.publishers = {}
        self.subscribers = {}
        self.PublishableTopics = PublishableTopics
        self.SubscribableTopics = SubscribableTopics
        self.PUBLISHABLE_TOPIC_MESSAGE_TYPES = PUBLISHABLE_TOPIC_MESSAGE_TYPES
        self.services = {}
        self.SUBSCRIBABLE_TOPIC_MESSAGE_TYPES = SUBSCRIBABLE_TOPIC_MESSAGE_TYPES
        self.AVAILABLE_SERVICES = AVAILABLE_SERVICES
        self.SERVICE_MESSAGE_TYPES = SERVICE_MESSAGE_TYPES
        #: Last address actually handed to the simulated rosbridge.
        self.connected_host: str | None = None
        self.connected_port: int | None = None

    # --------------------
    # Connection Management
    # --------------------
    def connect(self, host: str = None, port: int = None):
        if self.ros and self.ros.is_connected:
            self.disconnect()

        # "0.0.0.0" is the endpoint's placeholder default, not a real address:
        # treat it as "use the robot's configured address".
        requested_host = (host or "").strip()
        if requested_host in ("", "0.0.0.0", "::", "localhost"):
            requested_host = self.host
        requested_port = int(port) if port else self.port

        self.ros = Ros(host=requested_host, port=requested_port, robot_id=self.robot_id)
        self.ros.run()

        if not self.ros.is_connected:
            self.ros = None
            self.status = RobotStatus.OFFLINE
            self._sync_status()
            raise ConnectionError(
                f"[{self.robot_id}] Failed to connect to ROS at {requested_host}:{requested_port}"
            )

        self.status = RobotStatus.IDLE
        self.connected_host = requested_host
        self.connected_port = requested_port
        self._sync_status()
        # Let the simulation report a task that ended on its own (goal reached,
        # exploration complete) so the dashboard badge does not stay "run_task".
        get_engine().register_status_listener(self.robot_id, self._apply_status_value)
        log(f"[{self.robot_id}] Connected to ROS at {requested_host}:{requested_port}")

    def disconnect(self):
        if self.ros and self.ros.is_connected:
            self.ros.close()
        self.ros = None
        self.status = RobotStatus.OFFLINE
        self.subscribers.clear()
        self.publishers.clear()
        self.services.clear()
        self._sync_status()
        log(f"[{self.robot_id}] Disconnected.")

    def is_connected(self) -> bool:
        if self.ros is None or not self.ros.is_connected:
            self.status = RobotStatus.OFFLINE
            self._sync_status()
        return self.status != RobotStatus.OFFLINE

    def set_status(self, status: RobotStatus) -> None:
        self.status = status
        self._sync_status()

    def _apply_status_value(self, value: str) -> None:
        """Callback used by the simulation when a task ends on its own."""

        try:
            self.set_status(RobotStatus(value))
        except ValueError:  # pragma: no cover - defensive
            pass

    def _sync_status(self) -> None:
        """Keep the simulation's copy of the status in step (for /sim)."""

        try:
            get_engine().state_for(self.robot_id).robot_status = self.status.value
        except Exception:  # pragma: no cover - never break a robot call for this
            pass

    # --------------------
    # Publisher Methods
    # --------------------
    def publish(self, topic: str, message: dict):
        if not self.is_connected():
            self.status = RobotStatus.OFFLINE
            raise RuntimeError(f"[{self.robot_id}] Cannot publish: Not connected.")

        msg_type = self.PUBLISHABLE_TOPIC_MESSAGE_TYPES[topic]

        if topic not in self.publishers:
            self.publishers[topic] = RosPublisher(ros=self.ros, topic_name=topic, message_type=msg_type)

        self.publishers[topic].publish_once(message)
        self.publishers[topic].close()
        log(f"[{self.robot_id}] Published to {topic}: {message}")
        return {"status": "published", "topic": topic, "message": message}

    def publish_string(self, data: str):
        topic = self.PublishableTopics.chatter
        self.publish(topic, {"data": data})

    def publish_twist(self, linear: dict, angular: dict):
        topic = self.PublishableTopics.cmd_vel
        self.publish(topic , {"linear": linear, "angular": angular})

    def publish_pose(self, position: dict, orientation: dict):
        topic = self.PublishableTopics.point
        self.publish(topic, {"position": position, "orientation": orientation})

    def publish_goal_pose(self, header: dict, pose: dict):
        topic = self.PublishableTopics.goal_pose
        self.publish(topic, {"header": header, "pose": pose})

    def publish_emergency_stop(self, emergency_stop: bool):
        topic = self.PublishableTopics.emergency_stop
        response = self.publish(topic, {"data": emergency_stop})
        return response

    # --------------------
    # Subscriber Methods
    # --------------------
    def subscribe(self, topic: str):
        if not self.is_connected():
            raise RuntimeError(f"[{self.robot_id}] Cannot subscribe: Not connected.")

        msg_type = self.SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic)

        if topic not in self.subscribers:
            subscriber = RosSubscriber(ros=self.ros, topic_name=topic, message_type=msg_type)
            subscriber.subscribe()
            self.subscribers[topic] = subscriber
            # The real backend logs this on every call, i.e. ten times a second
            # per streaming socket; here it reports the actual subscription.
            log(f"[{self.robot_id}] Subscribed to {topic}")

    def get_last_message(self, topic: str):
        if topic not in self.subscribers:
            raise KeyError(f"[{self.robot_id}] Not subscribed to {topic}")
        return self.subscribers[topic].get_last_message()

    def supports_topic(self, topic: str) -> bool:
        """Whether this robot's topic enum contains ``topic``.

        For ``go2_1`` this is False for ``map``, ``diagnostics`` and ``path``,
        which the streaming WebSocket reports as a clean error instead of
        crashing on a missing enum member.
        """

        return topic in {member.value for member in self.SubscribableTopics}

    def release_subscription(self, topic: str) -> None:
        """Drop a subscription created by ``subscribe`` (used by the sockets).

        The real backend keeps one subscription per topic per robot and never
        releases it; the fake backend unsubscribes when the last client leaves so
        a dashboard that opens and closes pages does not accumulate subscribers.
        """

        try:
            member = getattr(self.SubscribableTopics, topic)
        except AttributeError:
            return
        subscriber = self.subscribers.pop(member, None)
        if subscriber is not None:
            subscriber.unsubscribe()

    def subscription_count(self) -> int:
        return len(self.subscribers)

    def subscribe_odom(self):
        topic = self.SubscribableTopics.odom
        self.subscribe(topic)
        return self.get_last_message(topic)

    def subscribe_tf(self):
        topic = self.SubscribableTopics.tf
        self.subscribe(topic)
        return self.get_last_message(topic)

    def subscribe_map(self):
        topic = self.SubscribableTopics.map
        self.subscribe(topic)
        return self.get_last_message(topic)

    def subscribe_diagnostics(self):
        topic = self.SubscribableTopics.diagnostics
        self.subscribe(topic)
        return self.get_last_message(topic)

    def subscribe_path(self):
        topic = self.SubscribableTopics.path
        self.subscribe(topic)
        return self.get_last_message(topic)

    # --------------------
    # Task Control
    # --------------------
    def call(self, service: str, request: dict):
        if not self.is_connected():
            raise RuntimeError(f"[{self.robot_id}] Cannot call service: Not connected.")

        if service not in self.services:
            srv_type = self.SERVICE_MESSAGE_TYPES.get(service)
            if not srv_type:
                raise ValueError(f"[{self.robot_id}] Service {service} not found in SERVICE_MESSAGE_TYPES.")
            self.services[service] = RosServiceClient(ros=self.ros, service_name=service, service_type=srv_type)

        response = self.services[service].call(request)
        log(f"[{self.robot_id}] Called service {service} with request {request}, got response {response}")
        try:
            return dict(response)
        except Exception:
            return response

    def _service(self, attribute: str) -> str:
        """Resolve an ``AvailableServices`` member, with a readable error."""

        try:
            return getattr(self.AVAILABLE_SERVICES, attribute)
        except AttributeError:
            raise ServiceNotAvailable(
                f"[{self.robot_id}] service '{attribute}' is not available on this robot"
            )

    def start_mapping(self):
        service = self._service("start_mapping")
        response = self.call(service, {})
        if _succeeded(response):
            self.set_status(RobotStatus.RUN_TASK)
        return response

    def stop_mapping(self, request: dict = {}):
        service = self._service("stop_mapping_and_save_map")
        response = self.call(service, request)
        if _succeeded(response):
            self.set_status(RobotStatus.IDLE)
        return response

    def start_exploring(self):
        service = self._service("start_exploring")
        response = self.call(service, {})
        if _succeeded(response):
            self.set_status(RobotStatus.RUN_TASK)
        return response

    def stop_exploring(self):
        service = self._service("stop_exploring")
        response = self.call(service, {})
        if _succeeded(response):
            self.set_status(RobotStatus.IDLE)
        return response

    def emergency_stop(self):
        self.publish_emergency_stop(True)
        return {"status": "Emergency stop activated"}

    def start_navigation(self):
        service = self._service("start_navigation")
        response = self.call(service, {})
        if _succeeded(response):
            # The real backend marks a bare start_navigation as IDLE even though
            # a navigation task has just begun; here it reports run_task.
            self.set_status(RobotStatus.RUN_TASK)
        return response

    def start_navigation_with_map(self, request: dict):
        service = self._service("start_navigation_with_map")
        response = self.call(service, request)
        if _succeeded(response):
            self.set_status(RobotStatus.RUN_TASK)
        return response

    def stop_navigation(self):
        service = self._service("stop_navigation")
        response = self.call(service, {})
        if _succeeded(response):
            self.set_status(RobotStatus.IDLE)
        return response

    def start_recording(self, rosbag_name: str):
        service = self._service("start_recording")
        request = {"log_file_name": rosbag_name}
        response = self.call(service, request)
        if _succeeded(response):
            self.set_status(RobotStatus.RUN_TASK)
        return response

    def stop_recording(self):
        service = self._service("stop_recording")
        response = self.call(service, {})
        if _succeeded(response):
            self.set_status(RobotStatus.IDLE)
        return response

    def recording_status(self):
        service = self._service("recording_status")
        response = self.call(service, {})
        # The real backend does `response["message"] = response["message"].split(" ")[0]`,
        # which truncates the robot's answer; the fake returns it intact.
        return response

    def delete_recording(self, rosbag_name: str):
        service = self._service("delete_recording")
        request = {"log_file_name": rosbag_name}
        response = self.call(service, request)
        return response

    # --------------------
    # Status
    # --------------------
    def get_connection_status(self):
        """Same response shape as the real backend, minus the crash.

        The real implementation calls ``self.ros.is_connected()`` although
        roslibpy defines ``is_connected`` as a property, so every status request
        for a robot that has ever connected fails with a 500.
        """

        ros_status = {}
        ros_status["connection"] = bool(self.ros.is_connected) if self.ros else False
        return ros_status
