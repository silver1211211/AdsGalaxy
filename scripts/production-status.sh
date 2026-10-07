#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ADSGALAXY_APP_DIR:-/www/wwwroot/bots/AdsFusion}"
cd "$APP_DIR"
echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "hostname=$(hostname)"
echo "git_branch=$(git branch --show-current 2>/dev/null || echo unavailable)"
echo "git_head=$(git rev-parse HEAD 2>/dev/null || echo unavailable)"
echo "origin_main=$(git rev-parse origin/main 2>/dev/null || echo unavailable)"
echo "dirty_paths=$(git status --porcelain 2>/dev/null | wc -l)"
echo "build_id=$(test -f .next/BUILD_ID && tr -d '\r\n' < .next/BUILD_ID || echo unavailable)"
echo "release_target=$(test -L current && readlink -f current || echo legacy-in-place)"
echo "disk=$(df -Ph "$APP_DIR" | awk 'NR==2{print $5" used, "$4" free"}')"
echo "memory=$(free -m | awk '/^Mem:/{print $3"MB used, "$7"MB available"}')"
for port in 3006 3007; do
  if ss -ltn | grep -q ":$port "; then echo "port_$port=listening"; else echo "port_$port=not_listening"; fi
done
health_code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 8 http://127.0.0.1:3006/api/health/ready || true)"
echo "readiness_http=${health_code:-000}"
