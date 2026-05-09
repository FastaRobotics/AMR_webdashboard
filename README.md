
# Fasta Backend with fastapi + fastrtc + roslibpy

This repository contains the backend for the Fasta robot dashboards, handling real-time robot data and communication.

The project covers:
- FastAPI server for REST APIs and WebSocket endpoints
- FastRTC integration for real-time streaming
- Roslibpy to communicate with ROS bridges for multiple robots
- Connection management for multiple robot clients simultaneously
- Deployment-ready Docker setup for server hosting

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

## Installation (Docker)

To run docker file you need to pull the image then run it

```bash
docker pull fastarobotics/myimage:latest
docker run -d \
  --name mycontainer \
  -p 8000:80 \
  --restart unless-stopped \
  fastarobotics/myimage:latest
```

## Authors
- [@erfantbtb](https://github.com/erfantbtb)
