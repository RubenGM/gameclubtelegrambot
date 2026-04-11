#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--init" ]; then
  shift
  exec npm run config:init -- "$@"
fi

exec npm run config:edit -- "$@"
