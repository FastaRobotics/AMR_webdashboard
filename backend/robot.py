from enum import Enum
import time 
from roslibpy import Ros
from ros_bridge.publisher import RosPublisher
from ros_bridge.subscriber import RosSubscriber
from ros_bridge.service_client import RosServiceClient

import base64
import io


class RobotStatus(Enum):
    OFFLINE = "offline"
    IDLE = "idle"
    RUN_TASK = "run_task"


class Robot:
    def __init__(self,
                 robot_id: str,
                 port: int,
                 host: str,
                 PublishableTopics,  
                 PUBLISHABLE_TOPIC_MESSAGE_TYPES,  
                 SubscribableTopics, 
                 SUBSCRIBABLE_TOPIC_MESSAGE_TYPES,
                 AVAILABLE_SERVICES,
                 SERVICE_MESSAGE_TYPES):
        self.robot_id = robot_id
        self.host = host
        self.port = port
        self.status = RobotStatus.OFFLINE
        self.ros: Ros | None = None
        self.publishers = {}
        self.subscribers = {}
        self.PublishableTopics = PublishableTopics
        self.SubscribableTopics = SubscribableTopics
        self.PUBLISHABLE_TOPIC_MESSAGE_TYPES = PUBLISHABLE_TOPIC_MESSAGE_TYPES
        self.services = {}
        self.SUBSCRIBABLE_TOPIC_MESSAGE_TYPES = SUBSCRIBABLE_TOPIC_MESSAGE_TYPES
        self.AVAILABLE_SERVICES = AVAILABLE_SERVICES
        self.SERVICE_MESSAGE_TYPES = SERVICE_MESSAGE_TYPES

    # --------------------
    # Connection Management
    # --------------------
    def connect(self, host: str = None, port: int = None):
        if self.ros and self.ros.is_connected:
            self.disconnect()

        self.ros = Ros(host=host or self.host, port=port or self.port)
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
    def publish(self, topic: str, message: dict):
        if not self.is_connected():
            self.status = RobotStatus.OFFLINE
            raise RuntimeError(f"[{self.robot_id}] Cannot publish: Not connected.")
        
        msg_type = self.PUBLISHABLE_TOPIC_MESSAGE_TYPES[topic]

        if topic not in self.publishers:
            self.publishers[topic] = RosPublisher(ros=self.ros, topic_name=topic, message_type=msg_type)

        self.publishers[topic].publish_once(message)
        self.publishers[topic].close()
        print(f"[{self.robot_id}] Published to {topic}: {message}")

    def publish_string(self, data: str):
        topic = self.PublishableTopics.chatter
        self.publish(topic, {"data": data})

    def publish_twist(self, linear: dict, angular: dict):
        topic = self.PublishableTopics.cmd_vel
        self.publish(topic , {"linear": linear, "angular": angular})

    def publish_pose(self, position: dict, orientation: dict):
        topic = self.PublishableTopics.point
        self.publish(topic, {"position": position, "orientation": orientation})

    def publish_goal_pose(self, header: dict, pose: dict):
        topic = self.PublishableTopics.goal_pose
        self.publish(topic, {"header": header, "pose": pose})

    # --------------------
    # Subscriber Methods
    # --------------------
    def subscribe(self, topic: str):
        if not self.is_connected():
            raise RuntimeError(f"[{self.robot_id}] Cannot subscribe: Not connected.")

        msg_type = self.SUBSCRIBABLE_TOPIC_MESSAGE_TYPES.get(topic)

        if topic not in self.subscribers:
            subscriber = RosSubscriber(ros=self.ros, topic_name=topic, message_type=msg_type)
            subscriber.subscribe()
            self.subscribers[topic] = subscriber
            
        print(f"[{self.robot_id}] Subscribed to {topic}")
    
    def get_last_message(self, topic: str):
        if topic not in self.subscribers:
            raise KeyError(f"[{self.robot_id}] Not subscribed to {topic}")
        return self.subscribers[topic].get_last_message()

    def subscribe_odom(self):
        topic = self.SubscribableTopics.odom
        self.subscribe(topic)
        return self.get_last_message(topic)

    def subscribe_tf(self):
        topic = self.SubscribableTopics.tf
        self.subscribe(topic)
        return self.get_last_message(topic)
    
    def subscribe_map(self):
        topic = self.SubscribableTopics.map
        self.subscribe(topic)
        return self.get_last_message(topic)
    
    def subscribe_diagnostics(self):
        topic = self.SubscribableTopics.diagnostics
        self.subscribe(topic)
        return self.get_last_message(topic)
        
    # --------------------
    # Task Control
    # --------------------
    def call(self, service: str, request: dict):
        if not self.is_connected():
            raise RuntimeError(f"[{self.robot_id}] Cannot call service: Not connected.")

        if service not in self.services:
            srv_type = self.SERVICE_MESSAGE_TYPES.get(service)
            if not srv_type:
                raise ValueError(f"[{self.robot_id}] Service {service} not found in SERVICE_MESSAGE_TYPES.")
            self.services[service] = RosServiceClient(ros=self.ros, service_name=service, service_type=srv_type)

        response = self.services[service].call(request)
        print(f"[{self.robot_id}] Called service {service} with request {request}, got response {response}")
        try:
            return dict(response)
        except Exception:
            return response
    
    def start_mapping(self):
        service = self.AVAILABLE_SERVICES.start_mapping
        response = self.call(service, {})
        self.status = RobotStatus.RUN_TASK
        return response

    def stop_mapping(self, request: dict = {}):
        service = self.AVAILABLE_SERVICES.stop_mapping_and_save_map
        response = self.call(service, request)
        self.status = RobotStatus.IDLE
        return response

    def start_exploring(self):
        service = self.AVAILABLE_SERVICES.start_exploring
        response = self.call(service, {})
        self.status = RobotStatus.RUN_TASK
        return response

    def stop_exploring(self):
        service = self.AVAILABLE_SERVICES.stop_exploring
        response = self.call(service, {})
        self.status = RobotStatus.IDLE
        return response

    def start_navigation(self):
        service = self.AVAILABLE_SERVICES.start_navigation
        response = self.call(service, {})
        self.status = RobotStatus.IDLE
        return response

    def start_navigation_with_map(self, request: dict):
        service = self.AVAILABLE_SERVICES.start_navigation_with_map
        response = self.call(service, request)
        self.status = RobotStatus.RUN_TASK
        return response

    def stop_navigation(self):
        service = self.AVAILABLE_SERVICES.stop_navigation
        response = self.call(service, {})
        self.status = RobotStatus.IDLE
        return response
    
    def start_recording(self, rosbag_name: str):
        service = self.AVAILABLE_SERVICES.start_recording
        request = {"log_file_name": rosbag_name}
        response = self.call(service, request)
        self.status = RobotStatus.RUN_TASK
        return response
    
    def stop_recording(self):
        service = self.AVAILABLE_SERVICES.stop_recording
        response = self.call(service, {})
        self.status = RobotStatus.IDLE
        return response
    
    def recording_status(self):
        service = self.AVAILABLE_SERVICES.recording_status
        response = self.call(service, {})
        response["message"] = response["message"].split(" ")[0]
        return response

    def delete_recording(self, rosbag_name: str):
        service = self.AVAILABLE_SERVICES.delete_recording
        request = {"log_file_name": rosbag_name}
        response = self.call(service, request)
        return response

    # --------------------
    # Status
    # --------------------
    def get_connection_status(self):
        ros_status = {}
        ros_status["connection"] = self.ros.is_connected() if self.ros else False
        return ros_status
    
    
    
    
