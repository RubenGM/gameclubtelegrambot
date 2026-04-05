#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$0")/.."
exec node "$ROOT_DIR/tools/wikipedia-boardgame-catalog-import.mjs" "$@"
