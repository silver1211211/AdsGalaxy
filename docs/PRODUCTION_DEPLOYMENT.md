# AdsGalaxy production deployment

This runbook separates validation, build, promotion, process restart, verification, and rollback. Never build into the live `.next` directory and never restart only one of `AdsFusionApp` or `AdsFusionCron`.

## 1. Validate source

```bash
cd /www/wwwroot/bots/AdsFusion
./scripts/predeploy-check.sh
npx tsc --noEmit --pretty false
npm test
git diff --check
```

The predeploy gate fails on a dirty worktree, untracked migration, insufficient free disk, invalid cron manifest, or cron audit discrepancy. Resolve the current reconciliation plan before deployment. Migration execution requires separate authorization.

## 2. Build an isolated immutable release

```bash
cd /www/wwwroot/bots/AdsFusion
./scripts/build-release.sh
```

The script archives a reviewed Git revision into `releases/<UTC>-<revision>`, builds only there, validates `BUILD_ID`, server/static directories and manifests, then writes secret-free release metadata. A failed build never changes `current` or live `.next`.

## 3. Promote atomically

```bash
cd /www/wwwroot/bots/AdsFusion
./scripts/promote-release.sh /www/wwwroot/bots/AdsFusion/releases/<release-id>
readlink -f current
```

Promotion is an atomic symlink replacement. PM2 definitions must run both App and Cron from `/www/wwwroot/bots/AdsFusion/current`. Confirm both resolve to the same release before restarting.

## 4. Restart both processes

```bash
PM2_HOME=/root/.pm2 /root/.nvm/versions/node/v24.15.0/bin/pm2 restart AdsFusionApp --update-env
PM2_HOME=/root/.pm2 /root/.nvm/versions/node/v24.15.0/bin/pm2 restart AdsFusionCron --update-env
PM2_HOME=/root/.pm2 /root/.nvm/versions/node/v24.15.0/bin/pm2 save
```

## 5. Verify

```bash
curl -fsS http://127.0.0.1:3006/api/health/ready
curl -fsS http://127.0.0.1:3007/api/health/ready
./scripts/production-status.sh
PM2_HOME=/root/.pm2 /root/.nvm/versions/node/v24.15.0/bin/pm2 status AdsFusionApp AdsFusionCron
```

Verify the same build ID/Git revision on both ports, inspect recent logs, and confirm cron wrapper results. Do not weaken Next.js server-action validation to work around mixed-build errors.

## 6. Roll back application code

Database rollback is separate and is never implied.

```bash
cd /www/wwwroot/bots/AdsFusion
previous=/www/wwwroot/bots/AdsFusion/releases/<previous-release-id>
./scripts/build-validator.sh "$previous/.next"
ln -sfn "$previous" current.rollback
mv -Tf current.rollback current
PM2_HOME=/root/.pm2 /root/.nvm/versions/node/v24.15.0/bin/pm2 restart AdsFusionApp --update-env
PM2_HOME=/root/.pm2 /root/.nvm/versions/node/v24.15.0/bin/pm2 restart AdsFusionCron --update-env
curl -fsS http://127.0.0.1:3006/api/health/ready
```

Retain at least the current and two previous validated releases. Remove older releases only after manual path verification and a successful backup; no retention deletion is automated here.

## Current legacy warning

`deploy-vps.sh` still combines migration, build, promotion, restart, PM2 save, and crontab mutation. It must not be used until migration 0150 ledger drift and the dirty/untracked source state are reconciled. The isolated scripts above are the prepared replacement workflow.

