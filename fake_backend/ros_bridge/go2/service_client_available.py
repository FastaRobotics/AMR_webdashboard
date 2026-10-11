"""Mirror of backend/ros_bridge/go2/service_client_available.py (unchanged).

The Go2 service set is much smaller than the AMR's: no ``start_navigation_with_map``
and no recording services. The fake backend keeps that capability gap on purpose,
but reports it with a readable message instead of an ``AttributeError``.
"""

from enum import Enum


class AvailableServices(str, Enum):
    start_mapping = "/start_mapping"
    stop_mapping_and_save_map = "/stop_mapping_and_save_map"
    load_map = "/load_map"
    start_navigation = "/start_navigation"
    stop_navigation = "/stop_navigation"
    start_exploring = "/start_exploring"
    stop_exploring = "/stop_exploring"

SERVICE_MESSAGE_TYPES = {
    AvailableServices.start_mapping: "std_srv/srv/Trigger",
    AvailableServices.stop_mapping_and_save_map: "go2_msgs/srv/SaveMap",
    AvailableServices.start_exploring: "std_srv/srv/Trigger",
    AvailableServices.stop_exploring: "std_srv/srv/Trigger",
}
