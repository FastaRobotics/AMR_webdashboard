import roslibpy
from roslibpy.ros import Ros
from roslibpy import Service, ServiceRequest


class RosServiceClient:
    def __init__(self, 
                 ros: Ros,
                 host: str = 'localhost', 
                 port: int = 9090, 
                 service_name: str = '/mapping_service_node/start_mapping', 
                 service_type: str = 'std_msgs/srv/Trigger') -> None:
        """Init function for calling different ros2 services

        Args:
            ros (Ros): Ros client to connect to ros
            host (str, optional): host. Defaults to 'localhost'.
            port (int, optional): port number. Defaults to 9090.
            service_name (str, optional): Service name to call. Defaults to '/mapping_service_node/start_mapping'.
            service_type (str, optional): Service type. Defaults to 'std_msgs/srv/Trigger'.
        """
        self.service_name = service_name 
        self.service_type = service_type
        self.service = Service(ros,
                          self.service_name,
                          self.service_type)
        
        print(f"[RosServiceClient] Connected to ROS at ws://{host}:{port}")
    
    def call(self, service_request: dict = None)-> dict:
        """Calling desired service

        Args:
            service_request (dict, optional): Dictionary request format to give data if needed
                                              in request. Defaults to None.

        Returns:
            dict: response of request
        """
        request = ServiceRequest(service_request)
        response = self.service.call(request=request)
        return response.response
    


