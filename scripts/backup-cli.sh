#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_BACKUP_DIR="$ROOT_DIR/backups"
BACKUP_FULL_SCRIPT="$SCRIPT_DIR/backup-full.sh"
BACKUP_RESTORE_SCRIPT="$SCRIPT_DIR/restore-full.sh"
DEPENDENCY_CHECKER="$ROOT_DIR/dist/scripts/ensure-backup-dependencies.js"

usage() {
  cat <<'EOF'
Usage: ./scripts/backup-cli.sh <command> [options]

Commands:
  backup [--output-dir PATH] [--dry-run] [--app-root PATH] [--config PATH]
         [--env PATH] [--service-env PATH] [--service-name NAME]
      Create a full backup (wrapper around backup-full.sh).

  restore <backup-zip> [--no-start] [--dry-run] [--app-root PATH] [--service-name NAME]
      Restore a full backup zip.

  list [--output-dir PATH] [--latest]
      List gameclub-backup zip files, newest first.

  status [--output-dir PATH]
      Show backup directory status, dependency state and latest backup.

  -h, --help
      Show this help and exit.

Examples:
  ./scripts/backup-cli.sh backup --output-dir /var/backups/gameclub
  ./scripts/backup-cli.sh restore /var/backups/gameclub/gameclub-backup-20260419-155001.zip
  ./scripts/backup-cli.sh list --output-dir /var/backups/gameclub
  ./scripts/backup-cli.sh status
EOF
}

require_value() {
  local name="$1"
  local value="${2-}"

  if [ -z "$value" ]; then
    printf '%s requires a value.\n' "$name" >&2
    usage
    exit 1
  fi
}

list_backups() {
  local backup_dir="$1"
  local -n target_array=$2

  target_array=()

  if [ ! -d "$backup_dir" ]; then
    return 0
  fi

  mapfile -t target_array < <(ls -1t -- "$backup_dir"/gameclub-backup-*.zip 2>/dev/null || true)
}

format_size() {
  local bytes="$1"

  if [ "$bytes" -ge 1073741824 ]; then
    printf '%d GiB' "$((bytes / 1073741824))"
    return
  fi

  if [ "$bytes" -ge 1048576 ]; then
    printf '%d MiB' "$((bytes / 1048576))"
    return
  fi

  if [ "$bytes" -ge 1024 ]; then
    printf '%d KiB' "$((bytes / 1024))"
    return
  fi

  printf '%d B' "$bytes"
}

run_backup() {
  local output_dir="$DEFAULT_BACKUP_DIR"
  local output_dir_overridden=0
  local args=()
  local arg

  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift

    case "$arg" in
      --output-dir)
        require_value "$arg" "${1-}"
        output_dir="$1"
        output_dir_overridden=1
        args+=(--output-dir "$output_dir")
        shift
        ;;
      --app-root|--config|--env|--service-env|--service-name)
        require_value "$arg" "${1-}"
        args+=("$arg" "$1")
        shift
        ;;
      --dry-run)
        args+=(--dry-run)
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n' "$arg" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [ "$output_dir_overridden" -eq 0 ]; then
    args+=(--output-dir "$output_dir")
  fi

  "$BACKUP_FULL_SCRIPT" "${args[@]}"
}

run_restore() {
  local input_file=""
  local input_set=0
  local args=()
  local arg

  if [ "$#" -gt 0 ] && [[ "$1" != --* ]]; then
    input_file="$1"
    input_set=1
    shift
  fi

  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift

    case "$arg" in
      --input)
        require_value "$arg" "${1-}"
        input_file="$1"
        input_set=1
        args+=(--input "$input_file")
        shift
        ;;
      --app-root|--service-name)
        require_value "$arg" "${1-}"
        args+=("$arg" "$1")
        shift
        ;;
      --no-start|--dry-run)
        args+=("$arg")
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n' "$arg" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [ -z "$input_file" ]; then
    printf 'Missing backup file. Usage: ./scripts/backup-cli.sh restore <backup-zip>\n' >&2
    exit 1
  fi

  if [ "$input_set" -eq 0 ] || [[ "${args[*]-}" != *"--input"* ]]; then
    args=(--input "$input_file" "${args[@]}")
  fi

  "$BACKUP_RESTORE_SCRIPT" "${args[@]}"
}

run_list() {
  local output_dir="$DEFAULT_BACKUP_DIR"
  local latest_only=0
  local arg
  local -a backups

  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift

    case "$arg" in
      --output-dir)
        require_value "$arg" "${1-}"
        output_dir="$1"
        shift
        ;;
      --latest)
        latest_only=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n' "$arg" >&2
        usage
        exit 1
        ;;
    esac
  done

  list_backups "$output_dir" backups

  if [ "${#backups[@]}" -eq 0 ]; then
    printf 'No backups found in %s\n' "$output_dir"
    return 0
  fi

  if [ "$latest_only" -eq 1 ]; then
    echo "${backups[0]}"
    return 0
  fi

  printf '%-45s %-10s %s\n' 'Archive' 'Size' 'Created (UTC)'

  for backup in "${backups[@]}"; do
    local size
    local created_at

    size=$(stat -c '%s' "$backup")
    created_at=$(date -u -d "@$(stat -c '%Y' "$backup")" +'%Y-%m-%d %H:%M')
    printf '%-45s %-10s %s\n' "$(basename "$backup")" "$(format_size "$size")" "$created_at"
  done
}

run_status() {
  local output_dir="$DEFAULT_BACKUP_DIR"
  local arg
  local -a backups

  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift

    case "$arg" in
      --output-dir)
        require_value "$arg" "${1-}"
        output_dir="$1"
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n' "$arg" >&2
        usage
        exit 1
        ;;
    esac
  done

  echo "Backup dir: $output_dir"

  list_backups "$output_dir" backups
  echo "Backups: ${#backups[@]}"

  if [ "${#backups[@]}" -gt 0 ]; then
    echo "Latest: $(basename "${backups[0]}")"
  fi

  if [ ! -f "$DEPENDENCY_CHECKER" ]; then
    echo "Dependency checker not found at $DEPENDENCY_CHECKER (run npm run build)."
    return 1
  fi

  echo "Dependencies (check-only):"
  GAMECLUB_BACKUP_DIR="$output_dir" node "$DEPENDENCY_CHECKER" --check-only pg_dump psql python3
}

main() {
  if [ "$#" -eq 0 ]; then
    usage
    exit 1
  fi

  local command="$1"
  shift

  case "$command" in
    backup|create)
      run_backup "$@"
      ;;
    restore)
      run_restore "$@"
      ;;
    list)
      run_list "$@"
      ;;
    status)
      run_status "$@"
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      printf 'Unknown command: %s\n' "$command" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
