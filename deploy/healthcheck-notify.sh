#!/bin/bash
# Runs healthcheck.sh and emails the person in alert.conf when it keeps failing. Runs as the fts user
# from fts-health.service (every 5 minutes), so it only needs what the app already has: the SMTP_URL in
# .env and the nodemailer package of the app.
#
# A failure is announced after two runs in a row (a deploy restart lasts seconds and must not page
# anyone), repeated every 6 hours while it lasts, and followed by one mail when it is over.
# The state is "consecutive-failures last-mail-epoch announced" in the state file.
#
#   healthcheck-notify.sh                run the check (what the timer does)
#   healthcheck-notify.sh --unit NAME    mail at once that a systemd unit failed (OnFailure= hook)
#
# Limit: if the whole server or its mail server is down, nothing can be sent from here. Use an outside
# monitor (for example an uptime service on /api/health) for that case.
set -u
cd / # node looks for package.json in the current folder, which the fts user may not be able to read

ROOT=/opt/fts-workspace
CHECK=${HEALTHCHECK_CMD:-$ROOT/bin/healthcheck.sh}
STATE=${ALERT_STATE:-$ROOT/state/alert.state}
CONF=${ALERT_CONF:-$ROOT/alert.conf}
ALERT_AFTER=2
REMIND_AFTER=21600

# Read only what is needed: the file also holds values bash would misread.
env_value() { grep -m1 "^$1=" "$ROOT/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
ALERT_TO=$(grep -m1 '^ALERT_TO=' "$CONF" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')

send_mail() { # subject, body
  if [ -z "$ALERT_TO" ]; then
    echo "{\"service\":\"fts-alert\",\"message\":\"not sent: ALERT_TO is empty in $CONF\"}" >&2
    return 1
  fi
  SMTP_URL=$(env_value SMTP_URL) MAIL_FROM=$(env_value EMAIL_FROM) MAIL_TO=$ALERT_TO \
    MAIL_SUBJECT=$1 MAIL_BODY=$2 \
    /opt/plesk/node/24/bin/node -e '
      const nodemailer = require("/opt/fts-workspace/app/node_modules/nodemailer");
      nodemailer.createTransport(process.env.SMTP_URL).sendMail({
        from: process.env.MAIL_FROM,
        to: process.env.MAIL_TO,
        subject: process.env.MAIL_SUBJECT,
        text: process.env.MAIL_BODY,
      }).then(
        () => console.log("{\"service\":\"fts-alert\",\"message\":\"mail sent\"}"),
        (e) => { console.error("{\"service\":\"fts-alert\",\"message\":\"mail failed\",\"code\":\"" + (e.code || "unknown") + "\"}"); process.exit(1); },
      );'
}

footer() {
  printf '\nTime (UTC): %s\nHost: %s\nSite: https://workspace.fts-tech.co.id\nLogs: journalctl -u fts-web -u fts-worker -u fts-gateway -n 50\nUnits: systemctl list-units --failed\n' \
    "$(date -u +%FT%TZ)" "$(hostname)"
}

if [ "${1:-}" = "--unit" ]; then
  send_mail "[FTS Workspace] unit $2 failed" "The systemd unit $2 ended with an error.$(footer)"
  exit 0
fi

out=$("$CHECK" 2>&1)
rc=$?
[ -z "$out" ] || echo "$out"

mkdir -p "$(dirname "$STATE")"
fails=0 last=0 announced=0
[ -r "$STATE" ] && read -r fails last announced < "$STATE"
now=$(date +%s)

if [ $rc -eq 0 ]; then
  if [ "$announced" = 1 ]; then
    send_mail "[FTS Workspace] OK again" "The health check passes again.$(footer)" && echo "0 0 0" > "$STATE"
  else
    echo "0 0 0" > "$STATE"
  fi
else
  fails=$((fails + 1))
  if [ "$announced" = 0 ] && [ "$fails" -ge "$ALERT_AFTER" ]; then
    send_mail "[FTS Workspace] PROBLEM" "The health check failed $fails times in a row:

$out
$(footer)" && { announced=1; last=$now; }
  elif [ "$announced" = 1 ] && [ $((now - last)) -ge "$REMIND_AFTER" ]; then
    send_mail "[FTS Workspace] still failing" "The health check is still failing:

$out
$(footer)" && last=$now
  fi
  echo "$fails $last $announced" > "$STATE"
fi
exit $rc
