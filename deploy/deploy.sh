#!/usr/bin/env bash
# Pulls the latest commit on DEPLOY_BRANCH, rebuilds, and restarts the app
# service. Run manually for a first deploy, or let the webhook listener
# call it automatically on every push.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${DEPLOY_BRANCH:-claude/discogs-photo-collection-app-is1u4y}"

cd "$APP_DIR"

echo "[deploy] $(date -u +%FT%TZ) fetching origin/$BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] building"
npm run build

echo "[deploy] restarting service"
sudo systemctl restart discogs-app.service

echo "[deploy] done"
