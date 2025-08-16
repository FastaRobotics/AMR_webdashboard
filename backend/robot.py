from enum import Enum
from roslibpy import Ros
from ros_bridge.publisher import RosPublisher
from ros_bridge.subscriber import RosSubscriber
from ros_process_manager import RosProcessManager

class RobotStatus(Enum):
    OFFLINE = "offline"
    IDLE = "idle"
    RUN_TASK = "run_task"

class Robot:
    def __init__(self, robot_id: str, port: int, PublishableTopics,  PUBLISHABLE_TOPIC_MESSAGE_TYPES,  SubscribableTopics, SUBSCRIBABLE_TOPIC_MESSAGE_TYPES):
        self.robot_id = robot_id
        self.host = "localhost"
        self.port = port
        self.status = RobotStatus.OFFLINE
        self.ros: Ros | None = None
        self.ros_processor = RosProcessManager()
        self.publishers = {}
        self.subscribers = {}
        self.PublishableTopics = PublishableTopics
        self.SubscribableTopics = SubscribableTopics
        self.PUBLISHABLE_TOPIC_MESSAGE_TYPES = PUBLISHABLE_TOPIC_MESSAGE_TYPES
        self.SUBSCRIBABLE_TOPIC_MESSAGE_TYPES = SUBSCRIBABLE_TOPIC_MESSAGE_TYPES

    # --------------------
    # Connection Management
    # --------------------
    def connect(self):
        if self.ros and self.ros.is_connected:
            self.disconnect()

        self.ros = Ros(host=self.host, port=self.port)
        self.ros.run()

        if not self.ros.is_connected:
            self.ros = None
            self.status = RobotStatus.OFFLINE
            raise ConnectionError(f"[{self.robot_id}] Failed to connect to ROS at {self.host}:{self.port}")
        else:
            self.status = RobotStatus.IDLE
            print(f"[{self.robot_id}] Connected to ROS at {self.host}:{self.port}")

    def disconnect(self):
        if self.ros and self.ros.is_connected:
            self.ros.close()
        self.ros = None
        self.status = RobotStatus.OFFLINE
        print(f"[{self.robot_id}] Disconnected.")

    def is_connected(self) -> bool:
        if self.ros is None or not self.ros.is_connected:
            self.status = RobotStatus.OFFLINE
        return self.status != RobotStatus.OFFLINE

    # --------------------
    # Publisher Methods
    # --------------------
    def publish(self, topic: str, message: dict, msg_type: str = None):
        if not self.is_connected():
            self.status = RobotStatus.OFFLINE
            raise RuntimeError(f"[{self.robot_id}] Cannot publish: Not connected.")

        msg_type = msg_type or self.PUBLISHABLE_TOPIC_MESSAGE_TYPES.get(topic)
        if topic not in self.publishers:
            self.publishers[topic] = RosPublisher(ros=self.ros, topic_name=topic, message_type=msg_type)

        self.publishers[topic].publish_once(message)
        self.publishers[topic].close()
        print(f"[{self.robot_id}] Published to {topic}: {message}")

    def publish_string(self, topic: str, data: str):
        self.publish(topic, {"data": data}, "std_msgs/String")

    def publish_twist(self, topic: str, linear: dict, angular: dict):
        self.publish(self, {"linear": linear, "angular": angular}, "geometry_msgs/Twist")

    def publish_pose(self, topic: str, position: dict, orientation: dict):
        self.publish(topic, {"position": position, "orientation": orientation}, "geometry_msgs/Pose")

    def publish_goal_pose(self, topic: str, header: dict, pose: dict):
        message = {"header": header, "pose": pose}
        self.publish(topic, message, "geometry_msgs/PoseStamped")

    # --------------------
    # Subscriber Methods
    # --------------------
    def subscribe(self, topic: str, msg_type: str = None):
        if not self.is_connected():
            raise RuntimeError(f"[{self.robot_id}] Cannot subscribe: Not connected.")

        msg_type = msg_type or self.SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic)
        if topic not in self.subscribers:
            subscriber = RosSubscriber(ros=self.ros, topic_name=topic, message_type=msg_type)
            subscriber.subscribe()
            self.subscribers[topic] = subscriber
        print(f"[{self.robot_id}] Subscribed to {topic}")

    def get_last_message(self, topic: str):
        if topic not in self.subscribers:
            raise KeyError(f"[{self.robot_id}] Not subscribed to {topic}")
        return self.subscribers[topic].get_last_message()

    def subscribe_odom(self, topic: str):
        self.subscribe(topic, "nav_msgs/Odometry")
        return self.get_last_message(topic)

    def subscribe_tf(self, topic: str):
        self.subscribe(topic, "tf2_msgs/TFMessage")
        return self.get_last_message(topic)

    # --------------------
    # Task Control
    # --------------------
    def start_mapping(self):
        self.ros_processor.start_mapping()
        self.status = RobotStatus.RUN_TASK
        print(f"[{self.robot_id}] Mapping started.")

    def stop_mapping(self):
        self.ros_processor.stop_mapping()
        self.status = RobotStatus.IDLE
        print(f"[{self.robot_id}] Mapping stopped.")

    def start_navigation(self):
        self.ros_processor.start_navigation()
        self.status = RobotStatus.RUN_TASK
        print(f"[{self.robot_id}] Navigation started.")

    def stop_navigation(self):
        self.ros_processor.stop_navigation()
        self.status = RobotStatus.IDLE
        print(f"[{self.robot_id}] Navigation stopped.")

    # --------------------
    # Status
    # --------------------
    def get_status(self):
        ros_status = self.ros_processor.status()
        ros_status["connection"] = self.is_connected()
        ros_status["robot_status"] = self.status.value
        return ros_status
    
    
