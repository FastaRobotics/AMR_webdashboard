from enum import Enum 


class AvailableServices(str, Enum):
    start_mapping = "/mapping_service_node/start_mapping"
    stop_mapping_and_save_map = "/mapping_service_node/stop_mapping"
    load_map_by_name = "/mapping_service_node/load_map_by_name"
    delete_mapping = "/mapping_service_node/delete_mapping"

    start_navigation = "/start/navigation"
    start_navigation_with_map = "/start/navigation_with_map"
    stop_navigation = "/stop/navigation"
    start_exploring = "/mapping_service_node/start_exploring"
    stop_exploring = "/mapping_service_node/stop_exploring"
    
    webrtc_start = "/webrtc/start"

    start_recording = "/start/recording"
    stop_recording = "/stop/recording"
    recording_status = "/status/recording"
    delete_recording = "/delete/recording"


SERVICE_MESSAGE_TYPES = {
    AvailableServices.start_mapping: "std_srvs/srv/Trigger", 
    AvailableServices.stop_mapping_and_save_map: "robot_msgs/srv/SaveMapByName", 
    AvailableServices.delete_mapping: "robot_msgs/srv/DeleteMap",
    AvailableServices.load_map_by_name: "robot_msgs/srv/LoadMapByName",

    AvailableServices.start_exploring: "std_srvs/srv/Trigger",
    AvailableServices.stop_exploring: "std_srvs/srv/Trigger",
    AvailableServices.start_navigation: "std_srvs/srv/Trigger",
    AvailableServices.start_navigation_with_map: "robot_msgs/srv/LoadMapByName",
    AvailableServices.stop_navigation: "std_srvs/srv/Trigger",

    AvailableServices.webrtc_start: "std_srvs/srv/Trigger",

    AvailableServices.start_recording: "robot_msgs/srv/RosBagByName",
    AvailableServices.stop_recording: "std_srvs/srv/Trigger",
    AvailableServices.recording_status: "std_srvs/srv/Trigger",
    AvailableServices.delete_recording: "robot_msgs/srv/RosBagByName",
}

