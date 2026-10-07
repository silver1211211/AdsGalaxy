#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ADSGALAXY_APP_DIR:-/www/wwwroot/bots/AdsFusion}"
MANIFEST="${ADSGALAXY_CRON_MANIFEST:-$APP_DIR/ops/cron/jobs.json}"
MODE="dry-run"
[[ "${1:-}" == "--apply" ]] && MODE="apply"
if [[ "${1:-}" != "" && "${1:-}" != "--apply" ]]; then
  echo "usage: $0 [--apply]" >&2
  exit 64
fi

test -f "$MANIFEST" || { echo "ERROR manifest missing: $MANIFEST" >&2; exit 1; }
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$MANIFEST"

routes_file="$(mktemp)"
current_file="$(mktemp)"
desired_file="$(mktemp)"
trap 'rm -f "$routes_file" "$current_file" "$desired_file"' EXIT
find "$APP_DIR/src/app/api/cron" -type f -name route.ts -printf '%p\n' | sed "s#^$APP_DIR/src/app##;s#/route.ts\$##" | sort > "$routes_file"
crontab -l 2>/dev/null > "$current_file" || true

APP_DIR="$APP_DIR" MANIFEST="$MANIFEST" node <<'NODE' > "$desired_file"
const fs=require("fs");
const m=JSON.parse(fs.readFileSync(process.env.MANIFEST,"utf8"));
console.log(m.managed_begin);
for(const j of m.jobs){
  const target=j.kind==="http"?j.route:j.command;
  console.log(`${j.schedule} ${process.env.APP_DIR}/scripts/run-cron-job.sh ${j.id} ${target} ${j.timeout_seconds} ${j.lock} ${j.offset_seconds||0} ${j.log}`);
}
console.log(m.managed_end);
NODE

echo "mode=$MODE manifest=$MANIFEST jobs=$(node -e 'console.log(require(process.argv[1]).jobs.length)' "$MANIFEST")"
node - "$MANIFEST" "$routes_file" "$current_file" <<'NODE'
const fs=require("fs");
const [manifestPath,routesPath,currentPath]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const routes=new Set(fs.readFileSync(routesPath,"utf8").trim().split(/\n/).filter(Boolean));
const current=fs.readFileSync(currentPath,"utf8");
const counts=new Map();
for(const match of current.matchAll(/\/api\/cron\/([a-z0-9-]+)/g)) counts.set(match[1],(counts.get(match[1])||0)+1);
let missing=0,duplicate=0,routeMissing=0;
for(const j of m.jobs){
  const count=(current.match(new RegExp(`run-cron-job\\.sh\\s+${j.id}(?:\\s|$)`,"g"))||[]).length;
  if(!count){ console.log(`MISSING ${j.id}`); missing++; }
  if(count>1){ console.log(`DUPLICATE ${j.id} count=${count}`); duplicate++; }
  if(j.kind==="http"&&!routes.has(j.route)){ console.log(`ROUTE_MISSING ${j.id} ${j.route}`); routeMissing++; }
}
for(const [id,count] of counts) if(count>1) console.log(`LEGACY_DUPLICATE_ROUTE ${id} count=${count}`);
if(current.includes("/api/cron/channel-health ")||current.includes("/api/cron/channel-health?")) console.log("STALE_ROUTE /api/cron/channel-health");
console.log(`SUMMARY missing=${missing} duplicate=${duplicate} route_missing=${routeMissing}`);
NODE

echo "--- desired managed block ---"
cat "$desired_file"
if [[ "$MODE" != "apply" ]]; then
  echo "DRY_RUN_ONLY: no crontab changes were made; pass --apply explicitly after review."
  exit 0
fi

if (( EUID != 0 )); then
  echo "ERROR: --apply requires root because the canonical owner is root." >&2
  exit 77
fi

begin="$(node -e 'console.log(require(process.argv[1]).managed_begin)' "$MANIFEST")"
end="$(node -e 'console.log(require(process.argv[1]).managed_end)' "$MANIFEST")"
clean_file="$(mktemp)"
trap 'rm -f "$routes_file" "$current_file" "$desired_file" "$clean_file"' EXIT
awk -v begin="$begin" -v end="$end" '$0==begin{managed=1;next}$0==end{managed=0;next}!managed' "$current_file" \
  | grep -Ev '127\.0\.0\.1:3007/api/cron/|AdsFusion/scripts/(sync-channel-identities|refresh-channel-subscribers)\.sh' > "$clean_file" || true
{ cat "$clean_file"; cat "$desired_file"; } | sed '/^[[:space:]]*$/d' | crontab -
for legacy_user in adsgalaxy-codex adsgalaxy www-data; do
  if id "$legacy_user" >/dev/null 2>&1; then
    legacy_file="$(mktemp)"
    crontab -u "$legacy_user" -l 2>/dev/null \
      | grep -Ev '127\.0\.0\.1:3007/api/cron/|AdsFusion/scripts/(sync-channel-identities|refresh-channel-subscribers)\.sh' > "$legacy_file" || true
    crontab -u "$legacy_user" "$legacy_file"
    rm -f "$legacy_file"
  fi
done
echo "APPLIED: canonical managed block installed for current user."
