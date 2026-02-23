from enum import Enum 


class AvailableServices(str, Enum):
    start_mapping = "/start_mapping"
    stop_mapping_and_save_map = "/stop_mapping_and_save_map"
    load_map = "/load_map"
    start_navigation = "/start/navigation"
    stop_navigation = "/stop/navigation"
    start_exploring = "/start_exploring"
    stop_exploring = "/stop_exploring"

SERVICE_MESSAGE_TYPES = {
    AvailableServices.start_mapping: "std_srv/srv/Trigger", 
    AvailableServices.stop_mapping_and_save_map: "robot_msgs/srv/SaveMap", 
    AvailableServices.start_exploring: "std_srv/srv/Trigger",
    AvailableServices.stop_exploring: "std_srv/srv/Trigger",
    AvailableServices.start_navigation: "std_srv/srv/Trigger",
    AvailableServices.stop_navigation: "std_srv/srv/Trigger",
}

