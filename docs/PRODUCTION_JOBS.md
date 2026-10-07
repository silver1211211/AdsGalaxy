# AdsGalaxy production jobs

`ops/cron/jobs.json` is the source of truth. Every mutating job has one canonical owner (`root`), one schedule, one stable filesystem lock, one application lock where the route provides one, and one JSONL log.

Apply nothing from documentation blindly. First run:

```bash
cd /www/wwwroot/bots/AdsFusion
./scripts/cron-audit.sh
```

The command is dry-run by default. After reviewing its missing, extra, duplicate, stale-route, schedule, and route-existence output, the root operator may explicitly run `./scripts/cron-audit.sh --apply`. The wrapper loads `CRON_SECRET` from `.env` without putting it in crontab or logs. Unexpected non-2xx responses and transport failures produce non-zero exits and structured JSONL records under `tmp/cron/`.

## Canonical decisions

- `process-ads`: every minute, matching Prompt 3; the route's durable lock prevents overlap.
- `update-views`: every five minutes with a 270-second wrapper timeout, matching Prompt 6's 240-second execution budget and stop reserve.
- channel settlement: hourly only; the legacy `settle-views` and `settle-clicks` routes are not separately scheduled.
- Telegram health: `/api/cron/channel-health-monitor` every 15 minutes. `/api/cron/channel-health` is stale and must not appear.
- platform broadcasts: one root-owned every-minute job. Remove the duplicate `adsgalaxy-codex` entry when applying the canonical block.
- promote AdsGalaxy: one root-owned ten-minute job. Remove the separate five-minute user entry and keep reward reconciliation as an independently reviewed command if still required.
- subscriber refresh: the draining shell worker once daily at 18:11 UTC. Do not also schedule the one-batch HTTP route.
- identity sync: one ten-minute scheduled job. Its normal mode already allocates part of the batch to repair rows, so the separate daily repair invocation is redundant.

The manifest intentionally excludes compatibility routes that are not canonical schedulers (`cleanup-posts`, `delete-expired-posts`, `settle-views`, `settle-clicks`, and `aggregate-channel-stats`).

## Logs and rotation

Install a root-owned logrotate policy for `tmp/cron/*.jsonl`: daily, retain 14 compressed rotations, `copytruncate`, mode 0640. This is a manual system operation and is not performed by the repository scripts.

## Interpreting wrapper status

- `completed`: expected HTTP 2xx or shell exit 0. A valid no-work response is still completed.
- `skipped_locked`: another run owns the same stable lock; no mutation was attempted.
- `failed_transport`: curl timeout/network failure.
- `failed_http`: unexpected non-2xx response.
- `failed_command`: shell worker returned non-zero.

