from ros_bridge.go2.publisher_available import PUBLISHABLE_TOPIC_MESSAGE_TYPES
from ros_bridge.go2.subscriber_available import SUBSCRIBABLE_TOPIC_MESSAGE_TYPES
from robot import Robot


class Go2 (Robot):
    def __init__(self, robot_id: str, port: int):
        super().__init__(robot_id, port,
                         PUBLISHABLE_TOPIC_MESSAGE_TYPES=PUBLISHABLE_TOPIC_MESSAGE_TYPES, 
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES
                         )