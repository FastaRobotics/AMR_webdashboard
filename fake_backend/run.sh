#!/usr/bin/env bash
# Runs the fake backend (simulated robots, no ROS required).
#
#   ./run.sh              # port 8000, reload enabled
#   ./run.sh 8001         # custom port
#   NO_RELOAD=1 ./run.sh  # no --reload
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

PORT="${1:-8000}"
VENV="$here/.venv"
PYTHON="$VENV/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "==> creating virtual environment in $VENV"
  python3 -m venv "$VENV"
fi

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  # Keep pip's scratch space next to the venv: some sandboxed/restricted
  # environments deny writes to the machine-wide TMPDIR, which makes pip hang.
  export TMPDIR="$here/.piptmp" TEMP="$here/.piptmp" TMP="$here/.piptmp"
  mkdir -p "$TMPDIR"

  echo "==> installing requirements"
  "$PYTHON" -m pip install --disable-pip-version-check --no-cache-dir --quiet -r requirements.txt
  echo "==> installing optional WebRTC support (aiortc)"
  if ! "$PYTHON" -m pip install --disable-pip-version-check --no-cache-dir --quiet -r requirements-webrtc.txt; then
    echo "!! aiortc could not be installed; /streaming/* will answer 501. Everything else works."
  fi
fi

export FAKE_PORT="$PORT"
ARGS=(-m uvicorn api:app --host 0.0.0.0 --port "$PORT")
if [ "${NO_RELOAD:-0}" != "1" ]; then
  ARGS+=(--reload)
fi

echo "==> starting fake backend on http://127.0.0.1:$PORT"
exec "$PYTHON" "${ARGS[@]}"
