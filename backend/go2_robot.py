from ros_bridge.go2.publisher_available import TOPIC_MESSAGE_TYPES
from ros_bridge.go2.subscriber_available import SUBSCRIBABLE_TOPIC_MESSAGE_TYPES
from robot import Robot


class Go2 (Robot):
    def __init__(self, robot_id: str, port: int):
        super().__init__(robot_id, port,
                         TOPIC_MESSAGE_TYPES=TOPIC_MESSAGE_TYPES, 
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES)