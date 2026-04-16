#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_PATH="${GAMECLUB_CONFIG_PATH:-/etc/gameclubtelegrambot/runtime.json}"
ENV_PATH="${GAMECLUB_ENV_PATH:-}"
INPUT_FILE=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/restore-postgres.sh --input PATH [options]

Options:
  --input PATH         Dump .sql o .sql.gz a restaurar.
  --config PATH        Runtime config JSON to read. Default: /etc/gameclubtelegrambot/runtime.json
  --dry-run            Print the resolved restore command without executing it.
  --help               Show this help message.

What it does:
  - Reads PostgreSQL connection settings from the runtime config.
  - Restores a plain SQL dump or a gzipped SQL dump with psql.
  - Assumes the operator has already stopped the bot service before restoring.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input)
      shift
      INPUT_FILE="$1"
      ;;
    --config)
      shift
      CONFIG_PATH="$1"
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
  printf 'Cal indicar --input amb el dump a restaurar\n' >&2
  usage >&2
  exit 1
fi

require_command node

HELPER_SCRIPT="$ROOT_DIR/dist/scripts/print-database-runtime-config.js"

if [ ! -f "$HELPER_SCRIPT" ]; then
  printf 'No s ha trobat el helper compilat: %s\n' "$HELPER_SCRIPT" >&2
  printf 'Executa npm run build abans de fer restore o usa la copia desplegada a /opt/gameclubtelegrambot.\n' >&2
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  require_command psql
  require_command gzip
fi

if [ ! -f "$CONFIG_PATH" ]; then
  printf 'No s ha trobat el fitxer de configuracio runtime: %s\n' "$CONFIG_PATH" >&2
  exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
  printf 'No s ha trobat el dump a restaurar: %s\n' "$INPUT_FILE" >&2
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

if [ "$DRY_RUN" -eq 1 ]; then
  if [[ "$INPUT_FILE" == *.gz ]]; then
    printf 'gzip -dc %q | PGPASSWORD=*** psql --host %q --port %q --username %q --dbname %q --set ON_ERROR_STOP=on\n' \
      "$INPUT_FILE" "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_NAME"
  else
    printf 'PGPASSWORD=*** psql --host %q --port %q --username %q --dbname %q --set ON_ERROR_STOP=on < %q\n' \
      "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_NAME" "$INPUT_FILE"
  fi
  exit 0
fi

if [[ "$INPUT_FILE" == *.gz ]]; then
  gzip -dc "$INPUT_FILE" | PGPASSWORD="$DB_PASSWORD" psql \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --set ON_ERROR_STOP=on
else
  PGPASSWORD="$DB_PASSWORD" psql \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --set ON_ERROR_STOP=on < "$INPUT_FILE"
fi

printf 'Restore PostgreSQL completat des de: %s\n' "$INPUT_FILE"
