"""Mirror of backend/amr_robot.py (imports adjusted for the fake tree).

One deviation: ``Robot.__init__`` declares ``(robot_id, port, host, ...)`` while
this class declares ``(robot_id, host, port, ...)``, and the real file forwards
them positionally — so the real ``Robot`` ends up with ``self.host`` set to the
port number and ``self.port`` set to the host string. It is invisible while the
dashboard sends both values (which it always does), but any call that relies on
the robot's configured address gets them the wrong way round. Here the two
values are forwarded by keyword.
"""

from ros_bridge.AMR.publisher_available import *
from ros_bridge.AMR.subscriber_available import *
from ros_bridge.AMR.service_client_available import *
from robot import Robot

class AMR (Robot):
    def __init__(self, robot_id: str, host: str, port: int):
        super().__init__(robot_id,
                         port=port,
                         host=host,
                         PublishableTopics=PublishableTopics,
                         PUBLISHABLE_TOPIC_MESSAGE_TYPES=PUBLISHABLE_TOPIC_MESSAGE_TYPES,
                         SubscribableTopics= SubscribableTopics,
                         SUBSCRIBABLE_TOPIC_MESSAGE_TYPES=SUBSCRIBABLE_TOPIC_MESSAGE_TYPES,
                         AVAILABLE_SERVICES=AvailableServices,
                         SERVICE_MESSAGE_TYPES= SERVICE_MESSAGE_TYPES)
