#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${GAMECLUB_SERVICE_NAME:-gameclubtelegrambot.service}"
LINES="80"
SINCE=""
UNTIL=""
FOLLOW=0

usage() {
  cat <<'EOF'
Usage: ./scripts/service-journal.sh [options]

Shows the Game Club Telegram Bot systemd journal with the correct service,
user privileges and no pager.

Options:
  --since VALUE       Start time accepted by journalctl, e.g. "2026-05-05 18:35:00".
  --until VALUE       End time accepted by journalctl, e.g. "2026-05-05 18:50:00".
  -n, --lines COUNT   Number of recent lines when --since is not set. Default: 80.
  -f, --follow        Follow new log entries.
  --service NAME      Override service name. Default: gameclubtelegrambot.service.
  --help              Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --since)
      SINCE="${2:-}"
      [ -n "$SINCE" ] || { printf 'Missing value for --since\n' >&2; exit 2; }
      shift 2
      ;;
    --until)
      UNTIL="${2:-}"
      [ -n "$UNTIL" ] || { printf 'Missing value for --until\n' >&2; exit 2; }
      shift 2
      ;;
    -n|--lines)
      LINES="${2:-}"
      [[ "$LINES" =~ ^[0-9]+$ ]] || { printf 'Invalid line count: %s\n' "$LINES" >&2; exit 2; }
      shift 2
      ;;
    -f|--follow)
      FOLLOW=1
      shift
      ;;
    --service)
      SERVICE_NAME="${2:-}"
      [ -n "$SERVICE_NAME" ] || { printf 'Missing value for --service\n' >&2; exit 2; }
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cmd=(journalctl -u "$SERVICE_NAME" --no-pager)

if [ -n "$SINCE" ]; then
  cmd+=(--since "$SINCE")
else
  cmd+=(-n "$LINES")
fi

if [ -n "$UNTIL" ]; then
  cmd+=(--until "$UNTIL")
fi

if [ "$FOLLOW" -eq 1 ]; then
  cmd+=(-f)
fi

if [ "$(id -u)" -eq 0 ]; then
  exec "${cmd[@]}"
fi

exec sudo "${cmd[@]}"
