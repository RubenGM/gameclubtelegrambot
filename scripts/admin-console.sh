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
  --poll-ms MS            Accepted for compatibility. The Textual UI refreshes on demand.
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

require_command python3

service_name="${GAMECLUB_SERVICE_NAME:-gameclubtelegrambot.service}"
poll_ms="${GAMECLUB_ADMIN_CONSOLE_POLL_MS:-8000}"
operator_id="${GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID:-0}"
config_path="${GAMECLUB_CONFIG_PATH:-}"
env_path="${GAMECLUB_ENV_PATH:-}"
service_env_file="${GAMECLUB_SERVICE_ENV_FILE:-/etc/default/gameclubtelegrambot}"

if [ -f "$service_env_file" ]; then
  while IFS= read -r line; do
    case "$line" in
      GAMECLUB_CONFIG_PATH=*)
        if [ -z "$config_path" ]; then
          config_path="${line#GAMECLUB_CONFIG_PATH=}"
          config_path="${config_path%\"}"
          config_path="${config_path#\"}"
        fi
        ;;
      GAMECLUB_ENV_PATH=*)
        if [ -z "$env_path" ]; then
          env_path="${line#GAMECLUB_ENV_PATH=}"
          env_path="${env_path%\"}"
          env_path="${env_path#\"}"
        fi
        ;;
      GAMECLUB_SERVICE_NAME=*)
        if [ -z "${GAMECLUB_SERVICE_NAME:-}" ]; then
          service_name="${line#GAMECLUB_SERVICE_NAME=}"
          service_name="${service_name%\"}"
          service_name="${service_name#\"}"
        fi
        ;;
    esac
  done < "$service_env_file"
fi

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

VENV_DIR="$ROOT_DIR/.venv-admin-console"
PYTHON_BIN="$VENV_DIR/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  if ! python3 -m venv "$VENV_DIR"; then
    cat <<'EOF' >&2
No s'ha pogut crear l'entorn Python per a Textual.
En Debian/Ubuntu instal-la primer:

  sudo apt-get install -y python3-venv python3-pip

Despres torna a executar ./scripts/admin-console.sh
EOF
    exit 1
  fi
fi

if ! "$PYTHON_BIN" -c "import textual, psycopg" >/dev/null 2>&1; then
  "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements-admin-console.txt"
fi

args=(--service-name "$service_name" --operator-id "$operator_id")
if [ -n "$config_path" ]; then
  args+=(--config "$config_path")
fi
if [ -n "$env_path" ]; then
  args+=(--env "$env_path")
fi

GAMECLUB_SERVICE_NAME="$service_name" \
GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID="$operator_id" \
"$PYTHON_BIN" "$ROOT_DIR/scripts/admin-console-textual.py" "${args[@]}"
