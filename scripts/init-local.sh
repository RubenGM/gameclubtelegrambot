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

npm install

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
  ADMIN_PASSWORD_HASH="$(GAMECLUB_SECRET_TO_HASH="$ADMIN_PASSWORD" node --import tsx -e "import { hashSecret } from './src/security/password-hash.ts'; const secret = process.env.GAMECLUB_SECRET_TO_HASH; if (!secret) throw new Error('Missing secret to hash'); console.log(await hashSecret(secret));")"
  TELEGRAM_TOKEN="${GAMECLUB_TELEGRAM_TOKEN:-REPLACE_WITH_REAL_TELEGRAM_TOKEN}"
  FIRST_ADMIN_TELEGRAM_USER_ID="${GAMECLUB_FIRST_ADMIN_TELEGRAM_USER_ID:-1}"
  FIRST_ADMIN_USERNAME="${GAMECLUB_FIRST_ADMIN_USERNAME:-club_admin}"
  FIRST_ADMIN_DISPLAY_NAME="${GAMECLUB_FIRST_ADMIN_DISPLAY_NAME:-Club Administrator}"
  BGG_API_KEY="${GAMECLUB_BGG_API_KEY:-REPLACE_WITH_REAL_BGG_API_KEY}"

  cat > config/.env <<EOF
GAMECLUB_TELEGRAM_TOKEN=${TELEGRAM_TOKEN}
GAMECLUB_BGG_API_KEY=${BGG_API_KEY}
GAMECLUB_DATABASE_PASSWORD=${POSTGRES_PASSWORD}
GAMECLUB_ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}
EOF

  cat > config/runtime.local.json <<EOF
{
  "schemaVersion": 1,
  "bot": {
    "publicName": "Game Club Bot",
    "clubName": "Game Club"
  },
  "database": {
    "host": "127.0.0.1",
    "port": ${POSTGRES_PORT:-55432},
    "name": "${POSTGRES_DB}",
    "user": "${POSTGRES_USER}",
    "ssl": false
  },
  "bootstrap": {
    "firstAdmin": {
      "telegramUserId": ${FIRST_ADMIN_TELEGRAM_USER_ID},
      "username": "${FIRST_ADMIN_USERNAME}",
      "displayName": "${FIRST_ADMIN_DISPLAY_NAME}"
    }
  },
  "notifications": {
    "defaults": {
      "groupAnnouncementsEnabled": true,
      "eventRemindersEnabled": true,
      "eventReminderLeadHours": 24
    }
  },
  "featureFlags": {
    "bootstrapWizard": true
  }
}
EOF
fi

docker compose up -d postgres

for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi

  sleep 1
done

docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1

GAMECLUB_CONFIG_PATH=config/runtime.local.json npm run db:migrate
GAMECLUB_CONFIG_PATH=config/runtime.local.json node --import tsx src/scripts/ensure-local-bootstrap.ts

printf '\nPreparacio local completada.\n'
printf 'Base de dades local: postgres://%s:%s@127.0.0.1:%s/%s\n' "$POSTGRES_USER" "$POSTGRES_PASSWORD" "${POSTGRES_PORT:-55432}" "$POSTGRES_DB"
printf 'Configuracio runtime: config/runtime.local.json\n'
printf 'Secrets runtime: config/.env\n'
printf 'Per arrancar el bot: npm run start:local\n'

if [ -n "${ADMIN_PASSWORD:-}" ]; then
  printf 'Contrasenya d elevacio administrativa generada: %s\n' "$ADMIN_PASSWORD"
fi

if grep -q 'REPLACE_WITH_REAL_TELEGRAM_TOKEN' config/.env; then
  printf 'Encara falta posar el token real de Telegram a config/.env\n'
  printf 'Opcionalment pots regenerar-lo fent: GAMECLUB_TELEGRAM_TOKEN=el_teu_token ./scripts/init-local.sh\n'
fi
