import streamlit as st
import requests
import json
import time # For simulating real-time updates and polling
import folium # Example for map visualization, you might use a different library
from streamlit_folium import st_folium # To render folium maps in Streamlit

# --- Configuration ---
FASTAPI_BASE_URL = "http://192.168.0.224:8000" # Replace with your FastAPI server address

# --- Helper Functions for API Calls ---
def get_robot_status():
    try:
        response = requests.get(f"{FASTAPI_BASE_URL}/status")
        response.raise_for_status() # Raise an exception for HTTP errors
        return response.json()
    except requests.exceptions.RequestException as e:
        st.error(f"Error fetching status: {e}")
        return {"status": "disconnected"}

def publish_twist(linear_x, linear_y, angular_z, topic="/cmd_vel"):
    payload = {
        # "topic": topic,
        "linear": {"x": linear_x, "y": linear_y, "z": 0.0},
        "angular": {"x": 0.0, "y": 0.0, "z": angular_z}
    }
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/publish/twist", json=payload)
        response.raise_for_status()
        st.success(f"Published Twist: {response.json()}")
    except requests.exceptions.RequestException as e:
        st.error(f"Error publishing twist: {e}")

def publish_goal_pose(x, y, z, ox, oy, oz, ow, frame_id="map", stamp_sec=0, stamp_nanosec=0, topic="/goal_pose"):
    # Note: stamp_sec and stamp_nanosec usually come from ROS time,
    # but for simplicity, we'll use dummy values or get current time in a real app.
    payload = {
        # "topic": topic,
        "header": {
            "frame_id": frame_id,
            "stamp": {"sec": stamp_sec, "nanosec": stamp_nanosec}
        },
        "pose": {
            "position": {"x": x, "y": y, "z": z},
            "orientation": {"x": ox, "y": oy, "z": oz, "w": ow}
        }
    }
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/publish/goal_pose", json=payload)
        response.raise_for_status()
        st.success(f"Published Goal Pose: {response.json()}")
    except requests.exceptions.RequestException as e:
        st.error(f"Error publishing goal pose: {e}")

def start_mapping_api():
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/start/mapping")
        response.raise_for_status()
        st.success(response.json().get("status"))
    except requests.exceptions.RequestException as e:
        st.error(f"Error starting mapping: {e}")

def stop_mapping_api():
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/stop/mapping")
        response.raise_for_status()
        st.success(response.json().get("status"))
    except requests.exceptions.RequestException as e:
        st.error(f"Error stopping mapping: {e}")

def start_navigation_api():
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/start/navigation")
        response.raise_for_status()
        st.success(response.json().get("status"))
    except requests.exceptions.RequestException as e:
        st.error(f"Error starting navigation: {e}")

def stop_navigation_api():
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/stop/navigation")
        response.raise_for_status()
        st.success(response.json().get("status"))
    except requests.exceptions.RequestException as e:
        st.error(f"Error stopping navigation: {e}")

def get_odom_data(topic="/odom"):
    payload = {"topic": topic}
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/subscribe/odom", json={})
        response.raise_for_status()
        return response.json().get("message")
    except requests.exceptions.RequestException as e:
        # st.warning(f"No odometry data yet or error: {e}") # Suppress if polling frequently
        return None

def get_tf_data(topic="/tf"):
    payload = {"topic": topic}
    try:
        response = requests.post(f"{FASTAPI_BASE_URL}/subscribe/tf", json={})
        response.raise_for_status()
        return response.json().get("message")
    except requests.exceptions.RequestException as e:
        # st.warning(f"No TF data yet or error: {e}") # Suppress if polling frequently
        return None

# --- Streamlit App Layout ---

st.set_page_config(layout="wide", page_title="Warehouse AMR Dashboard")

st.title("Warehouse AMR Control Dashboard")

# --- Header Bar (Simple) ---
status = get_robot_status()
col_status, col_title = st.columns([1, 5])
with col_status:
    if status and status.get("connection"):
        st.markdown("<span style='color:green;'>●</span> Connected", unsafe_allow_html=True)
    else:
        st.markdown("<span style='color:red;'>●</span> Disconnected", unsafe_allow_html=True)
with col_title:
    if status and status.get("mapping"):
        st.write(f"Current Mode: **Mapping Mode**")
    elif status and status.get("navigation"):
        st.write(f"Current Mode: **Navigation Mode**")
    else:
        st.write(f"Current Mode: Ready to work")

st.markdown("---") # Separator

# --- Sidebar Navigation ---
st.sidebar.title("Navigation")
page = st.sidebar.radio("Go to",
    ["Dashboard Overview", "Robot Control", "Mapping", "Navigation", "Robot Status", "Logs/Events"])

# --- Main Content Area ---

if page == "Dashboard Overview":
    st.header("Dashboard Overview")

    col1, col2 = st.columns(2)

    with col1:
        st.subheader("Robot Summary")
        st.info(f"**ROS Bridge Connection:** {'Connected' if status.get('ros_connected') else 'Disconnected'}")
        st.info(f"**Robot Mode:** {status.get('current_mode', 'Unknown')}")
        st.info(f"**Battery Level:** N/A (Implement subscription if available)") # Placeholder

        st.subheader("Quick Actions")
        if st.button("Start Mapping", key="overview_start_mapping"):
            start_mapping_api()
        if st.button("Stop Mapping", key="overview_stop_mapping"):
            stop_mapping_api()
        if st.button("Start Navigation", key="overview_start_navigation"):
            start_navigation_api()
        if st.button("Stop Navigation", key="overview_stop_navigation"):
            stop_navigation_api()

    with col2:
        st.subheader("Robot Location (Approximate)")
        # Simple placeholder for a map.
        # For a real robot map, you'd need to fetch /map and overlay odom/tf.
        # This uses folium for a very basic interactive map.
        m = folium.Map(location=[39.7392, -104.9903], zoom_start=12) # Centered on Denver
        odom = get_odom_data()
        if odom:
            pos = odom.get("pose", {}).get("pose", {}).get("position", {})
            st.write(f"Last Known Position: X: {pos.get('x'):.2f}, Y: {pos.get('y'):.2f}")
            # Add a marker for the robot's approximate position if data is available
            folium.Marker([pos.get('y', 39.7392), pos.get('x', -104.9903)],
                          tooltip=f"Robot @ ({pos.get('x'):.2f}, {pos.get('y'):.2f})").add_to(m)
        else:
            st.write("Waiting for odometry data...")

        st_folium(m, width=700, height=300)


elif page == "Robot Control":
    st.header("Robot Control")

    col_map, col_controls = st.columns([2, 1])

    with col_map:
        st.subheader("Interactive Map & Goal Setting")
        st.write("*(Interactive map will display robot position and allow goal selection)*")

        # --- Placeholder for an actual interactive map ---
        # For a full-fledged robot map, you'd integrate a more complex map library
        # that can render ROS /map topics and handle click events for goal setting.
        # Libraries like `streamlit_bokeh_js_map` or building a custom component
        # with Leaflet/OpenLayers would be more suitable.
        m_control = folium.Map(location=[39.7392, -104.9903], zoom_start=12)
        odom = get_odom_data()
        if odom:
            pos = odom.get("pose", {}).get("pose", {}).get("position", {})
            # Example: Assuming Y is latitude and X is longitude for Folium
            folium.Marker([pos.get('y', 39.7392), pos.get('x', -104.9903)],
                          tooltip=f"Robot @ ({pos.get('x'):.2f}, {pos.get('y'):.2f})",
                          icon=folium.Icon(color="blue", icon="robot")).add_to(m_control)

        st_folium(m_control, width=800, height=500, key="robot_control_map")
        st.info("Clicking on the map for goal setting would require custom JavaScript integration.")

    with col_controls:
        st.subheader("Teleoperation (Twist)")
        st.write("Use sliders to control linear and angular velocities.")

        linear_x = st.slider("Linear X (m/s)", -1.0, 1.0, 0.0, 0.05)
        angular_z = st.slider("Angular Z (rad/s)", -1.5, 1.5, 0.0, 0.05)

        col_fwd, col_stop, col_bwd = st.columns(3)
        with col_fwd:
            if st.button("⬆️ Forward"):
                publish_twist(linear_x, 0.0, 0.0)
        with col_stop:
            if st.button("⏹️ Stop"):
                publish_twist(0.0, 0.0, 0.0)
        with col_bwd:
            if st.button("⬇️ Backward"):
                publish_twist(-linear_x, 0.0, 0.0)

        col_left, col_right = st.columns(2)
        with col_left:
            if st.button("↩️ Rotate Left"):
                publish_twist(0.0, 0.0, angular_z)
        with col_right:
            if st.button("↪️ Rotate Right"):
                publish_twist(0.0, 0.0, -angular_z)

        st.subheader("Send Specific Goal Pose")
        st.write("Enter coordinates and orientation for a precise goal.")
        goal_x = st.number_input("Goal X", value=0.0)
        goal_y = st.number_input("Goal Y", value=0.0)
        goal_z = st.number_input("Goal Z", value=0.0)
        goal_ox = st.number_input("Orientation X", value=0.0)
        goal_oy = st.number_input("Orientation Y", value=0.0)
        goal_oz = st.number_input("Orientation Z", value=0.0)
        goal_ow = st.number_input("Orientation W", value=1.0) # Quaternion W is often 1 for no rotation

        if st.button("Send Goal Pose"):
            publish_goal_pose(goal_x, goal_y, goal_z, goal_ox, goal_oy, goal_oz, goal_ow)


elif page == "Mapping":
    st.header("Mapping Section")
    st.subheader("Mapping Controls")

    col_map_start, col_map_stop = st.columns(2)
    with col_map_start:
        if st.button("Start Mapping"):
            start_mapping_api()
    with col_map_stop:
        if st.button("Stop Mapping"):
            stop_mapping_api()

    st.subheader("Live Map Preview")
    st.write("*(This section would display the map being built by the robot.)*")
    # For a real map, you'd subscribe to /map topic and render it.
    # This is highly dependent on how your /map topic is exposed and how you want to visualize it.
    # You might need a custom Streamlit component or a more specialized library.
    st.image("https://via.placeholder.com/600x400?text=Live+Map+Building+Preview",
             caption="Placeholder for live map data")
    st.info("Displaying the actual ROS map (`nav_msgs/OccupancyGrid`) requires specialized rendering logic.")


elif page == "Navigation":
    st.header("Navigation Section")
    st.subheader("Navigation Controls")

    col_nav_start, col_nav_stop = st.columns(2)
    with col_nav_start:
        if st.button("Start Navigation"):
            start_navigation_api()
    with col_nav_stop:
        if st.button("Stop Navigation"):
            stop_navigation_api()

    st.subheader("Set Navigation Goal")
    st.write("Use the interactive map (or manual inputs) to set the robot's destination.")

    # Re-using the goal pose input from Robot Control for consistency
    st.markdown("---")
    st.write("**Manual Goal Pose Input:**")
    nav_goal_x = st.number_input("Goal X (Nav)", value=0.0, key="nav_goal_x")
    nav_goal_y = st.number_input("Goal Y (Nav)", value=0.0, key="nav_goal_y")
    nav_goal_z = st.number_input("Goal Z (Nav)", value=0.0, key="nav_goal_z")
    nav_goal_ox = st.number_input("Orientation X (Nav)", value=0.0, key="nav_goal_ox")
    nav_goal_oy = st.number_input("Orientation Y (Nav)", value=0.0, key="nav_goal_oy")
    nav_goal_oz = st.number_input("Orientation Z (Nav)", value=0.0, key="nav_goal_oz")
    nav_goal_ow = st.number_input("Orientation W (Nav)", value=1.0, key="nav_goal_ow")

    if st.button("Send Navigation Goal"):
        publish_goal_pose(nav_goal_x, nav_goal_y, nav_goal_z,
                          nav_goal_ox, nav_goal_oy, nav_goal_oz, nav_goal_ow,
                          topic="/goal_pose") # Assuming /goal_pose is used for navigation goals

    st.subheader("Navigation Status & Progress")
    st.write("*(Display remaining distance, ETA, current state like 'Planning', 'Moving', 'Stuck'.)*")
    st.info("Navigation status would be derived from subscribing to relevant ROS topics like `/move_base/status` or `/nav2/status`.")
    st.progress(0, text="Progress: N/A") # Placeholder
    st.metric(label="Distance to Goal", value="N/A", delta="N/A") # Placeholder


elif page == "Robot Status":
    st.header("Robot Status & Diagnostics")

    st.subheader("Odometry Data (`/odom`)")
    odom_data = get_odom_data()
    if odom_data:
        # st.json(odom_data) # Display raw JSON for now
        pose = odom_data.get("pose", {}).get("pose", {})
        position = pose.get("position", {})
        orientation = pose.get("orientation", {})
        twist = odom_data.get("twist", {}).get("twist", {})
        linear = twist.get("linear", {})
        angular = twist.get("angular", {})

        st.markdown(f"**Position:** X: `{position.get('x'):.3f}`, Y: `{position.get('y'):.3f}`, Z: `{position.get('z'):.3f}`")
        st.markdown(f"**Orientation (Quaternion):** X: `{orientation.get('x'):.3f}`, Y: `{orientation.get('y'):.3f}`, Z: `{orientation.get('z'):.3f}`, W: `{orientation.get('w'):.3f}`")
        st.markdown(f"**Linear Velocity:** X: `{linear.get('x'):.3f}`, Y: `{linear.get('y'):.3f}`, Z: `{linear.get('z'):.3f}`")
        st.markdown(f"**Angular Velocity:** X: `{angular.get('x'):.3f}`, Y: `{angular.get('y'):.3f}`, Z: `{angular.get('z'):.3f}`")
    else:
        st.info("No odometry data available yet. Ensure ROS bridge is connected and `/odom` is publishing.")

    st.subheader("TF Data (`/tf`)")
    tf_data = get_tf_data()
    if tf_data:
        # st.json(tf_data) # Display raw JSON
        # You'd parse and visualize specific transforms here.
        # For example, listing all frames.
        transforms = tf_data.get("transforms", [])
        if transforms:
            st.write("**Active Transforms:**")
            for t in transforms:
                st.write(f"- `{t['child_frame_id']}` -> `{t['header']['frame_id']}`")
        else:
            st.info("No transforms in TF data.")
    else:
        st.info("No TF data available yet. Ensure ROS bridge is connected and `/tf` is publishing.")

    st.subheader("Other Sensor Data")
    st.write("*(Placeholder for LiDAR, camera, battery, etc.)*")
    st.info("You would add more API calls and display logic here for other sensor topics.")


elif page == "Logs/Events":
    st.header("Logs & Events")
    st.write("*(This section would display a chronological feed of robot activities and system messages.)*")
    st.info("You would need a backend service that aggregates ROS logs and potentially your FastAPI logs, then exposes them via an API endpoint for this section.")

    # Example of a simple log table
    st.subheader("Recent Events")
    log_data = [
        {"Timestamp": "2025-06-10 10:00:00", "Type": "INFO", "Description": "Robot started navigation to warehouse A"},
        {"Timestamp": "2025-06-10 10:01:30", "Type": "WARNING", "Description": "Obstacle detected, recalculating path"},
        {"Timestamp": "2025-06-10 10:02:45", "Type": "INFO", "Description": "Reached goal: Warehouse A"},
        {"Timestamp": "2025-06-10 10:03:00", "Type": "ERROR", "Description": "Lost connection to charging dock"},
    ]
    st.table(log_data)

    st.text_input("Search Logs", placeholder="e.g., 'error', 'navigation'")
    st.button("Refresh Logs")