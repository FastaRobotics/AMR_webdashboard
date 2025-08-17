from ros_bridge.AMR.publisher_available import *
from ros_bridge.AMR.subscriber_available import *
from ros_bridge.AMR.service_client_available import *
from robot import Robot

class AMR (Robot):
    def __init__(self, robot_id: str, port: int):
        super().__init__(robot_id, 
                         port,
                         PublishableTopics=PublishableTopics,
                         PUBLISHABLE_TOPIC_MESSAGE_TYPES=PUBLISHABLE_TOPIC_MESSAGE_TYPES, 
                         SubscribableTopics= SubscribableTopics,
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES,
                         AVAILABLE_SERVICES=AVAILABLE_SERVICES,
                         SERVICE_MESSAGE_TYPES= SERVICE_MESSAGE_TYPES)