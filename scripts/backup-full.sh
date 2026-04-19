#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${GAMECLUB_APP_ROOT:-/opt/gameclubtelegrambot}"
CONFIG_PATH="${GAMECLUB_CONFIG_PATH:-/etc/gameclubtelegrambot/runtime.json}"
ENV_PATH="${GAMECLUB_ENV_PATH:-$(dirname "$CONFIG_PATH")/.env}"
SERVICE_ENV_PATH="${GAMECLUB_SERVICE_ENV_PATH:-/etc/default/gameclubtelegrambot}"
SYSTEMD_UNIT_PATH="${GAMECLUB_SYSTEMD_UNIT_PATH:-/etc/systemd/system/gameclubtelegrambot.service}"
POLKIT_RULE_PATH="${GAMECLUB_POLKIT_RULE_PATH:-/etc/polkit-1/rules.d/50-gameclubtelegrambot.rules}"
SERVICE_NAME="${GAMECLUB_SERVICE_NAME:-gameclubtelegrambot.service}"
OUTPUT_DIR="${GAMECLUB_BACKUP_DIR:-./backups}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/backup-full.sh [options]

Options:
  --config PATH            Runtime config JSON to back up. Default: /etc/gameclubtelegrambot/runtime.json
  --env PATH               Runtime .env with secrets. Default: <config dir>/.env
  --service-env PATH       Service environment file. Default: /etc/default/gameclubtelegrambot
  --output-dir PATH        Directory where the .zip archive will be written. Default: ./backups
  --app-root PATH          Deployed app root used by helper scripts. Default: /opt/gameclubtelegrambot
  --service-name NAME      Service name for metadata. Default: gameclubtelegrambot.service
  --dry-run                Print what would be backed up without creating files.
  --help                   Show this help message.

What it does:
  - Copies runtime config files and the Debian service env file into a staging folder.
  - Creates a PostgreSQL dump using the configured runtime database.
  - Adds the installed systemd unit and polkit rule when present.
  - Packs everything into a single timestamped .zip archive.
EOF
}

log() {
  printf '[backup-full] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
}

copy_file_for_backup() {
  local source_path="$1"
  local destination_path="$2"

  if [ -r "$source_path" ]; then
    cp "$source_path" "$destination_path"
    return 0
  fi

  if [ "$(id -u)" -eq 0 ]; then
    cat "$source_path" > "$destination_path"
    return 0
  fi

  require_command sudo
  sudo cat "$source_path" > "$destination_path"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      shift
      CONFIG_PATH="$1"
      ;;
    --env)
      shift
      ENV_PATH="$1"
      ;;
    --service-env)
      shift
      SERVICE_ENV_PATH="$1"
      ;;
    --output-dir)
      shift
      OUTPUT_DIR="$1"
      ;;
    --app-root)
      shift
      APP_ROOT="$1"
      ;;
    --service-name)
      shift
      SERVICE_NAME="$1"
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

require_command basename
require_command cat
require_command cp
require_command date
require_command hostname
require_command mkdir
require_command mktemp
require_command mv
require_command node
require_command python3
require_command rm

node "$ROOT_DIR/dist/scripts/ensure-backup-dependencies.js" pg_dump python3 >/dev/null

if [ ! -f "$CONFIG_PATH" ]; then
  printf 'No s ha trobat el fitxer de configuracio runtime: %s\n' "$CONFIG_PATH" >&2
  exit 1
fi

if [ ! -f "$ENV_PATH" ]; then
  printf 'No s ha trobat el fitxer .env runtime: %s\n' "$ENV_PATH" >&2
  exit 1
fi

if [ ! -f "$SERVICE_ENV_PATH" ]; then
  printf 'No s ha trobat el fitxer d entorn del servei: %s\n' "$SERVICE_ENV_PATH" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [ "$DRY_RUN" -eq 1 ]; then
  DRY_RUN_TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$DRY_RUN_TMP_DIR"' EXIT

  mkdir -p "$DRY_RUN_TMP_DIR/config"
  copy_file_for_backup "$CONFIG_PATH" "$DRY_RUN_TMP_DIR/config/runtime.json"
  copy_file_for_backup "$ENV_PATH" "$DRY_RUN_TMP_DIR/config/runtime.env"

  printf 'Es copiaria %q a config/runtime.json\n' "$CONFIG_PATH"
  printf 'Es copiaria %q a config/runtime.env\n' "$ENV_PATH"
  printf 'Es copiaria %q a config/default.env\n' "$SERVICE_ENV_PATH"

  if [ -f "$SYSTEMD_UNIT_PATH" ]; then
    printf 'Es copiaria %q a systemd/%s\n' "$SYSTEMD_UNIT_PATH" "$SERVICE_NAME"
  fi

  if [ -f "$POLKIT_RULE_PATH" ]; then
    printf 'Es copiaria %q a polkit/%s\n' "$POLKIT_RULE_PATH" "$(basename "$POLKIT_RULE_PATH")"
  fi

  GAMECLUB_APP_ROOT="$APP_ROOT" GAMECLUB_ENV_PATH="$DRY_RUN_TMP_DIR/config/runtime.env" \
    "$ROOT_DIR/scripts/backup-postgres.sh" --config "$DRY_RUN_TMP_DIR/config/runtime.json" --output-dir '/tmp/gameclub-backup/database' --dry-run

  printf 'Es crearia un zip a %q/gameclub-backup-%s.zip\n' "$OUTPUT_DIR" "$TIMESTAMP"
  exit 0
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
ARCHIVE_PATH="$OUTPUT_DIR/gameclub-backup-$TIMESTAMP.zip"
TMP_DIR="$(mktemp -d)"
STAGING_DIR="$TMP_DIR/gameclub-backup-$TIMESTAMP"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

mkdir -p "$STAGING_DIR/config" "$STAGING_DIR/database" "$STAGING_DIR/metadata"
copy_file_for_backup "$CONFIG_PATH" "$STAGING_DIR/config/runtime.json"
copy_file_for_backup "$ENV_PATH" "$STAGING_DIR/config/runtime.env"
copy_file_for_backup "$SERVICE_ENV_PATH" "$STAGING_DIR/config/default.env"

if [ -f "$SYSTEMD_UNIT_PATH" ]; then
  mkdir -p "$STAGING_DIR/systemd"
  copy_file_for_backup "$SYSTEMD_UNIT_PATH" "$STAGING_DIR/systemd/$SERVICE_NAME"
fi

if [ -f "$POLKIT_RULE_PATH" ]; then
  mkdir -p "$STAGING_DIR/polkit"
  copy_file_for_backup "$POLKIT_RULE_PATH" "$STAGING_DIR/polkit/$(basename "$POLKIT_RULE_PATH")"
fi

GAMECLUB_APP_ROOT="$APP_ROOT" GAMECLUB_ENV_PATH="$STAGING_DIR/config/runtime.env" \
  "$ROOT_DIR/scripts/backup-postgres.sh" --config "$STAGING_DIR/config/runtime.json" --output-dir "$STAGING_DIR/database"

DUMP_FILES=("$STAGING_DIR"/database/gameclub-postgres-*.sql.gz)
if [ ! -f "${DUMP_FILES[0]}" ]; then
  printf 'No s ha generat el dump PostgreSQL dins del staging del backup complet\n' >&2
  exit 1
fi

mv "${DUMP_FILES[0]}" "$STAGING_DIR/database/postgres.sql.gz"

cat > "$STAGING_DIR/metadata/manifest.txt" <<EOF
backup_format_version=1
created_at=$TIMESTAMP
hostname=$(hostname)
app_root=$APP_ROOT
service_name=$SERVICE_NAME
config_path=$CONFIG_PATH
env_path=$ENV_PATH
service_env_path=$SERVICE_ENV_PATH
systemd_unit_path=$SYSTEMD_UNIT_PATH
polkit_rule_path=$POLKIT_RULE_PATH
EOF

cat > "$STAGING_DIR/metadata/restore-notes.txt" <<'EOF'
Restore from the repo clone with:

  ./scripts/restore-full.sh --input /path/to/gameclub-backup-YYYYMMDD-HHMMSS.zip

The archive contains:
  - config/runtime.json
  - config/runtime.env
  - config/default.env
  - database/postgres.sql.gz
  - optional systemd/ and polkit/ files when they existed on the source machine
EOF

(
  cd "$TMP_DIR"
  python3 -m zipfile -c "$ARCHIVE_PATH" "$(basename "$STAGING_DIR")" >/dev/null
)

log "Backup complet creat a: $ARCHIVE_PATH"
printf '%s\n' "$ARCHIVE_PATH"
