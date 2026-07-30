#!/usr/bin/env bash
# Export a portable (machine-bound) onchainos home for Railway restore.
# Prefer logging in ON the Railway host with ff-onchainos-login — keyring.enc is
# bound to machine-identity and often will NOT decrypt on another host.
#
# Usage:
#   ./scripts/export-onchainos-session.sh > /tmp/onchainos-session.b64
#   # then paste into Railway secret ONCHAINOS_SESSION_ARCHIVE_B64
set -euo pipefail

HOME_DIR="${ONCHAINOS_HOME:-$HOME/.onchainos}"
if [[ ! -d "$HOME_DIR" ]]; then
  echo "ONCHAINOS_HOME not found: $HOME_DIR" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Only the files needed for an authenticated session (no caches).
for f in session.json wallets.json keyring.enc machine-identity; do
  if [[ -f "$HOME_DIR/$f" ]]; then
    cp -p "$HOME_DIR/$f" "$tmp/$f"
  fi
done

if [[ ! -f "$tmp/session.json" ]]; then
  echo "missing session.json — run: onchainos wallet login" >&2
  exit 1
fi

tar -C "$tmp" -czf - . | base64 | tr -d '\n'
echo
echo "Exported from $HOME_DIR" >&2
echo "NOTE: keyring.enc is machine-bound. If Railway restore fails decrypt, run ff-onchainos-login inside the container instead." >&2
