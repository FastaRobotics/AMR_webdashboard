from roslibpy import Ros, Topic


class RosSubscriber:
    def __init__(self, ros, host='localhost', port=9090, topic_name='/chatter', message_type='std_msgs/String'):
        self.ros = ros
        self.topic = Topic(self.ros, topic_name, message_type)
        self.last_message = None
        self.subscribed = False

    def subscribe(self):
        if not self.subscribed:
            self.topic.subscribe(lambda msg: self._update_message(msg))
            self.subscribed = True
            print(f"[RosSubscriber] Subscribed to {self.topic.name}")

    def _update_message(self, message):
        self.last_message = message

    def get_last_message(self):
        return self.last_message

    def unsubscribe(self):
        if self.subscribed:
            self.topic.unsubscribe()
            self.subscribed = False
            print(f"[RosSubscriber] Unsubscribed from {self.topic.name}")