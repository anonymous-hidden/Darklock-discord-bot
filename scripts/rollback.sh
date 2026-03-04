#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# DarkLock Rollback Script
# Reverts to a previous commit and restarts the bot.
#
# Usage:
#   ./scripts/rollback.sh                        # Roll back to .last_good_commit
#   ./scripts/rollback.sh --commit abc1234       # Roll back to specific commit
#   ./scripts/rollback.sh --steps 1              # Roll back N commits
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_DIR}/logs"

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR"

# ── Defaults ──────────────────────────────────────────────────────
TARGET_COMMIT=""
STEPS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --commit) TARGET_COMMIT="$2"; shift 2 ;;
        --steps)  STEPS="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "FATAL: $*"; exit 1; }

CURRENT_COMMIT="$(git rev-parse HEAD)"
log "Current commit: $CURRENT_COMMIT"

# ── Determine target ─────────────────────────────────────────────
if [[ -n "$TARGET_COMMIT" ]]; then
    log "Rolling back to specified commit: $TARGET_COMMIT"
elif [[ "$STEPS" -gt 0 ]]; then
    TARGET_COMMIT="$(git rev-parse HEAD~${STEPS})"
    log "Rolling back $STEPS commits to: $TARGET_COMMIT"
elif [[ -f "${PROJECT_DIR}/.last_good_commit" ]]; then
    TARGET_COMMIT="$(cat "${PROJECT_DIR}/.last_good_commit")"
    log "Rolling back to last known good commit: $TARGET_COMMIT"
else
    die "No rollback target specified. Use --commit, --steps, or ensure .last_good_commit exists."
fi

# Verify commit exists
git cat-file -e "$TARGET_COMMIT" 2>/dev/null || die "Commit $TARGET_COMMIT does not exist in this repo."

if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]]; then
    log "Already at target commit. Nothing to do."
    exit 0
fi

# ── Step 1: Backup current state ─────────────────────────────────
log "[1/4] Backing up database before rollback..."
if [[ -x "${SCRIPT_DIR}/backup-db.sh" ]]; then
    "${SCRIPT_DIR}/backup-db.sh" --pre-update || log "WARNING: Backup returned non-zero"
fi

# ── Step 2: Checkout target ──────────────────────────────────────
log "[2/4] Checking out $TARGET_COMMIT..."
git stash push -m "pre-rollback-$(date '+%Y%m%d_%H%M%S')" 2>/dev/null || true
git checkout "$TARGET_COMMIT" -- . 2>/dev/null || git reset --hard "$TARGET_COMMIT"

log "Now at: $(git rev-parse HEAD)"

# ── Step 3: Reinstall dependencies ───────────────────────────────
log "[3/4] Installing dependencies for rolled-back version..."
npm ci --omit=dev --ignore-scripts 2>&1 || npm install --omit=dev 2>&1 || log "WARNING: npm install had issues"

# ── Step 4: Restart bot ──────────────────────────────────────────
log "[4/4] Restarting bot..."
if systemctl is-active --quiet darklock-bot.service 2>/dev/null; then
    sudo systemctl restart darklock-bot.service
elif systemctl is-active --quiet discord-bot.service 2>/dev/null; then
    sudo systemctl restart discord-bot.service
else
    BOT_PID=$(pgrep -f "node.*src/bot\\.js" 2>/dev/null | head -1 || true)
    if [[ -n "$BOT_PID" ]]; then
        kill "$BOT_PID" 2>/dev/null || true
        sleep 2
        kill -9 "$BOT_PID" 2>/dev/null || true
    fi

    NPM_PID=$(pgrep -f "npm.*start" 2>/dev/null | head -1 || true)
    if [[ -n "$NPM_PID" ]]; then
        kill "$NPM_PID" 2>/dev/null || true
        sleep 1
    fi

    cd "$PROJECT_DIR"
    nohup npm start > "${LOG_DIR}/bot_stdout.log" 2>&1 &
    log "Bot restarted with PID: $!"
fi

# ── Health check ──────────────────────────────────────────────────
sleep 5
HEALTH_URL="http://localhost:${WEB_PORT:-3001}/health"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
    log "✅ Rollback successful — health check passed"
else
    log "⚠️ Health check returned $HTTP_CODE — bot may need manual attention"
fi

log ""
log "═══════════════════════════════════════════════════════════"
log "  Rollback complete"
log "  From: $CURRENT_COMMIT"
log "  To:   $(git rev-parse HEAD)"
log "═══════════════════════════════════════════════════════════"
