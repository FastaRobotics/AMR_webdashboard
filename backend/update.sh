echo "==> Pulling latest code..."
git pull origin erfan

echo "==> Installing dependencies..."
source venv/bin/activate
pip install -r requirements.txt --quiet

echo "==> Restarting service..."
systemctl restart backend

echo "==> Done. Status:"
systemctl status backend --no-pager