#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ADSGALAXY_APP_DIR:-/www/wwwroot/bots/AdsFusion}"
RELEASE_ROOT="${ADSGALAXY_RELEASE_ROOT:-$APP_DIR/releases}"
REVISION="$(git -C "$APP_DIR" rev-parse HEAD)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${REVISION:0:12}"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
test ! -e "$RELEASE_DIR" || { echo "release already exists: $RELEASE_DIR" >&2; exit 1; }
mkdir -p "$RELEASE_DIR"
git -C "$APP_DIR" archive "$REVISION" | tar -x -C "$RELEASE_DIR"
ln -s "$APP_DIR/node_modules" "$RELEASE_DIR/node_modules"
cp "$APP_DIR/.env" "$RELEASE_DIR/.env"
cd "$RELEASE_DIR"
NODE_ENV=production npm run build
"$APP_DIR/scripts/build-validator.sh" "$RELEASE_DIR/.next"
RELEASE_ID="$RELEASE_ID" REVISION="$REVISION" node -e 'const fs=require("fs");fs.writeFileSync("release-metadata.json",JSON.stringify({release_id:process.env.RELEASE_ID,git_revision:process.env.REVISION,built_at:new Date().toISOString(),node:process.version},null,2)+"\n")'
echo "$RELEASE_DIR"
