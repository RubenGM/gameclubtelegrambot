#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="${GAMECLUB_APP_ROOT:-/opt/gameclubtelegrambot}"
CONFIG_SOURCE="${GAMECLUB_CONFIG_SOURCE:-$ROOT_DIR/config/runtime.json}"
CONFIG_DIR="/etc/gameclubtelegrambot"
CONFIG_TARGET="$CONFIG_DIR/runtime.json"
ENV_TARGET="/etc/default/gameclubtelegrambot"
SERVICE_NAME="gameclubtelegrambot.service"
SERVICE_USER="gameclubbot"
SERVICE_GROUP="gameclubbot"
OPERATOR_GROUP="gameclubbot-operators"
OPERATOR_USER="${SUDO_USER:-$USER}"
INSTALL_AUTOSTART=1
START_SERVICE=1
SKIP_APT=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: ./scripts/install-debian-stack.sh [options]

Options:
  --app-root PATH        Installation root for the app. Default: /opt/gameclubtelegrambot
  --config-source PATH   Runtime config JSON to install. Default: ./config/runtime.json
  --operator-user USER   Desktop operator user that will control the tray and service.
  --no-autostart         Do not install tray autostart for the operator user.
  --no-start             Do not enable/start the systemd service.
  --skip-apt             Skip apt package installation.
  --dry-run              Print commands without executing them.
  --help                 Show this help.

What it does:
  - Installs OS packages required by the service and tray.
  - Creates service and operator groups/users if needed.
  - Copies the built app to the target root and installs production dependencies.
  - Installs runtime config and environment files under /etc.
  - Installs and enables the systemd service and polkit rule.
  - Installs GNOME AppIndicator support and tray autostart for the operator user.
EOF
}

log() {
  printf '[install-debian-stack] %s\n' "$1"
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
  else
    sudo "$@"
  fi
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
  else
    sudo -u "$target_user" "$@"
  fi
}

package_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

ensure_packages() {
  local packages=()

  if [ "$SKIP_APT" -eq 1 ]; then
    log 'S omet la instal·lació de paquets per petició de l operador.'
    return 0
  fi

  for package in rsync nodejs npm python3 python3-gi gir1.2-gtk-3.0 gir1.2-ayatanaappindicator3-0.1 gnome-shell-extension-appindicator; do
    if ! package_installed "$package"; then
      packages+=("$package")
    fi
  done

  if [ "${#packages[@]}" -eq 0 ]; then
    log 'Els paquets necessaris ja estan instal·lats.'
    return 0
  fi

  log "Instal·lant paquets necessaris: ${packages[*]}"
  run_root_cmd apt-get update
  run_root_cmd apt-get install -y "${packages[@]}"
}

ensure_groups_and_user() {
  if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    run_root_cmd groupadd --system "$SERVICE_GROUP"
  fi

  if ! getent group "$OPERATOR_GROUP" >/dev/null 2>&1; then
    run_root_cmd groupadd "$OPERATOR_GROUP"
  fi

  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    run_root_cmd useradd --system --home-dir "$APP_ROOT" --gid "$SERVICE_GROUP" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi

  run_root_cmd usermod -aG "$OPERATOR_GROUP" "$OPERATOR_USER"
}

deploy_application() {
  log "Preparant aplicació a $APP_ROOT"
  run_root_cmd install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$APP_ROOT"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ rsync -a --delete --exclude .git --exclude node_modules --exclude docs/superpowers %q/ %q/\n' "$ROOT_DIR" "$APP_ROOT"
  else
    run_root_cmd rsync -a --delete \
      --exclude .git \
      --exclude node_modules \
      --exclude docs/superpowers \
      "$ROOT_DIR/" "$APP_ROOT/"
  fi

  run_root_cmd chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_ROOT"

  run_as_user "$SERVICE_USER" npm --prefix "$APP_ROOT" ci --omit=dev
}

install_runtime_config() {
  if [ ! -f "$CONFIG_SOURCE" ]; then
    printf 'No s ha trobat el fitxer de configuració: %s\n' "$CONFIG_SOURCE" >&2
    exit 1
  fi

  run_root_cmd install -d -m 0755 "$CONFIG_DIR"
  run_root_cmd install -m 0640 -o root -g "$SERVICE_GROUP" "$CONFIG_SOURCE" "$CONFIG_TARGET"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '+ cat > %q <<EOF\nGAMECLUB_CONFIG_PATH=%s\nNODE_ENV=production\nEOF\n' "$ENV_TARGET" "$CONFIG_TARGET"
  else
    run_root_cmd /bin/sh -c "cat > '$ENV_TARGET' <<'EOF'
GAMECLUB_CONFIG_PATH=$CONFIG_TARGET
NODE_ENV=production
EOF"
  fi
}

install_service_assets() {
  local service_tmp

  service_tmp="$(mktemp)"
  trap 'rm -f "$service_tmp"' RETURN

  sed \
    -e "s|^User=.*|User=$SERVICE_USER|" \
    -e "s|^Group=.*|Group=$SERVICE_GROUP|" \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$APP_ROOT|" \
    -e "s|^ExecStart=.*|ExecStart=/usr/bin/node $APP_ROOT/dist/main.js|" \
    "$ROOT_DIR/deploy/systemd/gameclubtelegrambot.service" > "$service_tmp"

  run_root_cmd install -m 0644 "$service_tmp" "/etc/systemd/system/$SERVICE_NAME"
  run_root_cmd install -d -m 0755 /etc/polkit-1/rules.d
  run_root_cmd install -m 0644 "$ROOT_DIR/deploy/polkit/rules.d/50-gameclubtelegrambot.rules" /etc/polkit-1/rules.d/50-gameclubtelegrambot.rules
  run_root_cmd systemctl daemon-reload

  if [ "$START_SERVICE" -eq 1 ]; then
    run_root_cmd systemctl enable --now "$SERVICE_NAME"
  else
    log 'S omet l arrencada del servei per petició de l operador.'
  fi

  rm -f "$service_tmp"
  trap - RETURN
}

install_tray_support() {
  if [ "$INSTALL_AUTOSTART" -eq 0 ]; then
    log 'S omet l autostart de safata per petició de l operador.'
    return 0
  fi

  local operator_home
  operator_home="$(getent passwd "$OPERATOR_USER" | cut -d: -f6)"
  if [ -z "$operator_home" ]; then
    printf 'No s ha pogut resoldre el home de l usuari operador: %s\n' "$OPERATOR_USER" >&2
    exit 1
  fi

  run_cmd "$ROOT_DIR/scripts/enable-debian-tray.sh" --install-autostart --app-root "$APP_ROOT"
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
    --no-autostart)
      INSTALL_AUTOSTART=0
      ;;
    --no-start)
      START_SERVICE=0
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

require_command apt-get
require_command dpkg-query
require_command getent
require_command sed
require_command rsync
require_command npm
require_command node
require_command systemctl
require_command mktemp

ensure_packages
ensure_groups_and_user
deploy_application
install_runtime_config
install_service_assets
install_tray_support

log 'Instal·lació completada.'
log "Aplicació desplegada a: $APP_ROOT"
log "Configuració runtime: $CONFIG_TARGET"
log "Servei systemd: $SERVICE_NAME"
log "Usuari operador: $OPERATOR_USER"
log 'Pot caldre tancar sessió i tornar a entrar perquè els nous grups i l extensió de GNOME es reflecteixin a la sessió actual.'
