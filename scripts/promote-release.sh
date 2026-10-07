#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ADSGALAXY_APP_DIR:-/www/wwwroot/bots/AdsFusion}"
RELEASE_DIR="$(readlink -f "${1:?usage: promote-release.sh RELEASE_DIR}")"
test -d "$RELEASE_DIR" || { echo "release directory missing" >&2; exit 1; }
"$APP_DIR/scripts/build-validator.sh" "$RELEASE_DIR/.next"
test -f "$RELEASE_DIR/release-metadata.json" || { echo "release metadata missing" >&2; exit 1; }
ln -sfn "$RELEASE_DIR" "$APP_DIR/current.next"
mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"
echo "PROMOTED_SOURCE_ONLY target=$RELEASE_DIR"
echo "PM2 was not restarted. Restart both AdsFusionApp and AdsFusionCron explicitly after verifying they use $APP_DIR/current."
