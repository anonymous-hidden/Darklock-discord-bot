#!/bin/bash
set -euo pipefail

# Safe deploy helper for RFID hub changes.
# Requires SERVER_HOST and SERVER_USER env vars.

if [[ -z "${SERVER_HOST:-}" || -z "${SERVER_USER:-}" ]]; then
  echo "SERVER_HOST and SERVER_USER are required."
  echo "Example: SERVER_USER=ubuntu SERVER_HOST=darklock-pi.local bash scripts/deploy-rfid-hub.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-/mnt/nvme/discord-bot}"
SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"

echo "Preparing safe deploy preview for RFID hub..."
echo "Remote: ${SSH_TARGET}:${REMOTE_DIR}"

echo
echo "Sync command (review before running):"
echo "rsync -avz --delete \\
  --exclude '.env' \\
  --exclude '.env.*' \\
  --exclude 'node_modules' \\
  --exclude 'data' \\
  --exclude 'logs' \\
  --exclude '.git' \\
  \"${ROOT_DIR}/\" \"${SSH_TARGET}:${REMOTE_DIR}/\""

echo
echo "Server setup/check commands:"
echo "ssh ${SSH_TARGET} 'ls /dev/ttyACM* || true'"
echo "ssh ${SSH_TARGET} 'sudo usermod -aG dialout \$USER && echo relogin-required'"
echo "ssh ${SSH_TARGET} 'cd ${REMOTE_DIR} && npm install'"
echo "ssh ${SSH_TARGET} 'cd ${REMOTE_DIR} && npm run pico:test'"

echo
echo "Restart (manual confirmation recommended):"
echo "ssh ${SSH_TARGET} 'sudo systemctl restart darklock-platform'"
echo "ssh ${SSH_TARGET} 'sudo journalctl -u darklock-platform -n 100 --no-pager'"

echo
echo "No files were transferred yet. Copy the rsync command above when ready."
