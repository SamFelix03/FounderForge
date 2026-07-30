#!/bin/sh
set -eu

export ONCHAINOS_HOME="${ONCHAINOS_HOME:-/data/onchainos}"
export PATH="/usr/local/bin:/usr/local/lib/node_modules/.bin:${HOME:-/root}/.local/bin:${PATH}"
mkdir -p "$ONCHAINOS_HOME"
chmod 700 "$ONCHAINOS_HOME" 2>/dev/null || true

log() {
  printf '%s\n' "[marketplace-bridge] $*"
}

restore_session_archive() {
  archive_b64="${ONCHAINOS_SESSION_ARCHIVE_B64:-}"
  if [ -z "$archive_b64" ]; then
    return 0
  fi
  if [ -f "$ONCHAINOS_HOME/session.json" ] && [ -f "$ONCHAINOS_HOME/keyring.enc" ]; then
    log "session already present in ONCHAINOS_HOME — skipping archive restore"
    return 0
  fi
  log "restoring ONCHAINOS_HOME from ONCHAINOS_SESSION_ARCHIVE_B64"
  tmp="$(mktemp -d)"
  printf '%s' "$archive_b64" | base64 -d > "$tmp/session.tar.gz"
  tar -xzf "$tmp/session.tar.gz" -C "$ONCHAINOS_HOME"
  rm -rf "$tmp"
  chmod 700 "$ONCHAINOS_HOME" 2>/dev/null || true
  find "$ONCHAINOS_HOME" -type f -exec chmod 600 {} \; 2>/dev/null || true
}

wallet_ok() {
  status_out="$(onchainos wallet status 2>&1 || true)"
  case "$status_out" in
    *'"ok":true'*|*'\"ok\":true'*) return 0 ;;
  esac
  return 1
}

probe_wallet() {
  if [ "${BRIDGE_SKIP_WALLET_PROBE:-}" = "1" ] || [ "${BRIDGE_SKIP_WALLET_PROBE:-}" = "true" ]; then
    log "wallet probe skipped (BRIDGE_SKIP_WALLET_PROBE)"
    return 0
  fi
  if ! command -v onchainos >/dev/null 2>&1; then
    log "ERROR: onchainos binary missing"
    exit 1
  fi
  log "onchainos $(onchainos --version 2>/dev/null || echo unknown)"

  if wallet_ok; then
    log "wallet session ready"
    return 0
  fi

  require="${BRIDGE_REQUIRE_WALLET:-0}"
  if [ "$require" = "1" ] || [ "$require" = "true" ]; then
    log "ERROR: onchainos wallet not logged in for ONCHAINOS_HOME=$ONCHAINOS_HOME"
    log "Open a Railway shell and run: ff-onchainos-login"
    exit 1
  fi

  log "WARN: wallet not logged in yet — bridge will idle until you run ff-onchainos-login"
  log "  ONCHAINOS_HOME=$ONCHAINOS_HOME"
}

restore_session_archive
probe_wallet

# Liveness for Railway. Prefer Railway's PORT, else BRIDGE_HEALTH_PORT, else 4091.
# Set BRIDGE_HEALTH_PORT=0 to disable.
health_port="${BRIDGE_HEALTH_PORT:-}"
if [ -z "$health_port" ]; then
  health_port="${PORT:-4091}"
fi
if [ "$health_port" != "0" ]; then
  BRIDGE_HEALTH_PORT="$health_port" node -e "
const http = require('http');
const port = Number(process.env.BRIDGE_HEALTH_PORT || 4091);
http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    service: 'marketplace-bridge',
    onchainos_home: process.env.ONCHAINOS_HOME || null,
  }));
}).listen(port, '0.0.0.0', () => console.log('[marketplace-bridge] health on :' + port));
" &
fi

exec "$@"
