#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="${GAMECLUB_APP_ROOT:-/opt/gameclubtelegrambot}"
DEFAULT_CONFIG_SOURCE="$ROOT_DIR/config/runtime.json"
if [ -n "${GAMECLUB_CONFIG_PATH:-}" ]; then
  DEFAULT_CONFIG_SOURCE="$GAMECLUB_CONFIG_PATH"
elif [ -f /etc/gameclubtelegrambot/runtime.json ]; then
  DEFAULT_CONFIG_SOURCE='/etc/gameclubtelegrambot/runtime.json'
fi
CONFIG_SOURCE="${GAMECLUB_CONFIG_SOURCE:-$DEFAULT_CONFIG_SOURCE}"
OPERATOR_USER="${SUDO_USER:-$USER}"
SERVICE_NAME="${GAMECLUB_SERVICE_NAME:-gameclubtelegrambot.service}"
SKIP_APT=0
DRY_RUN=0
OPEN_TRAY=1
TRAY_FOREGROUND=0
COMPOSE_POSTGRES_MODE="auto"

DISPLAY_VALUE="${DISPLAY:-}"
DBUS_SESSION_BUS_ADDRESS_VALUE="${DBUS_SESSION_BUS_ADDRESS:-}"
XDG_RUNTIME_DIR_VALUE="${XDG_RUNTIME_DIR:-}"
XAUTHORITY_VALUE="${XAUTHORITY:-}"

usage() {
  cat <<'EOF'
Usage: ./startup.sh [options]

Central Debian startup entrypoint for Game Club Telegram Bot.

What it does:
  1. Installs prerequisites and deploys/updates the app and service.
  2. Optionally starts the local Docker Compose PostgreSQL dependency.
  3. Opens the Debian tray app for the desktop operator.
  4. Starts or restarts the bot service.

Options:
  --app-root PATH          Override the deployment root. Default: /opt/gameclubtelegrambot
  --config-source PATH     Runtime config JSON to install. Default: ./config/runtime.json
  --operator-user USER     Desktop operator that should own the tray session.
  --skip-apt               Skip apt-based package installation.
  --no-tray                Do not launch the Debian tray app.
  --foreground-tray        Launch the tray attached to the current terminal.
  --compose-postgres       Force start docker compose postgres before the bot.
  --no-compose-postgres    Never start docker compose postgres.
  --dry-run                Print commands without executing them.
  --help                   Show this help message.

Notes:
  - Run this from a graphical Debian session when you want the tray to appear.
  - By default, docker compose postgres is only started automatically for local-style configs.
EOF
}

log() {
  printf '[startup] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
}

list_matching_pids() {
  local pattern="$1"

  if command -v pgrep >/dev/null 2>&1; then
    pgrep -u "$OPERATOR_USER" -f "$pattern" || true
    return 0
  fi

  ps -u "$OPERATOR_USER" -o pid= -o args= | grep -F "$pattern" | grep -v grep | while read -r pid _; do
    printf '%s\n' "$pid"
  done
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ '
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

run_root_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ '
    if [ "$(id -u)" -ne 0 ]; then
      printf '%q ' sudo
    fi
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi

  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return 0
  fi

  require_command sudo
  sudo "$@"
}

run_as_user() {
  local target_user="$1"
  shift

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ '
    if [ "$(id -u)" -eq 0 ]; then
      printf '%q ' runuser -u "$target_user" --
    else
      printf '%q ' sudo -u "$target_user"
    fi
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi

  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$target_user" -- "$@"
    return 0
  fi

  require_command sudo
  sudo -u "$target_user" "$@"
}

looks_like_local_config() {
  if [ ! -f "$CONFIG_SOURCE" ]; then
    return 1
  fi

  if [ "$(basename "$CONFIG_SOURCE")" = 'runtime.local.json' ]; then
    return 0
  fi

  if grep -q '"host"[[:space:]]*:[[:space:]]*"127.0.0.1"' "$CONFIG_SOURCE" && grep -q '"port"[[:space:]]*:[[:space:]]*55432' "$CONFIG_SOURCE"; then
    return 0
  fi

  return 1
}

should_start_compose_postgres() {
  case "$COMPOSE_POSTGRES_MODE" in
    always)
      return 0
      ;;
    never)
      return 1
      ;;
  esac

  [ -f "$ROOT_DIR/docker-compose.yml" ] || return 1
  [ -f "$ROOT_DIR/.env.postgres.local" ] || return 1
  looks_like_local_config
}

start_compose_postgres_if_needed() {
  if ! should_start_compose_postgres; then
    log 'S omet l arrencada de PostgreSQL via docker compose.'
    return 0
  fi

  require_command docker
  if ! docker compose version >/dev/null 2>&1; then
    printf 'Docker Compose no esta disponible pero s ha demanat arrencar postgres local.\n' >&2
    exit 1
  fi

  log 'Arrencant la dependencia local PostgreSQL via docker compose.'
  run_cmd docker compose up -d postgres
}

close_existing_trays() {
  local tray_pattern host_pattern tray_pids host_pids all_pids

  tray_pattern="$APP_ROOT/dist/scripts/debian-tray.js"
  host_pattern="$APP_ROOT/scripts/debian-tray-host.py"
  tray_pids="$(list_matching_pids "$tray_pattern")"
  host_pids="$(list_matching_pids "$host_pattern")"
  all_pids="$(printf '%s\n%s\n' "$tray_pids" "$host_pids" | sed '/^$/d')"

  if [ -z "$all_pids" ]; then
    log 'No hi ha instancies anteriors del tray per tancar.'
    return 0
  fi

  log 'Tancant instancies anteriors del tray abans d obrir-ne una de nova.'

  while read -r pid; do
    [ -n "$pid" ] || continue
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '+ '
      printf '%q ' kill "$pid"
      printf '\n'
      continue
    fi
    kill "$pid" 2>/dev/null || true
  done <<< "$all_pids"

  if [ "$DRY_RUN" -eq 0 ]; then
    sleep 1
  fi
}

launch_tray_if_requested() {
  if [ "$OPEN_TRAY" -ne 1 ]; then
    log 'S omet l arrencada de la safata per petició de l operador.'
    return 0
  fi

  if [ -z "$DISPLAY_VALUE" ]; then
    log 'No hi ha cap sessió gràfica detectada (`DISPLAY` buit). S omet l obertura de la safata.'
    return 0
  fi

  if [ ! -f "$APP_ROOT/dist/scripts/debian-tray.js" ]; then
    printf 'No s ha trobat %s/dist/scripts/debian-tray.js\n' "$APP_ROOT" >&2
    exit 1
  fi

  close_existing_trays

  local tray_env=(env "DISPLAY=$DISPLAY_VALUE")
  if [ -n "$DBUS_SESSION_BUS_ADDRESS_VALUE" ]; then
    tray_env+=("DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS_VALUE")
  fi
  if [ -n "$XDG_RUNTIME_DIR_VALUE" ]; then
    tray_env+=("XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR_VALUE")
  fi
  if [ -n "$XAUTHORITY_VALUE" ]; then
    tray_env+=("XAUTHORITY=$XAUTHORITY_VALUE")
  fi
  if [ "$TRAY_FOREGROUND" -eq 1 ]; then
    tray_env+=("GAMECLUB_TRAY_FOREGROUND=1")
  fi

  log "Obrint la safata Debian per a l usuari operador $OPERATOR_USER."
  run_as_user "$OPERATOR_USER" "${tray_env[@]}" /usr/bin/node "$APP_ROOT/dist/scripts/debian-tray.js"
}

restart_or_start_service() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "En mode dry-run no es comprova l estat real de $SERVICE_NAME; es simula un reinici del servei."
    run_root_cmd systemctl restart "$SERVICE_NAME"
    return 0
  fi

  if run_root_cmd systemctl is-active --quiet "$SERVICE_NAME"; then
    log "Reiniciant el servei $SERVICE_NAME."
    run_root_cmd systemctl restart "$SERVICE_NAME"
    return 0
  fi

  log "Arrencant i habilitant el servei $SERVICE_NAME."
  run_root_cmd systemctl enable --now "$SERVICE_NAME"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-root)
      shift
      APP_ROOT="$1"
      ;;
    --config-source)
      shift
      CONFIG_SOURCE="$1"
      ;;
    --operator-user)
      shift
      OPERATOR_USER="$1"
      ;;
    --skip-apt)
      SKIP_APT=1
      ;;
    --no-tray)
      OPEN_TRAY=0
      ;;
    --foreground-tray)
      TRAY_FOREGROUND=1
      ;;
    --compose-postgres)
      COMPOSE_POSTGRES_MODE='always'
      ;;
    --no-compose-postgres)
      COMPOSE_POSTGRES_MODE='never'
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Opció desconeguda: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_command bash
require_command grep
require_command basename
require_command id
require_command systemctl
require_command ps

install_cmd=(bash "$ROOT_DIR/scripts/install-debian-stack.sh" --app-root "$APP_ROOT" --config-source "$CONFIG_SOURCE" --operator-user "$OPERATOR_USER" --no-start)
if [ "$SKIP_APT" -eq 1 ]; then
  install_cmd+=(--skip-apt)
fi
if [ "$DRY_RUN" -eq 1 ]; then
  install_cmd+=(--dry-run)
fi

log 'Preparant prerequisits, desplegament, servei i safata.'
run_cmd "${install_cmd[@]}"
start_compose_postgres_if_needed
launch_tray_if_requested
restart_or_start_service

log 'Procés de startup completat.'
log "Entrada central executada per al servei $SERVICE_NAME amb config $CONFIG_SOURCE"
