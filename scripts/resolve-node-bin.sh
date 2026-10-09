#!/usr/bin/env bash
set -euo pipefail

# Keep the bot, its maintenance commands and systemd on the same runtime.
if [ -n "${GAMECLUB_NODE_BIN:-}" ]; then
  node_bin="$GAMECLUB_NODE_BIN"
elif [ -x /opt/gameclubtelegrambot-node/bin/node ]; then
  node_bin=/opt/gameclubtelegrambot-node/bin/node
else
  node_bin="$(command -v node)"
fi

if [ ! -x "$node_bin" ]; then
  printf 'Node executable is unavailable: %s\n' "$node_bin" >&2
  exit 1
fi

"$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("The bot requires Node.js 24 LTS or newer; install it or set GAMECLUB_NODE_BIN."); process.exit(1); }'

printf '%s\n' "$node_bin"
