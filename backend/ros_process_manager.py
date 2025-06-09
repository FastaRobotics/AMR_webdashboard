import subprocess


class RosProcessManager:
    def __init__(self):
        self.mapping_session = "ros_mapping"
        self.navigation_session = "ros_navigation"

        self.ros_setup = "source /opt/ros/humble/setup.bash"
        self.ws_setup = "source ~/ros2_ws/install/setup.bash"

    def _run_tmux_command(self, session_name, cmd):
        full_cmd = f"{self.ros_setup} && {self.ws_setup} && {cmd}"
        subprocess.run(f'tmux new-session -d -s {session_name} bash -c "{full_cmd}"', shell=True)

    def _stop_tmux_session(self, session_name):
        subprocess.run(f"tmux kill-session -t {session_name}", shell=True)

    def start_mapping(self):
        self.stop_mapping()
        print("[ROS] Starting mapping...")
        self._run_tmux_command(self.mapping_session, "ros2 launch robot_launch_files mapping_launch.py")

    def stop_mapping(self):
        print("[ROS] Stopping mapping...")
        self._stop_tmux_session(self.mapping_session)

    def start_navigation(self):
        self.stop_navigation()
        print("[ROS] Starting navigation...")
        self._run_tmux_command(self.navigation_session, "ros2 launch robot_launch_files navigation.launch.py")

    def stop_navigation(self):
        print("[ROS] Stopping navigation...")
        self._stop_tmux_session(self.navigation_session)

    def stop_all(self):
        self.stop_mapping()
        self.stop_navigation()

    def status(self):
        mapping = subprocess.run(f"tmux has-session -t {self.mapping_session}", shell=True).returncode == 0
        navigation = subprocess.run(f"tmux has-session -t {self.navigation_session}", shell=True).returncode == 0
        return {
            "mapping": mapping,
            "navigation": navigation
        }
