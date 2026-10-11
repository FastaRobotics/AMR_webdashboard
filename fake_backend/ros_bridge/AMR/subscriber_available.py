"""Mirror of backend/ros_bridge/AMR/subscriber_available.py (unchanged).

Note the real file maps ``image_compressed`` to a topic path
("/zed/zed_node/right/color/raw/image/compressed") instead of a message type.
It is copied as-is so the fake backend advertises exactly the same topic set;
the value is never used by the simulated bridge.
"""

from enum import Enum


class SubscribableTopics(str, Enum):
    odom = "odom"
    tf = "tf"
    map = "map"
    image_compressed = "camera/image/compressed"
    depth_image_compressed = "camera/depth/image/compressed"
    imu = "imu"
    battery_state = "battery_state"
    point_cloud = "point_cloud"
    left_wheel_encoder = "left_wheel_encoder"
    right_wheel_encoder = "right_wheel_encoder"
    diagnostics = "diagnostics"
    path = "path"



SUBSCRIBABLE_TOPIC_MESSAGE_TYPES = {
    SubscribableTopics.odom: "nav_msgs/msg/Odometry",
    SubscribableTopics.tf: "tf2_msgs/msg/TFMessage",
    SubscribableTopics.image_compressed: "/zed/zed_node/right/color/raw/image/compressed",
    SubscribableTopics.depth_image_compressed: "sensor_msgs/msg/CompressedImage",
    SubscribableTopics.imu: "sensor_msgs/msg/Imu",
    SubscribableTopics.battery_state: "sensor_msgs/msg/BatteryState",
    SubscribableTopics.point_cloud: "sensor_msgs/msg/PointCloud2",
    SubscribableTopics.left_wheel_encoder: "std_msgs/msg/Int32",
    SubscribableTopics.right_wheel_encoder: "std_msgs/msg/Int32",
    SubscribableTopics.map: "nav_msgs/msg/OccupancyGrid",
    SubscribableTopics.diagnostics: "diagnostic_msgs/msg/DiagnosticArray",
    SubscribableTopics.path: "nav_msgs/msg/Path"
}
