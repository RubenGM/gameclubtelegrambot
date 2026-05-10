#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="gameclubtelegrambot.service"
BACKUP_SERVICE_NAME="gameclubtelegrambot-backup.service"
BACKUP_TIMER_NAME="gameclubtelegrambot-backup.timer"
POLKIT_RULE_PATH="/etc/polkit-1/rules.d/50-gameclubtelegrambot.rules"
SUDOERS_OPENCODE_PATH="/etc/sudoers.d/gameclubtelegrambot-opencode"
AUTOSTART_FILE_NAME="gameclubtelegrambot-tray.desktop"
OPERATOR_USER="${SUDO_USER:-$USER}"
DRY_RUN=0
REMOVE_AUTOSTART=1

usage() {
  cat <<'EOF'
Usage: ./scripts/uninstall-debian-stack.sh [options]

Options:
  --service-name NAME    systemd service unit to remove. Default: gameclubtelegrambot.service
  --operator-user USER   Desktop user whose tray autostart entry should be removed.
  --no-autostart         Do not remove the tray autostart desktop entry.
  --dry-run              Print commands without executing them.
  --help                 Show this help.

What it does:
  - Stops and disables the systemd service when present.
  - Removes the installed systemd unit file.
  - Removes the installed polkit rule for service control.
  - Removes the installed sudoers rule for OpenCode wrapper execution.
  - Removes the Game Club tray autostart entry for the operator user.
  - Reloads systemd after removing unit files.

It intentionally keeps application files, runtime config, database data, OS packages,
users, and groups. Remove those manually only when you really want a full purge.
EOF
}

log() {
  printf '[uninstall-debian-stack] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
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
  else
    sudo "$@"
  fi
}

systemd_unit_path() {
  printf '/etc/systemd/system/%s\n' "$SERVICE_NAME"
}

backup_service_unit_path() {
  printf '/etc/systemd/system/%s\n' "$BACKUP_SERVICE_NAME"
}

backup_timer_unit_path() {
  printf '/etc/systemd/system/%s\n' "$BACKUP_TIMER_NAME"
}

service_known_to_systemd() {
  local unit_listing
  unit_listing="$(systemctl list-unit-files --no-legend "$SERVICE_NAME" 2>/dev/null || true)"
  [ -n "$unit_listing" ]
}

disable_and_stop_service() {
  if [ "$DRY_RUN" -eq 1 ]; then
    run_root_cmd systemctl disable --now "$SERVICE_NAME"
    return 0
  fi

  if service_known_to_systemd; then
    log "Stopping and disabling $SERVICE_NAME"
    run_root_cmd systemctl disable --now "$SERVICE_NAME"
    return 0
  fi

  log "Service $SERVICE_NAME is not registered in systemd; skipping stop/disable."
}

remove_systemd_unit() {
  local unit_path
  unit_path="$(systemd_unit_path)"

  if [ "$DRY_RUN" -eq 1 ] || [ -e "$unit_path" ]; then
    run_root_cmd rm -f "$unit_path"
    return 0
  fi

  log "Systemd unit file is already absent: $unit_path"
}

remove_backup_units() {
  if [ "$DRY_RUN" -eq 1 ]; then
    run_root_cmd systemctl disable --now "$BACKUP_TIMER_NAME"
    run_root_cmd rm -f "$(backup_service_unit_path)" "$(backup_timer_unit_path)"
    return 0
  fi

  if systemctl list-unit-files --no-legend "$BACKUP_TIMER_NAME" 2>/dev/null | grep -q .; then
    log "Stopping and disabling $BACKUP_TIMER_NAME"
    run_root_cmd systemctl disable --now "$BACKUP_TIMER_NAME"
  fi

  run_root_cmd rm -f "$(backup_service_unit_path)" "$(backup_timer_unit_path)"
}

remove_polkit_rule() {
  if [ "$DRY_RUN" -eq 1 ] || [ -e "$POLKIT_RULE_PATH" ]; then
    run_root_cmd rm -f "$POLKIT_RULE_PATH"
    return 0
  fi

  log "Polkit rule is already absent: $POLKIT_RULE_PATH"
}

remove_opencode_sudoers_rule() {
  if [ "$DRY_RUN" -eq 1 ] || [ -e "$SUDOERS_OPENCODE_PATH" ]; then
    run_root_cmd rm -f "$SUDOERS_OPENCODE_PATH"
    return 0
  fi

  log "OpenCode sudoers rule is already absent: $SUDOERS_OPENCODE_PATH"
}

operator_home_dir() {
  getent passwd "$OPERATOR_USER" | cut -d: -f6
}

remove_operator_autostart() {
  local operator_home
  local autostart_path

  if [ "$REMOVE_AUTOSTART" -eq 0 ]; then
    log 'Skipping tray autostart removal by request.'
    return 0
  fi

  operator_home="$(operator_home_dir)"
  if [ -z "$operator_home" ]; then
    printf 'Could not resolve home directory for operator user: %s\n' "$OPERATOR_USER" >&2
    exit 1
  fi

  autostart_path="$operator_home/.config/autostart/$AUTOSTART_FILE_NAME"

  if [ "$DRY_RUN" -eq 1 ] || [ -e "$autostart_path" ]; then
    run_root_cmd rm -f "$autostart_path"
    return 0
  fi

  log "Tray autostart entry is already absent: $autostart_path"
}

reload_systemd() {
  run_root_cmd systemctl daemon-reload

  if [ "$DRY_RUN" -eq 1 ]; then
    run_root_cmd systemctl reset-failed "$SERVICE_NAME"
    return 0
  fi

  if systemctl list-units --failed "$SERVICE_NAME" >/dev/null 2>&1; then
    run_root_cmd systemctl reset-failed "$SERVICE_NAME"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --service-name)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'Missing value for --service-name\n' >&2
        exit 1
      fi
      SERVICE_NAME="$1"
      ;;
    --operator-user)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'Missing value for --operator-user\n' >&2
        exit 1
      fi
      OPERATOR_USER="$1"
      ;;
    --no-autostart)
      REMOVE_AUTOSTART=0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_command cut
require_command getent
require_command systemctl

if [ "$(id -u)" -ne 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  require_command sudo
fi

disable_and_stop_service
remove_systemd_unit
remove_backup_units
remove_polkit_rule
remove_opencode_sudoers_rule
remove_operator_autostart
reload_systemd

log 'Uninstall completed.'
log "Removed service unit: $(systemd_unit_path)"
log "Removed backup units: $(backup_service_unit_path), $(backup_timer_unit_path)"
log "Removed polkit rule: $POLKIT_RULE_PATH"
log "Removed OpenCode sudoers rule: $SUDOERS_OPENCODE_PATH"
if [ "$REMOVE_AUTOSTART" -eq 1 ]; then
  log "Removed tray autostart for operator user: $OPERATOR_USER"
fi
