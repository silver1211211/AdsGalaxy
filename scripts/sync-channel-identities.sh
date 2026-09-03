#!/usr/bin/env bash
set -eu
cd /www/wwwroot/bots/AdsFusion
mkdir -p tmp
exec 9>tmp/channel-identity-sync.lock
flock -n 9 || exit 0
exec nice -n 15 /root/.nvm/versions/node/v24.15.0/bin/node scripts/sync-channel-identities.mjs
