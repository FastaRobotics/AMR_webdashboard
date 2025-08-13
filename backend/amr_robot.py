from ros_bridge.AMR.publisher_available import TOPIC_MESSAGE_TYPES
from ros_bridge.AMR.subscriber_available import SUBSCRIBABLE_TOPIC_MESSAGE_TYPES
from robot import Robot

class AMR (Robot):
    def __init__(self, robot_id: str, port: int):
        super().__init__(robot_id, 
                         port,TOPIC_MESSAGE_TYPES=TOPIC_MESSAGE_TYPES, 
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES)