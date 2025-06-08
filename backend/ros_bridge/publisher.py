from roslibpy import Ros, Topic, Message
import time

class RosPublisher:
    def __init__(self, host='localhost', port=9090, topic_name='/chatter', message_type='std_msgs/String'):
        self.host = host
        self.port = port
        self.topic_name = topic_name
        self.message_type = message_type

        self.ros = Ros(host=self.host, port=self.port)
        self.ros.run()
        if not self.ros.is_connected:
            raise Exception(f"[RosPublisher] Failed to connect to ROS at ws://{host}:{port}")
        print(f"[RosPublisher] Connected to ROS at ws://{host}:{port}")

        self.topic = Topic(self.ros, self.topic_name, self.message_type)
        self.topic.advertise() 

    def publish_once(self, data_dict):
        if self.ros.is_connected:
            self.topic.publish(Message(data_dict))
            print(f"[RosPublisher] Published once: {data_dict}")
        else:
            print("[RosPublisher] Cannot publish, not connected.")

    def publish_constantly(self, data_dict, interval=0.1):
        print("[RosPublisher] Starting constant publishing. Press Ctrl+C to stop.")
        try:
            while self.ros.is_connected:
                self.topic.publish(Message(data_dict))
                print(f"[RosPublisher] Published: {data_dict}")
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\n[RosPublisher] Publishing interrupted by user.")
        finally:
            self.close()

    def close(self):
        self.topic.unadvertise()
        self.ros.terminate()
        print("[RosPublisher] Connection closed.")
