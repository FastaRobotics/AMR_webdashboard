from ros_bridge.go2.publisher_available import *
from ros_bridge.go2.subscriber_available import *
from robot import Robot


class Go2 (Robot):
    def __init__(self, robot_id: str, port: int):
        super().__init__(robot_id, port,
                         PublishableTopics=PublishableTopics,
                         PUBLISHABLE_TOPIC_MESSAGE_TYPES=PUBLISHABLE_TOPIC_MESSAGE_TYPES, 
                         SubscribableTopics= SubscribableTopics,
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES)