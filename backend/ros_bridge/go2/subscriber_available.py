from enum import Enum


class SubscribableTopics(str, Enum):
    odom = "odom"
    tf = "tf"
    image_compressed = "camera/image/compressed"
    depth_image_compressed = "camera/depth/image/compressed"
    imu = "imu"
    battery_state = "battery_state"
    point_cloud = "point_cloud"
    left_wheel_encoder = "left_wheel_encoder"
    right_wheel_encoder = "right_wheel_encoder"


SUBSCRIBABLE_TOPIC_MESSAGE_TYPES = {
    SubscribableTopics.odom: "nav_msgs/Odometry",
    SubscribableTopics.tf: "tf2_msgs/TFMessage",
    SubscribableTopics.image_compressed: "sensor_msgs/CompressedImage",
    SubscribableTopics.depth_image_compressed: "sensor_msgs/CompressedImage",
    SubscribableTopics.imu: "sensor_msgs/Imu",
    SubscribableTopics.battery_state: "sensor_msgs/BatteryState",
    SubscribableTopics.point_cloud: "sensor_msgs/PointCloud2", 
    SubscribableTopics.left_wheel_encoder: "std_msgs/Int32",     
    SubscribableTopics.right_wheel_encoder: "std_msgs/Int32"
}
