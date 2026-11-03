#!/bin/bash
# Deploys the main branch that Plesk Git pulled into the FTS Workspace app.
# Runs as root (Plesk calls it through sudo); the build and migrations run as the fts user,
# the same way the systemd units run the app. Keep this file root-owned: it is what sudo allows.
set -euo pipefail

BARE=/var/www/vhosts/fts-tech.co.id/git/fts-workspace.git
BRANCH=main
ROOT=/opt/fts-workspace
APP=$ROOT/app

# Plesk may call this from a directory the fts user cannot enter (backup.sh runs find there).
cd /

exec 9>/run/fts-deploy.lock
flock -n 9 || { echo "another deploy is running"; exit 1; }

as_fts() {
  systemd-run --quiet --wait --collect --pipe \
    -p User=fts -p Group=fts -p WorkingDirectory="$APP" -p EnvironmentFile=$ROOT/.env \
    -E HOME=$ROOT -E PATH=/opt/plesk/node/24/bin:/usr/bin:/bin "$@"
}

COMMIT=$(git -c safe.directory='*' --git-dir="$BARE" rev-parse --short "$BRANCH")
echo "==> deploying $COMMIT"

echo "==> backup"
runuser -u fts -- $ROOT/bin/backup.sh

echo "==> code"
STAGE=$(mktemp -d $ROOT/release.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
git -c safe.directory='*' --git-dir="$BARE" archive "$BRANCH" | tar -x -C "$STAGE"
chown -R fts:fts "$STAGE"
runuser -u fts -- rsync -a --delete \
  --exclude node_modules --exclude .next --exclude src/generated \
  --exclude '.env*' --exclude next-env.d.ts --exclude tsconfig.tsbuildinfo \
  "$STAGE"/ "$APP"/

echo "==> install, migrate, build"
as_fts /opt/plesk/node/24/bin/pnpm install --frozen-lockfile --prod=false
# `pnpm install` only runs the postinstall (prisma generate) when it installs something, so a schema
# change alone leaves the generated client stale and the build fails on types. Generate explicitly.
as_fts /opt/plesk/node/24/bin/pnpm exec prisma generate
as_fts /opt/plesk/node/24/bin/pnpm exec prisma migrate deploy
as_fts /opt/plesk/node/24/bin/pnpm exec next build

echo "==> restart"
systemctl restart fts-web fts-worker fts-gateway

for _ in $(seq 1 30); do
  if curl -fsS -m 3 http://127.0.0.1:3000/api/health > /dev/null; then
    echo "$COMMIT $(date -u +%FT%TZ)" > $ROOT/DEPLOYED
    echo "==> ok, $COMMIT is live"
    exit 0
  fi
  sleep 2
done
echo "==> health check failed after restart; see: journalctl -u fts-web -n 50" >&2
exit 1
