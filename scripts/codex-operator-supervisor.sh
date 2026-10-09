#!/bin/bash
set -uo pipefail

# The installed sudoers rule permits only the configured canonical binary as argv[1].
# Local operator invocations may select their own binary without crossing a UID boundary.
if [ "${1:-}" = '--local-bin' ]; then
  shift
  CODEX_OPERATOR_BIN="${1:-}"
  shift || exit 64
else
  CODEX_OPERATOR_BIN="${1:-}"
  shift || exit 64
  CODEX_OPERATOR_CONFIG="${BASH_SOURCE[0]%/*}/codex-operator-bin"
  IFS= read -r CODEX_OPERATOR_EXPECTED_BIN < "$CODEX_OPERATOR_CONFIG" || exit 64
  [ "$CODEX_OPERATOR_BIN" = "$CODEX_OPERATOR_EXPECTED_BIN" ] || exit 64
fi
case "$CODEX_OPERATOR_BIN" in /*) ;; *) exit 64 ;; esac
[ -x "$CODEX_OPERATOR_BIN" ] || exit 69

CODEX_OPERATOR_PID=''
CODEX_OPERATOR_STOP_STATUS=''
stop_codex_operator() {
  local exit_status="$1"
  trap '' TERM INT HUP
  if [ -n "$CODEX_OPERATOR_PID" ]; then
    # This supervisor runs as the operator, so both signals reach every Codex descendant.
    kill -TERM -- "-$CODEX_OPERATOR_PID" 2>/dev/null || true
    /usr/bin/sleep 0.25
    kill -KILL -- "-$CODEX_OPERATOR_PID" 2>/dev/null || true
    wait "$CODEX_OPERATOR_PID" 2>/dev/null || true
  fi
  exit "$exit_status"
}
request_codex_operator_stop() {
  if [ -z "$CODEX_OPERATOR_PID" ]; then
    CODEX_OPERATOR_STOP_STATUS="$1"
  else
    stop_codex_operator "$1"
  fi
}
trap 'request_codex_operator_stop 143' TERM
trap 'request_codex_operator_stop 130' INT
trap 'request_codex_operator_stop 129' HUP

# Noninteractive background jobs otherwise receive /dev/null as stdin.
exec 3<&0
[ -z "$CODEX_OPERATOR_STOP_STATUS" ] || exit "$CODEX_OPERATOR_STOP_STATUS"
/usr/bin/setsid -- "$CODEX_OPERATOR_BIN" "$@" <&3 &
CODEX_OPERATOR_PID=$!
exec 3<&-
[ -z "$CODEX_OPERATOR_STOP_STATUS" ] || stop_codex_operator "$CODEX_OPERATOR_STOP_STATUS"
wait "$CODEX_OPERATOR_PID"
CODEX_OPERATOR_STATUS=$?
# A normally exiting launcher must not leave descendants alive either.
if kill -0 -- "-$CODEX_OPERATOR_PID" 2>/dev/null; then
  stop_codex_operator "$CODEX_OPERATOR_STATUS"
fi
exit "$CODEX_OPERATOR_STATUS"
