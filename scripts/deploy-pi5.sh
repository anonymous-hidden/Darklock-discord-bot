#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# DarkLock Remote Deploy — Push local changes to Pi5
#
# This script syncs changed files to the Raspberry Pi 5 and
# optionally restarts the bot.
#
# Usage:
#   ./scripts/deploy-pi5.sh                    # Sync + restart
#   ./scripts/deploy-pi5.sh --sync-only        # Only sync files
#   ./scripts/deploy-pi5.sh --dry-run          # Show what would sync
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Configuration ─────────────────────────────────────────────────
PI_HOST="${PI_HOST:-192.168.50.150}"
PI_USER="${PI_USER:-darklock}"
PI_PASS="${PI_PASS:-0131106761Cb}"
PI_BOT_DIR="${PI_BOT_DIR:-/home/darklock/discord-bot}"
SYNC_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --sync-only) SYNC_ONLY=true; shift ;;
        --dry-run)   DRY_RUN=true; shift ;;
        --host)      PI_HOST="$2"; shift 2 ;;
        --user)      PI_USER="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Check for sshpass
if ! command -v sshpass &>/dev/null; then
    log "Installing sshpass..."
    sudo apt-get install -y sshpass 2>/dev/null || {
        log "ERROR: sshpass not available. Install it or use SSH keys."
        exit 1
    }
fi

SSH_CMD="sshpass -p '$PI_PASS' ssh -o StrictHostKeyChecking=no ${PI_USER}@${PI_HOST}"
RSYNC_CMD="sshpass -p '$PI_PASS' rsync"

# ── Step 1: Sync files ───────────────────────────────────────────
log "Syncing files to ${PI_USER}@${PI_HOST}:${PI_BOT_DIR}..."

RSYNC_OPTS=(
    -avz
    --delete
    --exclude 'node_modules/'
    --exclude '.git/'
    --exclude 'data/*.db'
    --exclude 'data/*.db-wal'
    --exclude 'data/*.db-shm'
    --exclude 'data/backups/'
    --exclude 'data/snapshots/'
    --exclude 'logs/'
    --exclude '.env'
    --exclude '__pycache__/'
    --exclude 'temp/'
    --exclude 'uploads/'
    --exclude '.last_good_commit'
    -e "sshpass -p '${PI_PASS}' ssh -o StrictHostKeyChecking=no"
)

if [[ "$DRY_RUN" == true ]]; then
    RSYNC_OPTS+=(--dry-run)
fi

rsync "${RSYNC_OPTS[@]}" "${PROJECT_DIR}/" "${PI_USER}@${PI_HOST}:${PI_BOT_DIR}/"

log "File sync complete"

if [[ "$DRY_RUN" == true ]]; then
    log "(dry-run) Would install dependencies and restart bot"
    exit 0
fi

if [[ "$SYNC_ONLY" == true ]]; then
    log "Sync-only mode. Skipping dependency install and restart."
    exit 0
fi

# ── Step 2: Install deps on Pi ────────────────────────────────────
log "Installing dependencies on Pi5..."
eval "$SSH_CMD" "cd '${PI_BOT_DIR}' && npm ci --omit=dev 2>&1 | tail -5" || {
    log "npm ci failed, trying npm install..."
    eval "$SSH_CMD" "cd '${PI_BOT_DIR}' && npm install --omit=dev 2>&1 | tail -5"
}

# ── Step 3: Pre-deploy backup ────────────────────────────────────
log "Running pre-deploy backup on Pi5..."
eval "$SSH_CMD" "cd '${PI_BOT_DIR}' && bash scripts/backup-db.sh --pre-update 2>&1 | tail -3" || log "Backup skipped (non-fatal)"

# ── Step 4: Restart bot ──────────────────────────────────────────
log "Restarting bot on Pi5..."
eval "$SSH_CMD" "cd '${PI_BOT_DIR}' && {
    # Kill existing bot
    pkill -f 'node.*src/bot.js' 2>/dev/null || true
    pkill -f 'npm.*start' 2>/dev/null || true
    sleep 2

    # Start fresh
    nohup npm start > logs/bot_stdout.log 2>&1 &
    echo \"Bot started with PID: \$!\"
}"

# ── Step 5: Health check ─────────────────────────────────────────
log "Waiting for bot to start..."
sleep 8

HEALTH_OK=false
for i in 1 2 3; do
    HTTP_CODE=$(eval "$SSH_CMD" "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://localhost:3001/health" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        HEALTH_OK=true
        break
    fi
    log "Health check attempt $i returned $HTTP_CODE, waiting..."
    sleep 5
done

if [[ "$HEALTH_OK" == true ]]; then
    log "✅ Deploy to Pi5 successful — bot is healthy"
else
    log "⚠️ Health check failed — bot may need manual attention"
    log "SSH in: ssh ${PI_USER}@${PI_HOST}"
fi
