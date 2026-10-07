"""A stand-in for the parts of ``roslibpy`` the backend uses.

``backend/robot.py`` and ``backend/ros_bridge/*.py`` talk to roslibpy through a
handful of objects — ``Ros``, ``Topic``, ``Message``, ``Service``,
``ServiceRequest``. This module implements the same surface against the
simulation engine instead of a real rosbridge server, so those files can be
copied almost verbatim.

The only wiring change is that ``Robot`` passes its ``robot_id`` when creating
``Ros``, because there is no real network address to identify the robot by.
"""

from __future__ import annotations

from simulation.engine import get_engine


class Message(dict):
    """``roslibpy.Message`` is a plain ``dict`` subclass."""


class ServiceRequest(dict):
    """``roslibpy.ServiceRequest`` is a plain ``dict`` subclass."""


def _resolve_robot_id(host: str, port: int) -> str:
    """Best-effort robot lookup for code that does not pass ``robot_id``."""

    from config import settings

    for robot_id, entry in settings.robots.items():
        if int(entry["port"]) == int(port) or str(entry["host"]) == host:
            return robot_id
    # Unknown address: give it an id of its own so it still gets a simulated
    # robot to talk to instead of silently sharing another robot's state.
    return f"{host}:{port}"


class Ros:
    """Minimal rosbridge client, backed by the simulation."""

    def __init__(
        self,
        host: str = "localhost",
        port: int = 9090,
        robot_id: str | None = None,
        **kwargs,
    ) -> None:
        self.host = host
        self.port = port
        self.robot_id = robot_id or _resolve_robot_id(host, port)
        self.kwargs = kwargs
        self._running = False

    # ── connection ──────────────────────────────────────────────────────────

    def run(self) -> None:
        """Block until "connected" — the simulation handshake is instant."""

        get_engine().connect(self.robot_id, self.host, self.port)
        self._running = True

    @property
    def is_connected(self) -> bool:
        return get_engine().is_connected(self.robot_id)

    @property
    def is_connecting(self) -> bool:
        return False

    def close(self) -> None:
        get_engine().disconnect(self.robot_id)
        self._running = False

    # ── introspection ───────────────────────────────────────────────────────

    def get_topics(self) -> list[str]:
        from simulation.state import ON_DEMAND_TOPICS, STREAM_TOPICS

        return sorted(set(STREAM_TOPICS) | set(ON_DEMAND_TOPICS))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<SimRos {self.robot_id} ws://{self.host}:{self.port}>"


class Topic:
    """Publisher/subscriber pair, like ``roslibpy.Topic``."""

    def __init__(self, ros: Ros, name: str, message_type: str | None = None) -> None:
        self.ros = ros
        self.name = name
        self.message_type = message_type
        self._advertised = False
        self._callbacks: list = []

    # publisher side
    def advertise(self) -> None:
        self._advertised = True

    def unadvertise(self) -> None:
        self._advertised = False

    def publish(self, message) -> None:
        payload = dict(message) if message is not None else {}
        get_engine().publish(self.ros.robot_id, self.name, payload)

    # subscriber side
    def subscribe(self, callback) -> None:
        self._callbacks.append(callback)
        get_engine().register_subscriber(self.ros.robot_id, self.name, callback)

    def unsubscribe(self) -> None:
        for callback in list(self._callbacks):
            get_engine().unregister_subscriber(self.ros.robot_id, self.name, callback)
        self._callbacks.clear()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<SimTopic {self.name} {self.message_type}>"


class Service:
    """Service client, like ``roslibpy.Service``."""

    def __init__(self, ros: Ros, name: str, service_type: str | None = None) -> None:
        self.ros = ros
        self.name = name
        self.service_type = service_type

    def call(self, request=None):
        payload = dict(request) if request else {}
        return get_engine().call_service(
            self.ros.robot_id, self.name, self.service_type or "", payload
        )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<SimService {self.name} {self.service_type}>"


__all__ = ["Message", "Ros", "Service", "ServiceRequest", "Topic"]
