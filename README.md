
# Fasta Backend with fastapi + webrtc + roslibpy

This repository contains the backend for the Fasta robot dashboards, handling real-time robot data and communication.

The project covers:
- FastAPI server for REST APIs and WebSocket endpoints
- WebRTC integration for real-time streaming of images.
- Roslibpy to communicate with ROS bridges for multiple robots.
- Connection management for multiple robot clients simultaneously.
- Deployment-ready Docker setup for server hosting.

The purpose of this project is to provide a scalable backend framework for robot dashboards, enabling real-time monitoring, control, and data streaming.

## Installation (Local)

Clone the repository:

```bash
  git clone -b merged_branch git@github.com:FastaRobotics/AMR_webdashboard.git
```

Installing python dependencies:
```bash
  cd AMR_webdashboard/backend
  python3 -m venv bk_venv
  source bk_venv/bin/activate
  pip install -r requirements.txt
```

### Run Locally

After installation, for running the UI, we use uvicorn CLI:

```bash
  uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

## Testing the dashboard without robots

`fake_backend/` is a drop-in replacement for this backend: it serves the same
REST and WebSocket API (same paths, bodies, status codes and payload shapes) with
two simulated robots behind it — a warehouse AMR and a quadruped — including SLAM
mapping, frontier exploration, navigation, telemetry and the rosbag endpoints. No
ROS and no hardware required.

```powershell
pwsh -File fake_backend/run.ps1     # Windows, port 8000
```

```bash
./fake_backend/run.sh               # Linux / macOS
```

See [fake_backend/README.md](fake_backend/README.md) for the demo credentials,
what is simulated, the intentional fixes relative to this backend, and the
contract test (`tools/smoke_test.py`) that replays the dashboard's own API calls.

## Authors
- [@erfantbtb](https://github.com/erfantbtb)
