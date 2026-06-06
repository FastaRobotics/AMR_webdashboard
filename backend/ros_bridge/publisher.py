from roslibpy import Ros, Topic, Message
import time

class RosPublisher:
    def __init__(self, 
                ros,
                host='localhost', 
                port=9090, 
                topic_name='/chatter', 
                message_type='std_msgs/String'):
        self.ros = ros
        self.host = host
        self.port = port
        self.topic_name = topic_name
        self.message_type = message_type
        print(f"[RosPublisher] Connected to ROS at ws://{host}:{port}")

        self.topic = Topic(self.ros, self.topic_name, self.message_type)
        self.topic.advertise() 

    def publish_once(self, data_dict):
        self.topic.publish(Message(data_dict))
        print(f"[RosPublisher] Published once: {data_dict}")

    def close(self):
        self.topic.unadvertise()
        print("[RosPublisher] Connection closed.")
