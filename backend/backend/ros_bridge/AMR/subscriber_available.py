from enum import Enum


class SubscribableTopics(str, Enum):
    odom = "/odom"
    tf = "/tf"
    map = "/map"
    map_updates = "/map_updates"
    image = "/rgbd_camera/image"
    depth_image = "/rgbd_camera/depth_image"
    imu = "/imu"
    scan = "/scan"
    amcl_pose = "/amcl_pose"
    path = "/plan"
    local_plan = "/local_plan"


SUBSCRIBABLE_TOPIC_MESSAGE_TYPES = {
    SubscribableTopics.odom: "nav_msgs/msg/Odometry",
    SubscribableTopics.tf: "tf2_msgs/msg/TFMessage",
    SubscribableTopics.map: "nav_msgs/msg/OccupancyGrid",
    SubscribableTopics.map_updates: "map_msgs/msg/OccupancyGridUpdate",
    SubscribableTopics.image: "sensor_msgs/msg/Image",
    SubscribableTopics.depth_image: "sensor_msgs/msg/Image",
    SubscribableTopics.imu: "sensor_msgs/msg/Imu",
    SubscribableTopics.scan: "sensor_msgs/msg/LaserScan",
    SubscribableTopics.amcl_pose: "geometry_msgs/msg/PoseWithCovarianceStamped",
    SubscribableTopics.path: "nav_msgs/msg/Path",
    SubscribableTopics.local_plan: "nav_msgs/msg/Path",
}
