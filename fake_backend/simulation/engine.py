"""The simulated rosbridge.

``SimulationEngine`` owns one ``SimRobotState`` per robot and plays the role of
rosbridge itself: it periodically publishes the topics a real robot would
publish and hands each message to the callbacks registered by subscribers, in
exactly the way roslibpy delivers them (asynchronously, with the first delivery
arriving some time after ``subscribe()``).

It also routes ROS service calls to the simulation's service implementations.
"""

from __future__ import annotations

import asyncio
import time

from config import Settings, settings as global_settings
from ros_bridge.AMR.service_client_available import AvailableServices as AMRServices
from ros_bridge.go2.service_client_available import AvailableServices as GO2Services
from simulation.state import ON_DEMAND_TOPICS, STREAM_TOPICS, SimRobotState
from simulation.world import build_demo_world


#: enum member name -> ``SimRobotState`` method that implements it.
SERVICE_HANDLERS: dict[str, str] = {
    "start_mapping": "svc_start_mapping",
    "stop_mapping_and_save_map": "svc_stop_mapping",
    "load_map_by_name": "svc_load_map_by_name",
    "load_map": "svc_load_map_by_name",
    "delete_mapping": "svc_delete_mapping",
    "start_exploring": "svc_start_exploring",
    "stop_exploring": "svc_stop_exploring",
    "start_navigation": "svc_start_navigation",
    "start_navigation_with_map": "svc_start_navigation_with_map",
    "stop_navigation": "svc_stop_navigation",
    "webrtc_start": "svc_webrtc_start",
    "start_recording": "svc_start_recording",
    "stop_recording": "svc_stop_recording",
    "recording_status": "svc_recording_status",
    "delete_recording": "svc_delete_recording",
}

#: service name (as it appears on the ROS graph) -> state method name
SERVICE_BY_NAME: dict[str, str] = {}
for _enum in (AMRServices, GO2Services):
    for _member in _enum:
        _handler = SERVICE_HANDLERS.get(_member.name)
        if _handler:
            SERVICE_BY_NAME[_member.value] = _handler


def _topic_key(topic) -> str:
    """Topics arrive either as ``str`` enums (from Robot) or plain strings.

    ``str``-mixin enums hash by *member name*, so a dict keyed by the plain
    topic string would miss a member whose name differs from its value. Always
    normalise to the value.
    """

    return str(getattr(topic, "value", topic))


class SimulationEngine:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or global_settings
        self.world = build_demo_world(
            self.settings.map_resolution,
            self.settings.world_width_m,
            self.settings.world_height_m,
        )
        self.states: dict[str, SimRobotState] = {}
        self.connected: set[str] = set()
        self.subscribers: dict[tuple[str, str], list] = {}
        #: robot_id -> callback(status_value); lets the simulation report that a
        #: task finished ("run_task" -> "idle") back to the Robot object.
        self.status_listeners: dict[str, object] = {}
        self.ticks = 0
        self.started_at = time.time()
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    # ── lifecycle ───────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="simulation-engine")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except BaseException:  # shutdown is best effort
                pass
            self._task = None

    async def _run(self) -> None:
        interval = 1.0 / max(self.settings.tick_hz, 1.0)
        loop = asyncio.get_running_loop()
        next_tick = loop.time()

        while not self._stop.is_set():
            next_tick += interval
            self.tick_once(interval)
            delay = next_tick - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            else:
                # Fell behind: resynchronise instead of spinning.
                next_tick = loop.time()

    def tick_once(self, dt: float | None = None) -> None:
        """Advance every connected robot by ``dt`` seconds and publish."""

        dt = dt if dt is not None else 1.0 / max(self.settings.tick_hz, 1.0)
        self.ticks += 1

        for robot_id in list(self.connected):
            state = self.states.get(robot_id)
            if state is None:
                continue
            try:
                state.advance(dt)
                for topic, interval in STREAM_TOPICS.items():
                    if state.due(topic, interval):
                        self.publish_message(robot_id, topic)

                requested = state.take_pending_status()
                if requested is not None:
                    listener = self.status_listeners.get(robot_id)
                    if listener is not None:
                        listener(requested)
            except Exception as error:  # pragma: no cover - defensive
                print(f"[sim] tick failed for {robot_id}: {error!r}", flush=True)

    # ── robot registry ──────────────────────────────────────────────────────

    def kind_of(self, robot_id: str) -> str:
        entry = self.settings.robots.get(robot_id)
        return str(entry["kind"]) if entry else "AMR"

    def state_for(self, robot_id: str) -> SimRobotState:
        state = self.states.get(robot_id)
        if state is None:
            state = SimRobotState(
                robot_id=robot_id,
                kind=self.kind_of(robot_id),
                settings=self.settings,
                world=self.world,
            )
            self.states[robot_id] = state
        return state

    # ── connection ──────────────────────────────────────────────────────────

    def connect(self, robot_id: str, host: str, port: int) -> None:
        """Simulated rosbridge handshake (blocking, like roslibpy's Ros.run)."""

        host = str(host)
        port = int(port)
        unreachable = {item.lower() for item in self.settings.unreachable_hosts}
        if host.lower() in unreachable:
            raise ConnectionError(
                f"Failed to connect to ROS at {host}:{port} (simulated unreachable host)"
            )

        if self.settings.connect_latency_ms > 0:
            time.sleep(self.settings.connect_latency_ms / 1000.0)

        self.state_for(robot_id)
        self.connected.add(robot_id)
        # A fresh rosbridge connection starts with no latched messages and no
        # live subscriptions; the robot itself keeps whatever it was doing.
        state = self.states[robot_id]
        state.last_messages.clear()
        state.stop_motion()
        state.cmd_stamp = 0.0
        state.robot_status = "idle"

    def disconnect(self, robot_id: str) -> None:
        self.connected.discard(robot_id)
        self.subscribers = {
            key: value
            for key, value in self.subscribers.items()
            if key[0] != robot_id
        }
        self.status_listeners.pop(robot_id, None)
        state = self.states.get(robot_id)
        if state is not None:
            state.stop_motion()
            state.cmd_stamp = 0.0
            state.last_messages.clear()
            state.robot_status = "offline"

    def register_status_listener(self, robot_id: str, callback) -> None:
        self.status_listeners[robot_id] = callback

    def is_connected(self, robot_id: str) -> bool:
        return robot_id in self.connected

    def force_disconnect(self, robot_id: str) -> None:
        self.disconnect(robot_id)

    # ── pub/sub ─────────────────────────────────────────────────────────────

    def publish_message(self, robot_id: str, topic: str) -> dict | None:
        """Generate, latch and fan out one message (the rosbridge push)."""

        topic = _topic_key(topic)
        state = self.states.get(robot_id)
        if state is None:
            return None

        message = state.snapshot(topic)
        state.last_messages[topic] = message

        if message is not None:
            for callback in list(self.subscribers.get((robot_id, topic), [])):
                try:
                    callback(message)
                except Exception as error:  # pragma: no cover - defensive
                    print(f"[sim] subscriber error on {topic}: {error!r}", flush=True)

        return message

    def publish(self, robot_id: str, topic: str, message: dict) -> None:
        """Apply a message the dashboard published on a topic."""

        topic = _topic_key(topic)
        state = self.state_for(robot_id)
        state.apply_publish(topic, message)
        state.last_messages[topic] = message
        for callback in list(self.subscribers.get((robot_id, topic), [])):
            try:
                callback(message)
            except Exception:  # pragma: no cover - defensive
                pass

    def register_subscriber(self, robot_id: str, topic: str, callback) -> None:
        self.subscribers.setdefault((robot_id, _topic_key(topic)), []).append(callback)

    def unregister_subscriber(self, robot_id: str, topic: str, callback) -> None:
        key = (robot_id, _topic_key(topic))
        callbacks = self.subscribers.get(key)
        if not callbacks:
            return
        if callback in callbacks:
            callbacks.remove(callback)
        if not callbacks:
            self.subscribers.pop(key, None)

    def subscriber_count(self, robot_id: str, topic: str) -> int:
        return len(self.subscribers.get((robot_id, _topic_key(topic)), []))

    def last_message(self, robot_id: str, topic: str):
        state = self.states.get(robot_id)
        if state is None:
            return None
        return state.last_messages.get(_topic_key(topic))

    # ── services ────────────────────────────────────────────────────────────

    def call_service(
        self, robot_id: str, service_name: str, service_type: str, request: dict | None
    ) -> dict:
        if self.settings.service_latency_ms > 0:
            time.sleep(self.settings.service_latency_ms / 1000.0)

        name = str(getattr(service_name, "value", service_name))
        handler = SERVICE_BY_NAME.get(name)
        if handler is None:
            return {
                "success": False,
                "message": f"no service server for '{name}' ({service_type})",
            }

        state = self.state_for(robot_id)
        response = state.handle_service(handler, dict(request or {}))
        if not isinstance(response, dict):
            response = {"success": True, "message": str(response)}
        response.setdefault("service", name)
        return response

    # ── introspection / housekeeping ────────────────────────────────────────

    def telemetry_for(self, robot_id: str, topic: str):
        return self.state_for(robot_id).snapshot(topic)

    def reset(self, robot_id: str | None = None) -> None:
        ids = [robot_id] if robot_id else list(self.states)
        for current in ids:
            was_connected = current in self.connected
            state = self.states.get(current)
            if state is not None:
                state.reset()
                state.robot_status = "idle" if was_connected else "offline"
            self.subscribers = {
                key: value
                for key, value in self.subscribers.items()
                if key[0] != current
            }

    def info(self) -> dict:
        return {
            "running": self._task is not None and not self._task.done(),
            "ticks": self.ticks,
            "tick_hz": self.settings.tick_hz,
            "uptime_s": round(time.time() - self.started_at, 1),
            "connected": sorted(self.connected),
            "robots": sorted(self.states),
            "world": {
                "width": self.world.width,
                "height": self.world.height,
                "resolution": self.world.resolution,
                "origin": list(self.world.origin),
            },
            "stream_topics": STREAM_TOPICS,
            "on_demand_topics": list(ON_DEMAND_TOPICS),
            "subscribers": {
                f"{robot_id}/{topic}": len(callbacks)
                for (robot_id, topic), callbacks in self.subscribers.items()
            },
        }


_engine: SimulationEngine | None = None


def get_engine() -> SimulationEngine:
    global _engine
    if _engine is None:
        _engine = SimulationEngine()
    return _engine
