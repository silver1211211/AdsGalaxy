#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ADSGALAXY_APP_DIR:-/www/wwwroot/bots/AdsFusion}"
MIN_FREE_MB="${ADSGALAXY_MIN_FREE_MB:-4096}"
cd "$APP_DIR"
failed=0
branch="$(git branch --show-current)"
head="$(git rev-parse HEAD)"
dirty="$(git status --porcelain | wc -l)"
untracked_migrations="$(git ls-files --others --exclude-standard 'db/migrations/*.sql' | wc -l)"
free_mb="$(df -Pm "$APP_DIR" | awk 'NR==2{print $4}')"
printf 'branch=%s head=%s dirty_paths=%s untracked_migrations=%s free_mb=%s\n' "$branch" "$head" "$dirty" "$untracked_migrations" "$free_mb"
if (( dirty > 0 )); then echo "BLOCKED dirty Git worktree" >&2; failed=1; fi
if (( untracked_migrations > 0 )); then echo "BLOCKED untracked migration files" >&2; failed=1; fi
if (( free_mb < MIN_FREE_MB )); then echo "BLOCKED low disk space" >&2; failed=1; fi
node -e 'JSON.parse(require("fs").readFileSync("ops/cron/jobs.json","utf8"))'
./scripts/cron-audit.sh
exit "$failed"

