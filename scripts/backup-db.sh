#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# DarkLock Database Backup Script
# Safely backs up SQLite database with rotation.
#
# Usage:
#   ./scripts/backup-db.sh                   # normal backup
#   ./scripts/backup-db.sh --pre-update      # tagged pre-update backup
#   ./scripts/backup-db.sh --max-keep 14     # keep last 14 backups
#
# Designed for cron:
#   0 */6 * * * /home/darklock/discord-bot/scripts/backup-db.sh >> /home/darklock/discord-bot/logs/backup.log 2>&1
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Configuration ─────────────────────────────────────────────────
DB_DIR="${PROJECT_DIR}/data"
DB_NAME="${DB_NAME:-security_bot.db}"
DB_FILE="${DB_DIR}/${DB_NAME}"
BACKUP_DIR="${DB_DIR}/backups"
MAX_KEEP="${MAX_KEEP:-10}"
TAG=""
LOG_FILE="${PROJECT_DIR}/logs/backup.log"

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --pre-update) TAG="pre-update"; shift ;;
        --max-keep)   MAX_KEEP="$2"; shift 2 ;;
        --db-file)    DB_FILE="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

die() { log "ERROR: $*"; exit 1; }

# ── Pre-checks ───────────────────────────────────────────────────
[[ -f "$DB_FILE" ]] || die "Database file not found: $DB_FILE"

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

# ── Build filename ────────────────────────────────────────────────
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
if [[ -n "$TAG" ]]; then
    BACKUP_FILE="${BACKUP_DIR}/${DB_NAME%.db}_${TAG}_${TIMESTAMP}.db"
else
    BACKUP_FILE="${BACKUP_DIR}/${DB_NAME%.db}_backup_${TIMESTAMP}.db"
fi

# ── Integrity check before backup ────────────────────────────────
log "Running integrity check on ${DB_FILE}..."
INTEGRITY=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1 || true)
if [[ "$INTEGRITY" != "ok" ]]; then
    log "WARNING: Database integrity check returned: $INTEGRITY"
    log "Proceeding with backup anyway (backup may help with recovery)..."
fi

# ── Backup using SQLite .backup command (WAL-safe) ────────────────
log "Backing up to ${BACKUP_FILE}..."
if command -v sqlite3 &>/dev/null; then
    sqlite3 "$DB_FILE" ".backup '${BACKUP_FILE}'"
else
    # Fallback: checkpoint WAL then copy
    log "sqlite3 not found, using file copy..."
    # Try to flush WAL first if possible
    cp "$DB_FILE" "$BACKUP_FILE"
    if [[ -f "${DB_FILE}-wal" ]]; then
        cp "${DB_FILE}-wal" "${BACKUP_FILE}-wal"
    fi
fi

# Verify backup
BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "0")
DB_SIZE=$(stat -f%z "$DB_FILE" 2>/dev/null || stat -c%s "$DB_FILE" 2>/dev/null || echo "0")

if [[ "$BACKUP_SIZE" -eq 0 ]]; then
    die "Backup file is empty!"
fi

log "Backup successful: ${BACKUP_FILE} (${BACKUP_SIZE} bytes, source: ${DB_SIZE} bytes)"

# ── Compress ──────────────────────────────────────────────────────
if command -v gzip &>/dev/null; then
    gzip "$BACKUP_FILE"
    BACKUP_FILE="${BACKUP_FILE}.gz"
    FINAL_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "0")
    log "Compressed to ${FINAL_SIZE} bytes"
fi

# ── Rotation: keep only MAX_KEEP most recent backups ──────────────
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "*.db*" -type f | wc -l)
if [[ "$BACKUP_COUNT" -gt "$MAX_KEEP" ]]; then
    REMOVE_COUNT=$((BACKUP_COUNT - MAX_KEEP))
    log "Rotating: removing ${REMOVE_COUNT} old backup(s) (keeping ${MAX_KEEP})..."
    find "$BACKUP_DIR" -name "*.db*" -type f -printf '%T+ %p\n' | \
        sort | head -n "$REMOVE_COUNT" | awk '{print $2}' | \
        xargs rm -f
fi

log "Done. Total backups: $(find "$BACKUP_DIR" -name "*.db*" -type f | wc -l)"
