#!/usr/bin/env bash
set -euo pipefail

RUN_AS_USER="${GAMECLUB_CODEX_RUN_AS_USER:-cawa}"
CODEX_BIN="${GAMECLUB_CODEX_REAL_BIN:-/usr/local/bin/codex}"
CODEX_SUPERVISOR="${GAMECLUB_CODEX_SUPERVISOR_BIN:-/usr/local/libexec/gameclubtelegrambot/codex-operator-supervisor.sh}"

usage() {
  cat <<'EOF'
Usage:
  scripts/codex-cawa.sh [codex args...]
  printf 'prompt\n' | scripts/codex-cawa.sh exec --ephemeral --sandbox read-only --model gpt-5.4-mini -c 'model_reasoning_effort="low"' -

The wrapper runs Codex as GAMECLUB_CODEX_RUN_AS_USER, default cawa.
Codex runs in an operator-owned supervised process group so Stop also kills descendants.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$(id -un)" = "$RUN_AS_USER" ]; then
  if [ ! -x "$CODEX_SUPERVISOR" ]; then
    CODEX_SUPERVISOR="$(cd "$(dirname "$0")" && pwd)/codex-operator-supervisor.sh"
  fi
  exec "$CODEX_SUPERVISOR" --local-bin "$CODEX_BIN" "$@"
fi

exec sudo -n -H -u "$RUN_AS_USER" "$CODEX_SUPERVISOR" "$CODEX_BIN" "$@"
