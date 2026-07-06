# AMR Web Dashboard

A web dashboard for monitoring and controlling AMRs (Autonomous Mobile Robots) over ROS 2.

The system has three parts that run together:

| Component | Stack | Default address |
|-----------|-------|-----------------|
| **Frontend** | Flutter (web) | http://127.0.0.1:8080 |
| **Backend** | FastAPI + Uvicorn | http://0.0.0.0:8000 |
| **ROS bridge** | `rosbridge_server` (WebSocket) | ws://localhost:9090 |

The frontend talks to the backend over HTTP/WebSocket, and the backend talks to the robot over the ROS bridge.

## Prerequisites

- [Flutter](https://docs.flutter.dev/get-started/install) SDK `^3.12.2`
- Python 3.10+
- ROS 2 with `rosbridge_server` installed

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/FastaRobotics/AMR_webdashboard.git
cd AMR_webdashboard
```

### 2. ROS 2 bridge

Install `rosbridge_server` for your ROS 2 distro if it is not already available:

```bash
sudo apt install ros-${ROS_DISTRO}-rosbridge-server
```

Source your ROS workspace before launching the bridge:

```bash
source /opt/ros/${ROS_DISTRO}/setup.bash
# source your robot workspace if needed
```

### 3. Backend

Create a virtual environment and install Python dependencies:

```bash
cd backend
python3 -m venv bk_venv
source bk_venv/bin/activate
pip install -r requirements.txt
```

The API entry point is `backend/backend/api.py`. Run it from the inner `backend` directory (see [Running](#running)).

### 4. Frontend

Install Flutter dependencies:

```bash
cd frontend
flutter pub get
```

Enable web support if you have not already:

```bash
flutter config --enable-web
```

## Running

Start each component in its own terminal, in this order.

### 1. ROS bridge

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=9090
```

### 2. Backend

```bash
cd backend
source bk_venv/bin/activate
cd backend
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

The API is then available at http://localhost:8000 (interactive docs at http://localhost:8000/docs).

### 3. Frontend

```bash
cd frontend
flutter run -d web-server --web-hostname 127.0.0.1 --web-port 8080 --no-web-resources-cdn
```

Then open http://127.0.0.1:8080 in your browser.

## Usage

1. Open the dashboard and sign in (or choose **Continue without login**).
2. The dashboard auto-connects to the robot via the ROS bridge.
3. Use **Start Navigation** to load the map and send the configured goal, long-press the map to send a custom goal, or use the manual control pad to drive the robot.
4. **E-STOP** continuously publishes `cmd_vel = 0` to halt the robot.

## Configuration

Frontend defaults (backend URL, robot ID, ROS host/port, map scale, navigation goal, TF visualization) live in `frontend/lib/core/config.dart`.
