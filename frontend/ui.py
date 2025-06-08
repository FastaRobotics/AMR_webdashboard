import streamlit as st
import requests
import time
import streamlit.components.v1 as components

FASTAPI_URL = "http://192.168.0.224:8000"  # Update with your Jetson IP

st.set_page_config(page_title="Fasta Robot Dashboard", layout="wide")
st.title("🤖 Fasta Robotics Dashboard")

# --- Odometry Section ---
with st.expander("📍 Odometry Viewer", expanded=True):
    odom_col1, odom_col2 = st.columns([3, 1])
    with odom_col1:
        odom_topic = st.text_input("Odometry Topic", "/odom")
        odom_slot = st.empty()

    with odom_col2:
        update_rate = st.slider("Update Rate (s)", 0.1, 2.0, 1.0)
        enable_odom = st.checkbox("Live Update", value=False)

    if enable_odom:
        while enable_odom:
            try:
                res = requests.post(f"{FASTAPI_URL}/subscribe/odom", json={})
                odom_data = res.json()["message"]
                odom_slot.json(odom_data)
            except Exception as e:
                odom_slot.error(f"Error: {e}")
            time.sleep(update_rate)
            st.experimental_rerun()

# --- Twist Control ---
with st.expander("🎮 Manual Velocity Control (/cmd_vel)", expanded=True):
    twist_topic = st.text_input("Twist Topic", "/cmd_vel")
    linear_x = st.slider("Linear X", -1.0, 1.0, 0.0, 0.05)
    angular_z = st.slider("Angular Z", -2.0, 2.0, 0.0, 0.1)

    if st.button("Send Velocity"):
        twist_data = {
            # "topic": twist_topic,
            "linear": {"x": linear_x, "y": 0, "z": 0},
            "angular": {"x": 0, "y": 0, "z": angular_z}
        }
        try:
            res = requests.post(f"{FASTAPI_URL}/publish/twist", json=twist_data)
            st.success(f"Sent twist command: {twist_data}")
        except Exception as e:
            st.error(f"Error sending command: {e}")

    if st.button("🛑 Stop Robot"):
        stop_data = {
            "topic": twist_topic,
            "linear": {"x": 0, "y": 0, "z": 0},
            "angular": {"x": 0, "y": 0, "z": 0}
        }
        try:
            res = requests.post(f"{FASTAPI_URL}/publish/twist", json=stop_data)
            st.success("Robot stopped.")
        except Exception as e:
            st.error(f"Error stopping robot: {e}")

# --- Goal Pose Publisher ---
with st.expander("📬 Send Goal Pose", expanded=False):
    goal_topic = st.text_input("Goal Topic", "/point")
    px = st.number_input("Position X", value=0.0)
    py = st.number_input("Position Y", value=0.0)
    pz = st.number_input("Position Z", value=0.0)
    ox = st.number_input("Orientation X", value=0.0)
    oy = st.number_input("Orientation Y", value=0.0)
    oz = st.number_input("Orientation Z", value=0.0)
    ow = st.number_input("Orientation W", value=1.0)

    if st.button("Send Goal Pose"):
        pose_data = {
            # "topic": goal_topic,
            "position": {"x": px, "y": py, "z": pz},
            "orientation": {"x": ox, "y": oy, "z": oz, "w": ow}
        }
        print(pose_data)
        try:
            res = requests.post(f"{FASTAPI_URL}/publish/pose", json=pose_data)
            st.success(f"Sent pose: {pose_data}")
        except Exception as e:
            st.error(f"Error sending pose: {e}")

# --- TF Viewer ---
with st.expander("🧭 TF Viewer", expanded=False):
    tf_topic = st.text_input("TF Topic", "/tf")
    if st.button("Get TF"):
        try:
            res = requests.post(f"{FASTAPI_URL}/subscribe/tf", json={})
            st.json(res.json()["message"])
        except Exception as e:
            st.error(f"Error fetching TF: {e}")

# --- Status Info ---
with st.expander("🔍 System Status", expanded=False):
    st.markdown("*(Add your custom ROS status endpoints here, e.g., `/status/battery` or `/status/map`)*")


