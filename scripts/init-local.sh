#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$0")/.."
cd "$ROOT_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command docker
require_command openssl

if ! docker compose version >/dev/null 2>&1; then
  printf 'Docker Compose no esta disponible.\n' >&2
  exit 1
fi

mkdir -p config

if [ ! -f .env.postgres.local ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 16)"
  cat > .env.postgres.local <<EOF
POSTGRES_DB=gameclub
POSTGRES_USER=gameclub_user
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_PORT=55432
EOF
fi

set -a
. ./.env.postgres.local
set +a

if [ ! -f config/runtime.local.json ]; then
  ADMIN_PASSWORD="$(openssl rand -hex 16)"
  TELEGRAM_TOKEN="${GAMECLUB_TELEGRAM_TOKEN:-REPLACE_WITH_REAL_TELEGRAM_TOKEN}"

  cat > config/runtime.local.json <<EOF
{
  "bot": {
    "publicName": "Game Club Bot",
    "clubName": "Game Club"
  },
  "telegram": {
    "token": "${TELEGRAM_TOKEN}"
  },
  "database": {
    "host": "127.0.0.1",
    "port": ${POSTGRES_PORT:-55432},
    "name": "${POSTGRES_DB}",
    "user": "${POSTGRES_USER}",
    "password": "${POSTGRES_PASSWORD}",
    "ssl": false
  },
  "adminElevation": {
    "password": "${ADMIN_PASSWORD}"
  },
  "featureFlags": {
    "bootstrapWizard": true
  }
}
EOF
fi

npm install
docker compose up -d postgres

for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi

  sleep 1
done

docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1

GAMECLUB_CONFIG_PATH=config/runtime.local.json npm run db:migrate

printf '\nPreparacio local completada.\n'
printf 'Base de dades local: postgres://%s:%s@127.0.0.1:%s/%s\n' "$POSTGRES_USER" "$POSTGRES_PASSWORD" "${POSTGRES_PORT:-55432}" "$POSTGRES_DB"
printf 'Configuracio runtime: config/runtime.local.json\n'
printf 'Per arrancar el bot: npm run start:local\n'

if grep -q 'REPLACE_WITH_REAL_TELEGRAM_TOKEN' config/runtime.local.json; then
  printf 'Encara falta posar el token real de Telegram a config/runtime.local.json\n'
  printf 'Opcionalment pots regenerar-lo fent: GAMECLUB_TELEGRAM_TOKEN=el_teu_token ./scripts/init-local.sh\n'
fi
