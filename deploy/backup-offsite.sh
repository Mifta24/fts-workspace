#!/bin/bash
# Copies the newest backups to a place outside this server, then checks the copy. Runs as the fts user
# from fts-backup-offsite.service, a little after fts-backup.service has written today's backup.
#
# What it needs:
#   - rclone on the server (dnf install rclone) and a remote configured for the fts user
#     (`sudo -u fts rclone config`). Use a "crypt" remote on top of the real one so the backups, which
#     hold customer data, are encrypted before they leave the server; keep the crypt password
#     somewhere that is NOT this server, or the copy cannot be read after a total loss.
#   - /opt/fts-workspace/offsite.conf (owned by fts, mode 600) with:
#       BACKUP_REMOTE="mycrypt:fts-workspace"      the rclone destination (required)
#       REMOTE_KEEP_DAYS=30                        how long copies stay at the destination (default 30)
#
# Exit codes: 0 copied and verified; 2 not configured; 3 no fresh local backup; 4 copy or check failed.
# A failure is mailed at once through OnFailure= (deploy/systemd/fts-backup-offsite.service).
set -euo pipefail

ROOT=${FTS_ROOT:-/opt/fts-workspace}
BACKUPS=${BACKUP_DIR:-$ROOT/backups}
CONF=${OFFSITE_CONF:-$ROOT/offsite.conf}
STATE=${OFFSITE_STATE:-$ROOT/state/offsite.state}
RCLONE=${RCLONE:-rclone}
FRESH_MINUTES=${FRESH_MINUTES:-1560} # 26 hours, the same limit the health check uses for the backup

log() { printf '{"service":"fts-backup-offsite","message":"%s"}\n' "$1"; }

# Read only what is needed; the file is not sourced.
conf_value() { grep -m1 "^$1=" "$CONF" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
REMOTE=$(conf_value BACKUP_REMOTE || true)
KEEP_DAYS=$(conf_value REMOTE_KEEP_DAYS || true)
KEEP_DAYS=${KEEP_DAYS:-30}

if [ -z "$REMOTE" ]; then
  log "not configured: BACKUP_REMOTE is empty or missing in $CONF"
  exit 2
fi
case "$KEEP_DAYS" in '' | *[!0-9]*) log "REMOTE_KEEP_DAYS must be a number"; exit 2 ;; esac

# Never publish an old backup as if it were today's.
if [ -z "$(find "$BACKUPS" -type f -mmin "-$FRESH_MINUTES" 2>/dev/null | head -n 1)" ]; then
  log "no backup file newer than $FRESH_MINUTES minutes in $BACKUPS"
  exit 3
fi

# --immutable: a file that already exists at the destination is never overwritten, so a damaged local
# file cannot replace a good copy. --max-age keeps each run to the recent files.
if ! "$RCLONE" copy "$BACKUPS" "$REMOTE" --max-age 48h --checksum --immutable; then
  log "copy failed"
  exit 4
fi
if ! "$RCLONE" check "$BACKUPS" "$REMOTE" --one-way --max-age 48h; then
  log "check failed: the copy differs from the local backup"
  exit 4
fi

# Copies at the destination older than the retention window are removed; failure here is not a failed backup.
"$RCLONE" delete "$REMOTE" --min-age "${KEEP_DAYS}d" || log "retention cleanup failed (copies were made)"

mkdir -p "$(dirname "$STATE")"
printf '%s\n' "$(date +%s)" >"$STATE"
log "copied and verified"
