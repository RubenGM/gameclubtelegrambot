#!/usr/bin/env bash
set -euo pipefail

RUN_AS_USER="${GAMECLUB_OPENCODE_RUN_AS_USER:-cawa}"
OPENCODE_BIN="${GAMECLUB_OPENCODE_REAL_BIN:-/usr/local/bin/opencode}"

usage() {
  cat <<'EOF'
Usage:
  scripts/opencode-cawa.sh [opencode args...]
  scripts/opencode-cawa.sh run --stdin [opencode run options...]

Examples:
  scripts/opencode-cawa.sh models
  printf 'Responde solo OK\n' | scripts/opencode-cawa.sh run --stdin --model openai/gpt-5.4-mini
  scripts/opencode-cawa.sh run "Responde solo OK" --model openai/gpt-5.4-mini

The wrapper runs OpenCode as GAMECLUB_OPENCODE_RUN_AS_USER, default cawa.
If it is already running as that user, it execs OpenCode directly.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "run" ] && [ "${2:-}" = "--stdin" ]; then
  shift 2
  prompt="$(cat)"
  set -- run "$prompt" "$@"
fi

if [ "$(id -un)" = "$RUN_AS_USER" ]; then
  exec "$OPENCODE_BIN" "$@"
fi

exec sudo -n -H -u "$RUN_AS_USER" "$OPENCODE_BIN" "$@"
