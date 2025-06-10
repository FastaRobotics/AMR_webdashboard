from enum import Enum 


class AvailableTopics(str, Enum):
    chatter = "chatter"
    cmd_vel_joy = "cmd_vel_joy"
    cmd_vel_nav = "cmd_vel_nav"
    cmd_vel_out = "cmd_vel_out"
    point = "point"
    goal_pose = "goal_pose"
    initialpose = "initialpose"

TOPIC_MESSAGE_TYPES = {
    AvailableTopics.chatter: "std_msgs/String", 
    AvailableTopics.cmd_vel_joy: "geometry_msgs/Twist",
    AvailableTopics.cmd_vel_nav: "geometry_msgs/Twist",
    AvailableTopics.cmd_vel_out: "geometry_msgs/Twist",
    AvailableTopics.point: "geometry_msgs/Pose",
    AvailableTopics.goal_pose: "geometry_msgs/PoseStamped",
    AvailableTopics.initialpose: "geometry_msgs/PoseWithCovarianceStamped"
}

