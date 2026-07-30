#!/bin/sh
# One-time Agentic Wallet login for the Railway bridge container.
# Usage (inside the running service shell / railway run):
#   ff-onchainos-login
set -eu

export ONCHAINOS_HOME="${ONCHAINOS_HOME:-/data/onchainos}"
mkdir -p "$ONCHAINOS_HOME"
chmod 700 "$ONCHAINOS_HOME" 2>/dev/null || true

echo "[ff-onchainos-login] ONCHAINOS_HOME=$ONCHAINOS_HOME"
echo "[ff-onchainos-login] starting wallet login (init → open URL in your browser → poll)"

init_out="$(onchainos wallet login --phase init 2>&1)" || true
echo "$init_out"

# Extract login URL + session id from JSON-ish output without requiring jq.
url="$(printf '%s' "$init_out" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
session_id="$(printf '%s' "$init_out" | sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
if [ -z "$session_id" ]; then
  session_id="$(printf '%s' "$init_out" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi

if [ -n "$url" ]; then
  echo ""
  echo "Open this URL on your laptop and complete Google/Apple/Email login:"
  echo "$url"
  echo ""
else
  echo "Could not parse login URL from init output — check JSON above."
fi

if [ -n "$session_id" ]; then
  echo "[ff-onchainos-login] polling session_id=$session_id"
  onchainos wallet login --phase poll --session-id "$session_id"
else
  echo "[ff-onchainos-login] polling most recent init session"
  onchainos wallet login --phase poll
fi

echo "[ff-onchainos-login] wallet status:"
onchainos wallet status
echo "[ff-onchainos-login] done — restart the bridge service if it exited waiting for login."
