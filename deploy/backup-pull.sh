#!/bin/bash
# Pulls the server's backups to this computer, checks them, and keeps the last 30 days.
# Run from the owner's Mac (launchd job: deploy/com.fts.backup-pull.plist), not on the server.
# It only reads from the server (rsync over the ssh host in SERVER, which needs a key that can read
# /opt/fts-workspace/backups) and never deletes anything there.
#
#   SERVER   ssh host alias (default vpsbaru)
#   DEST     local folder (default ~/fts-backups/fts-workspace)
#   KEEP_DAYS days to keep locally (default 30)
#
# The backups hold customer data: keep DEST on an encrypted disk (FileVault) and out of any cloud sync.
set -euo pipefail

SERVER=${SERVER:-vpsbaru}
DEST=${DEST:-$HOME/fts-backups/fts-workspace}
KEEP_DAYS=${KEEP_DAYS:-30}
REMOTE=/opt/fts-workspace/backups/

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$1"; }
fail() { log "FAILED: $1"; osascript -e "display notification \"$1\" with title \"FTS backup pull failed\"" >/dev/null 2>&1 || true; exit 1; }

umask 077
mkdir -p "$DEST"

# --ignore-existing: a file already here is never overwritten, so a damaged copy cannot replace a good one.
rsync -a --ignore-existing -e "ssh -o BatchMode=yes -o ConnectTimeout=20" "$SERVER:$REMOTE" "$DEST/" || fail "rsync from $SERVER"

# Newest backup set must verify against its checksum list.
LATEST=$(ls -1 "$DEST"/SHA256-*.txt 2>/dev/null | sort | tail -n 1 || true)
[ -n "$LATEST" ] || fail "no checksum list in $DEST"
(cd "$DEST" && shasum -a 256 -c "$(basename "$LATEST")" >/dev/null) || fail "checksum mismatch for $(basename "$LATEST")"

# The newest set must be recent (the server writes one every day).
if [ -z "$(find "$DEST" -name 'db-*.dump' -mtime -2 | head -n 1)" ]; then fail "no database backup newer than 2 days"; fi

find "$DEST" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'files-*.tar.gz' -o -name 'SHA256-*.txt' \) -mtime +"$KEEP_DAYS" -delete
log "ok: $(ls -1 "$DEST"/db-*.dump | wc -l | tr -d ' ') database backups, newest $(basename "$LATEST" | sed 's/SHA256-//; s/.txt//')"
