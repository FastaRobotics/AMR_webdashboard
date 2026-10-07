"""Mirror of backend/ros_bridge/go2/publisher_available.py (unchanged).

The real file spells the docking topic ``cmd_vel_doc``; kept as-is so the fake
backend accepts exactly the topics the real one does.
"""

from enum import Enum


class PublishableTopics(str, Enum):
    chatter = "chatter"
    cmd_vel_dock = "cmd_vel_doc"
    cmd_vel_joy = "cmd_vel_joy"
    cmd_vel_nav = "cmd_vel_nav"
    cmd_vel_out = "cmd_vel_out"
    cmd_vel = "cmd_vel"
    point = "point"
    goal_pose = "goal_pose"
    initialpose = "initialpose"


PUBLISHABLE_TOPIC_MESSAGE_TYPES = {
    PublishableTopics.chatter: "std_msgs/msg/String",
    PublishableTopics.cmd_vel_joy: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel_nav: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel_out: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel_dock: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel: "geometry_msgs/msg/Twist",
    PublishableTopics.point: "geometry_msgs/msg/Pose",
    PublishableTopics.goal_pose: "geometry_msgs/msg/PoseStamped",
    PublishableTopics.initialpose: "geometry_msgs/msg/PoseWithCovarianceStamped"
}
