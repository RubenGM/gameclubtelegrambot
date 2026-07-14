#!/usr/bin/env bash
set -euo pipefail

INSTALL_PREFIX="${GAMECLUB_TELEGRAM_BOT_API_INSTALL_PREFIX:-/usr/local}"
SOURCE_DIR="${GAMECLUB_TELEGRAM_BOT_API_SOURCE_DIR:-/var/tmp/gameclubtelegrambot-telegram-bot-api-src}"
BUILD_DIR="${GAMECLUB_TELEGRAM_BOT_API_BUILD_DIR:-/var/tmp/gameclubtelegrambot-telegram-bot-api-build}"
GIT_REF="${GAMECLUB_TELEGRAM_BOT_API_GIT_REF:-}"
SKIP_APT=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/install-telegram-bot-api.sh [options]

Builds and installs the official TDLib Telegram Bot API server from source.

Options:
  --install-prefix PATH   Install prefix. Default: /usr/local
  --source-dir PATH       Source checkout dir. Default: /var/tmp/gameclubtelegrambot-telegram-bot-api-src
  --build-dir PATH        Build dir. Default: /var/tmp/gameclubtelegrambot-telegram-bot-api-build
  --git-ref REF           Optional git ref to checkout before building.
  --skip-apt              Do not install build dependencies.
  --dry-run               Print commands without executing them.
  --help                  Show this help.

The resulting binary is expected at INSTALL_PREFIX/bin/telegram-bot-api.
EOF
}

log() {
  printf '[install-telegram-bot-api] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
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

package_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

ensure_packages() {
  local packages=()

  if [ "$SKIP_APT" -eq 1 ]; then
    log 'S omet la instal·lació de dependències de compilació per petició de l operador.'
    return 0
  fi

  for package in ca-certificates git make g++ cmake gperf zlib1g-dev libssl-dev; do
    if ! package_installed "$package"; then
      packages+=("$package")
    fi
  done

  if [ "${#packages[@]}" -eq 0 ]; then
    log 'Les dependències de compilació ja estan instal·lades.'
    return 0
  fi

  log "Instal·lant dependències de compilació: ${packages[*]}"
  run_root_cmd apt-get update
  run_root_cmd apt-get install -y "${packages[@]}"
}

clone_or_update_source() {
  if [ -d "$SOURCE_DIR/.git" ]; then
    log "Actualitzant checkout existent a $SOURCE_DIR"
    run_cmd git -C "$SOURCE_DIR" fetch --tags --recurse-submodules origin
  else
    log "Clonant telegram-bot-api a $SOURCE_DIR"
    run_cmd rm -rf "$SOURCE_DIR"
    run_cmd git clone --recursive https://github.com/tdlib/telegram-bot-api.git "$SOURCE_DIR"
  fi

  if [ -n "$GIT_REF" ]; then
    run_cmd git -C "$SOURCE_DIR" checkout "$GIT_REF"
  fi

  run_cmd git -C "$SOURCE_DIR" submodule update --init --recursive
}

build_and_install() {
  local jobs binary_path

  jobs="$(nproc 2>/dev/null || printf '1')"
  binary_path="$INSTALL_PREFIX/bin/telegram-bot-api"

  log "Compilant telegram-bot-api amb $jobs processos"
  run_cmd cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$INSTALL_PREFIX"
  run_cmd cmake --build "$BUILD_DIR" -j "$jobs"
  run_root_cmd cmake --build "$BUILD_DIR" --target install -j "$jobs"

  if [ "$DRY_RUN" -eq 0 ] && [ ! -x "$binary_path" ]; then
    printf 'No s ha trobat el binari esperat despres de la instal·lació: %s\n' "$binary_path" >&2
    exit 1
  fi

  log "telegram-bot-api instal·lat a $binary_path"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-prefix)
      shift
      INSTALL_PREFIX="$1"
      ;;
    --source-dir)
      shift
      SOURCE_DIR="$1"
      ;;
    --build-dir)
      shift
      BUILD_DIR="$1"
      ;;
    --git-ref)
      shift
      GIT_REF="$1"
      ;;
    --skip-apt)
      SKIP_APT=1
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

require_command grep
require_command dpkg-query

ensure_packages
require_command git
require_command cmake
clone_or_update_source
build_and_install
