from ros_bridge.go2.publisher_available import *
from ros_bridge.go2.subscriber_available import *
from ros_bridge.go2.service_client_available import *

from robot import Robot


class Go2 (Robot):
    def __init__(self, robot_id: str, host: str, port: int):
        super().__init__(robot_id, port=port, host=host,
                         PublishableTopics=PublishableTopics,
                         PUBLISHABLE_TOPIC_MESSAGE_TYPES=PUBLISHABLE_TOPIC_MESSAGE_TYPES, 
                         SubscribableTopics= SubscribableTopics,
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES,
                         AVAILABLE_SERVICES=AvailableServices,
                         SERVICE_MESSAGE_TYPES= SERVICE_MESSAGE_TYPES)