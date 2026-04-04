#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
INSTALL_AUTOSTART=0
APP_ROOT="${GAMECLUB_APP_ROOT:-/opt/gameclubtelegrambot}"

usage() {
  cat <<'EOF'
Usage: ./scripts/enable-debian-tray.sh [options]

Options:
  --dry-run            Show the commands without executing them.
  --install-autostart  Install the tray autostart desktop file for the current user.
  --app-root PATH      Override the application root used in the autostart entry.
  --help               Show this help message.

What it does:
  - Installs gnome-shell-extension-appindicator on Debian.
  - Installs the Ayatana AppIndicator GIR package used by the tray host.
  - Tries to enable the AppIndicator GNOME extension for the current session.
  - Optionally installs the Game Club tray autostart file for the current user.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Falta la comanda requerida: %s\n' "$1" >&2
    exit 1
  fi
}

log() {
  printf '[tray-setup] %s\n' "$1"
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

install_required_packages() {
  local packages=()

  if ! package_installed gnome-shell-extension-appindicator; then
    packages+=(gnome-shell-extension-appindicator)
  fi

  if ! package_installed gir1.2-ayatanaappindicator3-0.1; then
    packages+=(gir1.2-ayatanaappindicator3-0.1)
  fi

  if [ "${#packages[@]}" -eq 0 ]; then
    log 'Els paquets de safata necessaris ja estan instal·lats.'
    return 0
  fi

  log "Instal·lant paquets necessaris: ${packages[*]}"
  run_root_cmd apt-get update
  run_root_cmd apt-get install -y "${packages[@]}"
}

find_appindicator_uuid() {
  local base
  local metadata

  for base in /usr/share/gnome-shell/extensions "$HOME/.local/share/gnome-shell/extensions"; do
    [ -d "$base" ] || continue

    for metadata in "$base"/*/metadata.json; do
      [ -f "$metadata" ] || continue

      if grep -Eqi 'appindicator|kstatusnotifieritem|ayatana' "$metadata"; then
        basename "$(dirname "$metadata")"
        return 0
      fi
    done
  done

  return 1
}

enable_appindicator_extension() {
  local uuid
  local available_extensions

  if ! command -v gnome-extensions >/dev/null 2>&1; then
    log 'gnome-extensions no està disponible. Activa l extensió manualment després de la instal·lació.'
    return 0
  fi

  uuid="$(find_appindicator_uuid || true)"
  if [ -z "$uuid" ]; then
    log 'No s ha pogut localitzar la UUID de l extensió AppIndicator. Activa-la manualment des de GNOME Extensions.'
    return 0
  fi

  available_extensions="$(gnome-extensions list 2>/dev/null || true)"
  if ! printf '%s\n' "$available_extensions" | grep -Fx "$uuid" >/dev/null 2>&1; then
    log "La sessió actual de GNOME encara no reconeix l extensió $uuid."
    log 'Tanca sessió i torna a entrar, i després torna a executar aquest script o activa-la manualment des de Extensions.'
    return 0
  fi

  if gnome-extensions list --enabled 2>/dev/null | grep -Fx "$uuid" >/dev/null 2>&1; then
    log "L extensió $uuid ja està habilitada."
    return 0
  fi

  log "Intentant habilitar l extensió $uuid..."
  if run_cmd gnome-extensions enable "$uuid"; then
    log 'Extensió habilitada.'
    return 0
  fi

  log 'No s ha pogut habilitar automàticament. Pot caldre fer-ho des de la sessió gràfica activa.'
}

install_autostart_entry() {
  local source_file target_dir target_file

  source_file="$ROOT_DIR/deploy/autostart/gameclubtelegrambot-tray.desktop"
  if [ ! -f "$source_file" ]; then
    log 'No s ha trobat el fitxer d autostart al repo. S omet aquest pas.'
    return 0
  fi

  target_dir="$HOME/.config/autostart"
  target_file="$target_dir/gameclubtelegrambot-tray.desktop"

  run_cmd install -d "$target_dir"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ sed %q %q > %q\n' "s|^Exec=.*|Exec=/usr/bin/node ${APP_ROOT}/dist/scripts/debian-tray.js|" "$source_file" "$target_file"
    return 0
  fi

  sed "s|^Exec=.*|Exec=/usr/bin/node ${APP_ROOT}/dist/scripts/debian-tray.js|" "$source_file" > "$target_file"
  chmod 0644 "$target_file"
  log "Autostart instal·lat a $target_file"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --install-autostart)
      INSTALL_AUTOSTART=1
      ;;
    --app-root)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'Falta el valor per a --app-root\n' >&2
        exit 1
      fi
      APP_ROOT="$1"
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

require_command apt-get
require_command dpkg-query
require_command grep
require_command basename

install_required_packages
enable_appindicator_extension

if [ "$INSTALL_AUTOSTART" -eq 1 ]; then
  install_autostart_entry
fi

log 'Procés completat.'
log 'Si la icona encara no apareix, tanca sessió i torna a entrar a GNOME.'
