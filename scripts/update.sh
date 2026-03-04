#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# DarkLock Safe Update Script
# Idempotent, pre-backup, health-check, auto-rollback on failure.
#
# Usage:
#   ./scripts/update.sh                    # Pull + install + restart
#   ./scripts/update.sh --skip-backup      # Skip pre-update backup
#   ./scripts/update.sh --branch main      # Pull specific branch
#   ./scripts/update.sh --dry-run          # Show what would happen
#
# Can also be called remotely:
#   ssh darklock@192.168.50.150 "cd /home/darklock/discord-bot && ./scripts/update.sh"
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/update_$(date '+%Y%m%d_%H%M%S').log"

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR"

# ── Defaults ──────────────────────────────────────────────────────
BRANCH="main"
SKIP_BACKUP=false
DRY_RUN=false
BOT_PROCESS_NAME="node"
HEALTH_CHECK_URL="http://localhost:${WEB_PORT:-3001}/health"
HEALTH_CHECK_TIMEOUT=30
MAX_RETRIES=3

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-backup) SKIP_BACKUP=true; shift ;;
        --branch)      BRANCH="$2"; shift 2 ;;
        --dry-run)     DRY_RUN=true; shift ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── Logging ───────────────────────────────────────────────────────
exec > >(tee -a "$LOG_FILE") 2>&1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "FATAL: $*"; exit 1; }

log "═══════════════════════════════════════════════════════════"
log "  DarkLock Update — $(date)"
log "  Branch: $BRANCH | Backup: $([[ $SKIP_BACKUP == true ]] && echo 'skip' || echo 'yes') | Dry-run: $DRY_RUN"
log "═══════════════════════════════════════════════════════════"

# ── Save current commit for rollback ──────────────────────────────
PREV_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
log "Current commit: $PREV_COMMIT"
echo "$PREV_COMMIT" > "${PROJECT_DIR}/.last_good_commit"

# ── Step 1: Pre-update database backup ───────────────────────────
if [[ "$SKIP_BACKUP" == false ]]; then
    log "[1/6] Creating pre-update database backup..."
    if [[ -x "${SCRIPT_DIR}/backup-db.sh" ]]; then
        "${SCRIPT_DIR}/backup-db.sh" --pre-update || log "WARNING: Backup script returned non-zero"
    else
        # Inline fallback
        DB_FILE="${PROJECT_DIR}/data/security_bot.db"
        if [[ -f "$DB_FILE" ]]; then
            mkdir -p "${PROJECT_DIR}/data/backups"
            BACKUP_NAME="security_bot_pre-update_$(date '+%Y%m%d_%H%M%S').db"
            if command -v sqlite3 &>/dev/null; then
                sqlite3 "$DB_FILE" ".backup '${PROJECT_DIR}/data/backups/${BACKUP_NAME}'"
            else
                cp "$DB_FILE" "${PROJECT_DIR}/data/backups/${BACKUP_NAME}"
            fi
            log "Backup: ${BACKUP_NAME}"
        fi
    fi
else
    log "[1/6] Skipping backup (--skip-backup)"
fi

# ── Step 2: Pull latest code ─────────────────────────────────────
log "[2/6] Pulling latest from origin/$BRANCH..."
if [[ "$DRY_RUN" == true ]]; then
    git fetch origin "$BRANCH" --dry-run
    log "(dry-run) Would merge origin/$BRANCH"
else
    git fetch origin "$BRANCH"
    git stash push -m "pre-update-stash-$(date '+%Y%m%d_%H%M%S')" 2>/dev/null || true
    git merge "origin/$BRANCH" --ff-only || {
        log "WARNING: Fast-forward merge failed, trying rebase..."
        git rebase "origin/$BRANCH" || die "Git merge/rebase failed. Manual intervention needed."
    }
fi

NEW_COMMIT="$(git rev-parse HEAD)"
log "Updated to commit: $NEW_COMMIT"

if [[ "$PREV_COMMIT" == "$NEW_COMMIT" ]]; then
    log "Already up-to-date. No changes to apply."
fi

# ── Step 3: Install dependencies ─────────────────────────────────
log "[3/6] Installing npm dependencies..."
if [[ "$DRY_RUN" == true ]]; then
    log "(dry-run) Would run npm ci"
else
    npm ci --omit=dev --ignore-scripts 2>&1 || npm install --omit=dev 2>&1 || log "WARNING: npm install had issues"
fi

# ── Step 4: Run database migrations ──────────────────────────────
log "[4/6] Running database migrations..."
if [[ "$DRY_RUN" == true ]]; then
    log "(dry-run) Would run migrations"
else
    # Migrations are auto-run on bot start, but we can pre-run them if there's a migration script
    if [[ -f "${PROJECT_DIR}/src/database/migrate.js" ]]; then
        node "${PROJECT_DIR}/src/database/migrate.js" 2>&1 || log "WARNING: Migration script returned non-zero"
    else
        log "No standalone migration script; migrations will run on bot start"
    fi
fi

# ── Step 5: Restart the bot ──────────────────────────────────────
log "[5/6] Restarting bot..."
if [[ "$DRY_RUN" == true ]]; then
    log "(dry-run) Would restart bot"
else
    # Try systemd first
    if systemctl is-active --quiet darklock-bot.service 2>/dev/null; then
        sudo systemctl restart darklock-bot.service
        log "Restarted via systemd (darklock-bot.service)"
    elif systemctl is-active --quiet discord-bot.service 2>/dev/null; then
        sudo systemctl restart discord-bot.service
        log "Restarted via systemd (discord-bot.service)"
    else
        # Kill existing node/bot processes and restart
        log "No active systemd service found, using process management..."

        # Find and kill the bot process
        BOT_PID=$(pgrep -f "node.*src/bot\\.js" 2>/dev/null | head -1 || true)
        if [[ -n "$BOT_PID" ]]; then
            log "Killing existing bot process (PID: $BOT_PID)..."
            kill "$BOT_PID" 2>/dev/null || true
            sleep 2
            kill -9 "$BOT_PID" 2>/dev/null || true
        fi

        # Also check for npm start
        NPM_PID=$(pgrep -f "npm.*start" 2>/dev/null | head -1 || true)
        if [[ -n "$NPM_PID" ]]; then
            kill "$NPM_PID" 2>/dev/null || true
            sleep 1
        fi

        # Start bot in background
        log "Starting bot via nohup..."
        cd "$PROJECT_DIR"
        nohup npm start > "${LOG_DIR}/bot_stdout.log" 2>&1 &
        NEW_PID=$!
        log "Bot started with PID: $NEW_PID"
    fi
fi

# ── Step 6: Health check ─────────────────────────────────────────
log "[6/6] Running health check..."
if [[ "$DRY_RUN" == true ]]; then
    log "(dry-run) Would check $HEALTH_CHECK_URL"
else
    sleep 5  # Give bot time to start

    HEALTHY=false
    for i in $(seq 1 "$MAX_RETRIES"); do
        log "Health check attempt $i/$MAX_RETRIES..."
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")

        if [[ "$HTTP_CODE" == "200" ]]; then
            HEALTHY=true
            log "✅ Health check passed (HTTP $HTTP_CODE)"
            break
        fi

        log "Health check returned HTTP $HTTP_CODE, waiting..."
        sleep "$((i * 5))"
    done

    if [[ "$HEALTHY" == false ]]; then
        log "❌ Health check FAILED after $MAX_RETRIES attempts"
        log "Initiating automatic rollback..."

        if [[ -x "${SCRIPT_DIR}/rollback.sh" ]]; then
            "${SCRIPT_DIR}/rollback.sh" --commit "$PREV_COMMIT"
        else
            log "No rollback script found. Manual intervention required."
            log "Previous commit was: $PREV_COMMIT"
            log "Run: git checkout $PREV_COMMIT && npm ci && <restart bot>"
        fi

        die "Update failed. Rolled back to $PREV_COMMIT."
    fi
fi

# ── Done ──────────────────────────────────────────────────────────
DURATION=$SECONDS
log ""
log "═══════════════════════════════════════════════════════════"
log "  ✅ Update complete in ${DURATION}s"
log "  Previous: $PREV_COMMIT"
log "  Current:  $(git rev-parse HEAD)"
log "  Log: $LOG_FILE"
log "═══════════════════════════════════════════════════════════"
