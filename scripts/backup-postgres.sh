#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${GAMECLUB_APP_ROOT:-/opt/gameclubtelegrambot}"
CONFIG_PATH="${GAMECLUB_CONFIG_PATH:-/etc/gameclubtelegrambot/runtime.json}"
ENV_PATH="${GAMECLUB_ENV_PATH:-}"
OUTPUT_DIR="${GAMECLUB_BACKUP_DIR:-./backups}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/backup-postgres.sh [options]

Options:
  --config PATH        Runtime config JSON to read. Default: /etc/gameclubtelegrambot/runtime.json
  --output-dir PATH    Directory where the compressed dump will be written. Default: ./backups
  --dry-run            Print the resolved pg_dump command without executing it.
  --help               Show this help message.

What it does:
  - Reads PostgreSQL connection settings from the runtime config.
  - Creates a timestamped .sql.gz dump with pg_dump.
  - Leaves the service running; use it as an operator backup helper.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
}

resolve_helper_script() {
  local local_helper deployed_helper

  local_helper="$ROOT_DIR/dist/scripts/print-database-runtime-config.js"
  deployed_helper="$APP_ROOT/dist/scripts/print-database-runtime-config.js"

  if [ -f "$local_helper" ]; then
    printf '%s\n' "$local_helper"
    return 0
  fi

  if [ -f "$deployed_helper" ]; then
    printf '%s\n' "$deployed_helper"
    return 0
  fi

  printf 'No s ha trobat el helper compilat ni al repo ni al desplegament:\n' >&2
  printf '  - %s\n' "$local_helper" >&2
  printf '  - %s\n' "$deployed_helper" >&2
  printf 'Executa npm run build al clon o usa la copia desplegada a %s.\n' "$APP_ROOT" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      shift
      CONFIG_PATH="$1"
      ;;
    --output-dir)
      shift
      OUTPUT_DIR="$1"
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

require_command node
require_command mkdir
require_command date

node "$ROOT_DIR/dist/scripts/ensure-backup-dependencies.js" pg_dump python3 >/dev/null

HELPER_SCRIPT="$(resolve_helper_script)"

if [ "$DRY_RUN" -eq 0 ]; then
  require_command gzip
fi

if [ ! -f "$CONFIG_PATH" ]; then
  printf 'No s ha trobat el fitxer de configuracio runtime: %s\n' "$CONFIG_PATH" >&2
  exit 1
fi

helper_cmd=(env "GAMECLUB_CONFIG_PATH=$CONFIG_PATH")
if [ -n "$ENV_PATH" ]; then
  helper_cmd+=("GAMECLUB_ENV_PATH=$ENV_PATH")
fi
helper_cmd+=(node "$HELPER_SCRIPT")

mapfile -t DB_VALUES < <("${helper_cmd[@]}")

DB_HOST="${DB_VALUES[0]}"
DB_PORT="${DB_VALUES[1]}"
DB_NAME="${DB_VALUES[2]}"
DB_USER="${DB_VALUES[3]}"
DB_PASSWORD="${DB_VALUES[4]}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="$OUTPUT_DIR/gameclub-postgres-$TIMESTAMP.sql.gz"

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'mkdir -p %q\n' "$OUTPUT_DIR"
  printf 'PGPASSWORD=*** pg_dump --host %q --port %q --username %q --dbname %q --clean --if-exists --no-owner --no-privileges | gzip > %q\n' \
    "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_NAME" "$OUTPUT_FILE"
  exit 0
fi

mkdir -p "$OUTPUT_DIR"
PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges | gzip > "$OUTPUT_FILE"

printf 'Backup PostgreSQL creat a: %s\n' "$OUTPUT_FILE"
