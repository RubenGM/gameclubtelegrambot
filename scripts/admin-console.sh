#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/admin-console.sh [options]

Options:
  --service-name NAME     Set the systemd service name. Defaults to gameclubtelegrambot.service.
  --poll-ms MS            Poll interval in milliseconds for status refresh. Defaults to 8000.
  --operator-id ID        Telegram user ID used as operator (defaults to 0).
  --config PATH           Path to runtime config JSON (GAMECLUB_CONFIG_PATH).
  --env PATH              Path to env file (GAMECLUB_ENV_PATH).
  -h, --help             Show this help and exit.

Examples:
  ./scripts/admin-console.sh
  ./scripts/admin-console.sh --service-name gameclubtelegrambot.service --poll-ms 5000
  GAMECLUB_CONFIG_PATH=config/runtime.local.json ./scripts/admin-console.sh --operator-id 123456789
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Command not found: %s\n' "$1" >&2
    exit 1
  fi
}

require_tty() {
  if [ ! -t 0 ] || [ ! -t 1 ]; then
    cat <<'EOF' >&2
La consola d'administració requereix una terminal interactiva.
Executa-la des d'una sessió SSH amb -t o des d'una terminal local.
EOF
    exit 1
  fi
}

require_command node

service_name="${GAMECLUB_SERVICE_NAME:-gameclubtelegrambot.service}"
poll_ms="${GAMECLUB_ADMIN_CONSOLE_POLL_MS:-8000}"
operator_id="${GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID:-0}"
config_path="${GAMECLUB_CONFIG_PATH:-}"
env_path="${GAMECLUB_ENV_PATH:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --service-name)
      service_name="${2-}"
      if [ -z "${service_name}" ]; then
        printf '%s requires a value.\n' "$1" >&2
        usage
        exit 1
      fi
      shift 2
      ;;
    --poll-ms)
      poll_ms="${2-}"
      if [ -z "${poll_ms}" ]; then
        printf '%s requires a value.\n' "$1" >&2
        usage
        exit 1
      fi
      if ! [[ "$poll_ms" =~ ^[0-9]+$ ]]; then
        printf '--poll-ms must be a non-negative integer.\n' >&2
        exit 1
      fi
      shift 2
      ;;
    --operator-id)
      operator_id="${2-}"
      if [ -z "${operator_id}" ]; then
        printf '%s requires a value.\n' "$1" >&2
        usage
        exit 1
      fi
      if ! [[ "$operator_id" =~ ^-?[0-9]+$ ]]; then
        printf '--operator-id must be an integer.\n' >&2
        exit 1
      fi
      shift 2
      ;;
    --config)
      config_path="${2-}"
      if [ -z "${config_path}" ]; then
        printf '%s requires a value.\n' "$1" >&2
        usage
        exit 1
      fi
      shift 2
      ;;
    --env)
      env_path="${2-}"
      if [ -z "${env_path}" ]; then
        printf '%s requires a value.\n' "$1" >&2
        usage
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      exit 1
      ;;
  esac
done

require_tty

if [ "${poll_ms}" -lt 1 ] 2>/dev/null; then
  printf 'Invalid poll interval: %s\n' "$poll_ms" >&2
  exit 1
fi

GAMECLUB_SERVICE_NAME="$service_name" \
GAMECLUB_ADMIN_CONSOLE_POLL_MS="$poll_ms" \
GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID="$operator_id" \
${config_path:+GAMECLUB_CONFIG_PATH="$config_path"} \
${env_path:+GAMECLUB_ENV_PATH="$env_path"} \
node --import tsx src/scripts/admin-console.ts
