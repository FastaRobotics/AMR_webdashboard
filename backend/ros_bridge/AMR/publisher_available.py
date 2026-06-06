from enum import Enum 


class PublishableTopics(str, Enum):
    chatter = "chatter"
    cmd_vel_joy = "cmd_vel_joy"
    cmd_vel_nav = "cmd_vel_nav"
    cmd_vel_out = "cmd_vel_out"
    cmd_vel = "cmd_vel"
    cmd_vel_filtered = "cmd_vel_filtered"
    point = "point"
    goal_pose = "goal_pose"
    initialpose = "initialpose"
    diagnostics = "diagnostics"

PUBLISHABLE_TOPIC_MESSAGE_TYPES = {
    PublishableTopics.chatter: "std_msgs/msg/String", 
    PublishableTopics.cmd_vel_joy: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel_nav: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel_out: "geometry_msgs/msg/Twist",
    PublishableTopics.cmd_vel: "geometry_msgs/msg/Twist",
    PublishableTopics.point: "geometry_msgs/msg/Pose",
    PublishableTopics.goal_pose: "geometry_msgs/msg/PoseStamped",
    PublishableTopics.initialpose: "geometry_msgs/msg/PoseWithCovarianceStamped", 
    PublishableTopics.diagnostics: "diagnostic_msgs/msg/DiagnosticArray"
}

