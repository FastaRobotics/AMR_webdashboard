from enum import Enum 


class AvailableTopics(str, Enum):
    chatter = "chatter"
    cmd_vel_joy = "cmd_vel_joy"
    cmd_vel_nav = "cmd_vel_nav"
    cmd_vel_out = "cmd_vel_out"
    goal_pose = "goal_pose"
    initialpose = "initialpose"
    joy = "joy"
    imu_data = "imu/data"
    gps_fix = "gps/fix"
    scan = "scan"
    odom = "odom"
    zed_rgb_image = "zed/zed_node/rgb/image_rect_color"
    zed_depth = "zed/zed_node/depth/depth_registered"


TOPIC_MESSAGE_TYPES = {
    AvailableTopics.chatter: "std_msgs/String", 
    AvailableTopics.cmd_vel_joy: "geometry_msgs/Twist",
    AvailableTopics.cmd_vel_nav: "geometry_msgs/Twist",
    AvailableTopics.cmd_vel_out: "geometry_msgs/Twist",
    AvailableTopics.goal_pose: "geometry_msgs/PoseStamped",
    AvailableTopics.initialpose: "geometry_msgs/PoseWithCovarianceStamped",
    AvailableTopics.joy: "sensor_msgs/Joy",
    AvailableTopics.imu_data: "sensor_msgs/Imu",
    AvailableTopics.gps_fix: "sensor_msgs/NavSatFix",
    AvailableTopics.scan: "sensor_msgs/LaserScan",
    AvailableTopics.odom: "nav_msgs/Odometry",
    AvailableTopics.zed_rgb_image: "sensor_msgs/Image",
    AvailableTopics.zed_depth: "sensor_msgs/Image"
}
