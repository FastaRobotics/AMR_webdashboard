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
    PublishableTopics.chatter: "std_msgs/msgs/String", 
    PublishableTopics.cmd_vel_joy: "geometry_msgs/msgs/Twist",
    PublishableTopics.cmd_vel_nav: "geometry_msgs/msgs/Twist",
    PublishableTopics.cmd_vel_out: "geometry_msgs/msgs/Twist",
    PublishableTopics.cmd_vel_dock: "geometry_msgs/msgs/Twist",
    PublishableTopics.cmd_vel: "geometry_msgs/msgs/Twist",
    PublishableTopics.point: "geometry_msgs/msgs/Pose",
    PublishableTopics.goal_pose: "geometry_msgs/msgs/PoseStamped",
    PublishableTopics.initialpose: "geometry_msgs/msgs/PoseWithCovarianceStamped"
}

