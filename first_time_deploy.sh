#!/bin/bash
set -e

DEPLOY_DIR="/root/AMR_webdashboard"
REPO="git@github.com:FastaRobotics/AMR_webdashboard.git"

echo "==> Cloning repository..."
git clone "$REPO" -b erfan

cd "$DEPLOY_DIR" 

echo "==> Installing dependencies..."
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt --quiet

echo "==> Restarting service..."
systemctl restart backend

echo "==> Done. Status:"
systemctl status backend --no-pager

deactivate