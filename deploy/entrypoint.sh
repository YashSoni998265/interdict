#!/usr/bin/env bash
# Seed the template (idempotent), then run the MCP tool server and the API side by side.
# If either process exits, the container stops, so the orchestrator restarts both together.
set -euo pipefail

python -m interdict.seed --alerts "${INTERDICT_ALERTS:-1000}"

python -m interdict.mcp_server &
mcp=$!
uvicorn interdict.api:app \
    --host 0.0.0.0 --port "${PORT:-8000}" \
    --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" &
api=$!

trap 'kill -TERM "$mcp" "$api" 2>/dev/null || true' TERM INT
set +e
wait -n "$mcp" "$api"
status=$?
kill -TERM "$mcp" "$api" 2>/dev/null
wait
exit "$status"
