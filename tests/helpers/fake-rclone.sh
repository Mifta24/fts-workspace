#!/bin/bash
# A stand-in for the few rclone commands backup-offsite.sh uses, working on plain folders.
# FAKE_RCLONE_FAIL=copy|check|delete makes that command fail.
cmd=$1; shift
[ "${FAKE_RCLONE_FAIL:-}" = "$cmd" ] && exit 1
case "$cmd" in
  copy)
    mkdir -p "$2"
    for f in "$1"/*; do [ -f "$f" ] && { [ -e "$2/$(basename "$f")" ] || cp -p "$f" "$2/"; }; done
    ;;
  check)
    for f in "$1"/*; do [ -f "$f" ] && { cmp -s "$f" "$2/$(basename "$f")" || exit 1; }; done
    ;;
  delete)
    days=${3%d}
    find "$1" -type f -mtime "+$days" -delete
    ;;
  *) exit 64 ;;
esac
