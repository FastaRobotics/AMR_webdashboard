from enum import Enum


class PublishableTopics(str, Enum):
    cmd_vel = "/cmd_vel"
    goal_pose = "/goal_pose"
    initialpose = "/initialpose"


PUBLISHABLE_TOPIC_MESSAGE_TYPES = {
    PublishableTopics.cmd_vel: "geometry_msgs/msg/Twist",
    PublishableTopics.goal_pose: "geometry_msgs/msg/PoseStamped",
    PublishableTopics.initialpose: "geometry_msgs/msg/PoseWithCovarianceStamped",
}
