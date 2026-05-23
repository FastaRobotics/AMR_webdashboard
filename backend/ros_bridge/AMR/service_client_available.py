from enum import Enum 


class AvailableServices(str, Enum):
    start_mapping = "/mapping_service_node/start_mapping"
    stop_mapping_and_save_map = "/mapping_service_node/stop_mapping"
    load_map_by_name = "/mapping_service_node/load_map_by_name"
    start_navigation = "/start/navigation"
    stop_navigation = "/stop/navigation"
    start_exploring = "/mapping_service_node/start_exploring"
    stop_exploring = "/mapping_service_node/stop_exploring"


SERVICE_MESSAGE_TYPES = {
    AvailableServices.start_mapping: "std_srv/srv/Trigger", 
    AvailableServices.stop_mapping_and_save_map: "robot_msgs/srv/SaveMapByName", 
    AvailableServices.start_exploring: "std_srv/srv/Trigger",
    AvailableServices.stop_exploring: "std_srv/srv/Trigger",
    AvailableServices.start_navigation: "std_srv/srv/Trigger",
    AvailableServices.stop_navigation: "std_srv/srv/Trigger",
    AvailableServices.load_map_by_name: "robot_msgs/srv/LoadMapByName"
}

