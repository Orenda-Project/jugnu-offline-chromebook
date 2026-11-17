#!/bin/sh
# Run this copy of the pilot on a laptop against sandbox Jugnu, with the secrets read from a private folder (never
# from this repo):  P=<private folder> PORT=8813 sh rig/serve.sh
#   $P/device-key.txt  $P/roster-*.json  $P/sandbox-internal-key.txt  (and ./cb-config.json, git-ignored)
# HOME_TTL_S=45 makes a signed home run out in 45 s, to watch it being renewed.
# READY_ONLY=videos.js offers only that Get-ready step file (a quick run of one area).
set -e
cd "$(dirname "$0")/.."
: "${P:?set P to the private folder}"
export UPSTREAM="${UPSTREAM:-https://portal-sandbox.up.railway.app}"
export CB_CONFIG="$(cat cb-config.json)"
export DEVICE_KEY="$(cat "$P/device-key.txt")"
export ROSTER_FILE="${ROSTER_FILE:-$(ls "$P"/roster-*.json | head -1)}"
export HUB_SIGNING_KEY="$(INTERNAL_API_KEY="$(cat "$P/sandbox-internal-key.txt")" node tools/derive-hub-key.mjs)"
export PORT="${PORT:-8813}"
exec node server.mjs
