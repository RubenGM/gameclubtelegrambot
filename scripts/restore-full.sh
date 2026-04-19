#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${GAMECLUB_APP_ROOT:-/opt/gameclubtelegrambot}"
SERVICE_NAME="${GAMECLUB_SERVICE_NAME:-gameclubtelegrambot.service}"
CONFIG_DIR="/etc/gameclubtelegrambot"
CONFIG_PATH="$CONFIG_DIR/runtime.json"
ENV_PATH="$CONFIG_DIR/.env"
SERVICE_ENV_PATH="/etc/default/gameclubtelegrambot"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"
INPUT_FILE=""
START_SERVICE=1
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/restore-full.sh --input PATH [options]

Options:
  --input PATH           Full backup .zip created by backup-full.sh.
  --app-root PATH        Deployed app root used to validate runtime and run migrations. Default: /opt/gameclubtelegrambot
  --service-name NAME    Service name to stop/start. Default: gameclubtelegrambot.service
  --no-start             Restore the data but leave the service stopped.
  --dry-run              Print what would be restored without changing the machine.
  --help                 Show this help message.

What it does:
  - Extracts the backup archive to a temporary directory.
  - Restores runtime config, runtime secrets, and the Debian service env file.
  - Restores PostgreSQL from the included dump.
  - Reinstalls the saved systemd unit and polkit rule when present.
  - Validates runtime config, runs migrations, and starts the service again.
EOF
}

log() {
  printf '[restore-full] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input)
      shift
      INPUT_FILE="$1"
      ;;
    --app-root)
      shift
      APP_ROOT="$1"
      ;;
    --service-name)
      shift
      SERVICE_NAME="$1"
      SYSTEMD_UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"
      ;;
    --no-start)
      START_SERVICE=0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Opcio desconeguda: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ -z "$INPUT_FILE" ]; then
  printf 'Cal indicar --input amb el backup complet a restaurar\n' >&2
  usage >&2
  exit 1
fi

require_command basename
require_command getent
require_command install
require_command mktemp
require_command node
require_command python3
require_command rm

node "$ROOT_DIR/dist/scripts/ensure-backup-dependencies.js" psql python3 >/dev/null

if [ ! -f "$INPUT_FILE" ]; then
  printf 'No s ha trobat el backup complet: %s\n' "$INPUT_FILE" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

python3 -m zipfile -e "$INPUT_FILE" "$TMP_DIR" >/dev/null

EXTRACTED_DIRS=("$TMP_DIR"/*)
if [ ! -d "${EXTRACTED_DIRS[0]}" ]; then
  printf 'El backup no te el format esperat: no s ha trobat el directori arrel extret\n' >&2
  exit 1
fi

BACKUP_ROOT="${EXTRACTED_DIRS[0]}"
MANIFEST_PATH="$BACKUP_ROOT/metadata/manifest.txt"

manifest_value() {
  local key="$1"
  local line

  if [ ! -f "$MANIFEST_PATH" ]; then
    return 1
  fi

  while IFS= read -r line; do
    case "$line" in
      "$key="*)
        printf '%s\n' "${line#*=}"
        return 0
        ;;
    esac
  done < "$MANIFEST_PATH"

  return 1
}

if [ -f "$MANIFEST_PATH" ]; then
  APP_ROOT_FROM_MANIFEST="$(manifest_value app_root || true)"
  SERVICE_NAME_FROM_MANIFEST="$(manifest_value service_name || true)"

  if [ -n "$APP_ROOT_FROM_MANIFEST" ] && [ -z "${GAMECLUB_APP_ROOT:-}" ]; then
    APP_ROOT="$APP_ROOT_FROM_MANIFEST"
  fi

  if [ -n "$SERVICE_NAME_FROM_MANIFEST" ] && [ -z "${GAMECLUB_SERVICE_NAME:-}" ]; then
    SERVICE_NAME="$SERVICE_NAME_FROM_MANIFEST"
    SYSTEMD_UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"
  fi
fi

REQUIRED_FILES=(
  "$BACKUP_ROOT/config/runtime.json"
  "$BACKUP_ROOT/config/runtime.env"
  "$BACKUP_ROOT/config/default.env"
  "$BACKUP_ROOT/database/postgres.sql.gz"
)

for required_file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$required_file" ]; then
    printf 'Falta un fitxer obligatori dins del backup: %s\n' "$required_file" >&2
    exit 1
  fi
done

TARGET_GROUP='root'
if getent group gameclubbot >/dev/null 2>&1; then
  TARGET_GROUP='gameclubbot'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Es restauraria %q a %q\n' "$BACKUP_ROOT/config/runtime.json" "$CONFIG_PATH"
  printf 'Es restauraria %q a %q\n' "$BACKUP_ROOT/config/runtime.env" "$ENV_PATH"
  printf 'Es restauraria %q a %q\n' "$BACKUP_ROOT/config/default.env" "$SERVICE_ENV_PATH"

  if [ -f "$BACKUP_ROOT/systemd/$SERVICE_NAME" ]; then
    printf 'Es restauraria %q a %q\n' "$BACKUP_ROOT/systemd/$SERVICE_NAME" "$SYSTEMD_UNIT_PATH"
  fi

  if [ -d "$BACKUP_ROOT/polkit" ]; then
    printf 'Es restauraria el contingut de %q a %q\n' "$BACKUP_ROOT/polkit" '/etc/polkit-1/rules.d'
  fi

  printf '+ systemctl stop %q\n' "$SERVICE_NAME"
  GAMECLUB_APP_ROOT="$APP_ROOT" GAMECLUB_ENV_PATH="$BACKUP_ROOT/config/runtime.env" \
    "$ROOT_DIR/scripts/restore-postgres.sh" --config "$BACKUP_ROOT/config/runtime.json" --input "$BACKUP_ROOT/database/postgres.sql.gz" --dry-run
  printf '+ env GAMECLUB_CONFIG_PATH=%q GAMECLUB_ENV_PATH=%q /usr/bin/node %q\n' "$CONFIG_PATH" "$ENV_PATH" "$APP_ROOT/dist/scripts/check-runtime-config.js"
  printf '+ env GAMECLUB_CONFIG_PATH=%q GAMECLUB_ENV_PATH=%q /usr/bin/node %q\n' "$CONFIG_PATH" "$ENV_PATH" "$APP_ROOT/dist/scripts/migrate.js"
  if [ "$START_SERVICE" -eq 1 ]; then
    printf '+ systemctl start %q\n' "$SERVICE_NAME"
  fi
  exit 0
fi

log "Aturant el servei $SERVICE_NAME abans de restaurar la base de dades"
run_root_cmd systemctl stop "$SERVICE_NAME" || true

run_root_cmd install -d -m 0755 "$CONFIG_DIR"
run_root_cmd install -m 0640 -o root -g "$TARGET_GROUP" "$BACKUP_ROOT/config/runtime.json" "$CONFIG_PATH"
run_root_cmd install -m 0640 -o root -g "$TARGET_GROUP" "$BACKUP_ROOT/config/runtime.env" "$ENV_PATH"
run_root_cmd install -m 0644 -o root -g root "$BACKUP_ROOT/config/default.env" "$SERVICE_ENV_PATH"

if [ -f "$BACKUP_ROOT/systemd/$SERVICE_NAME" ]; then
  run_root_cmd install -m 0644 "$BACKUP_ROOT/systemd/$SERVICE_NAME" "$SYSTEMD_UNIT_PATH"
fi

if [ -d "$BACKUP_ROOT/polkit" ]; then
  run_root_cmd install -d -m 0755 /etc/polkit-1/rules.d
  for polkit_file in "$BACKUP_ROOT"/polkit/*; do
    [ -f "$polkit_file" ] || continue
    run_root_cmd install -m 0644 "$polkit_file" "/etc/polkit-1/rules.d/$(basename "$polkit_file")"
  done
fi

if [ -f "$BACKUP_ROOT/systemd/$SERVICE_NAME" ]; then
  run_root_cmd systemctl daemon-reload
fi

GAMECLUB_APP_ROOT="$APP_ROOT" GAMECLUB_ENV_PATH="$ENV_PATH" \
  "$ROOT_DIR/scripts/restore-postgres.sh" --config "$CONFIG_PATH" --input "$BACKUP_ROOT/database/postgres.sql.gz"

run_root_cmd env GAMECLUB_CONFIG_PATH="$CONFIG_PATH" GAMECLUB_ENV_PATH="$ENV_PATH" /usr/bin/node "$APP_ROOT/dist/scripts/check-runtime-config.js"
run_root_cmd env GAMECLUB_CONFIG_PATH="$CONFIG_PATH" GAMECLUB_ENV_PATH="$ENV_PATH" /usr/bin/node "$APP_ROOT/dist/scripts/migrate.js"

if [ "$START_SERVICE" -eq 1 ]; then
  run_root_cmd systemctl start "$SERVICE_NAME"
  log "Restore completat i servei arrencat: $SERVICE_NAME"
else
  log 'Restore completat amb el servei aturat per petició de l operador.'
fi
