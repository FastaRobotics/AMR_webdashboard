#!/bin/bash
set -e

DEPLOY_DIR="/root/AMR_webdashboard"
REPO="git@github.com:FastaRobotics/AMR_webdashboard.git"

echo "==> Pulling latest code..."
cd "$DEPLOY_DIR"
git fetch --tags
git checkout "$1"   

echo "==> Installing dependencies..."
source venv/bin/activate
pip install -r requirements.txt --quiet

echo "==> Restarting service..."
systemctl restart backend

echo "==> Done. Status:"
systemctl status backend --no-pager

deactivate