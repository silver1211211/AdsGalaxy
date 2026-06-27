# AdsGalaxy Staging Deployment Checklist

This checklist is for staging readiness only. Do not put real secret values in this file.

## Environment Variables

Status values:
- `SET`: present in the current local `.env` during the staging audit.
- `MISSING`: not present in the current local `.env` during the staging audit.
- `REQUIRED`: must be configured in the staging host before deployment.

| Variable | Status | Required | Purpose |
| --- | --- | --- | --- |
| `ADMIN_SESSION_SECRET` | MISSING | REQUIRED | Signs admin session cookies. Use 32+ random characters. |
| `CRON_SECRET` | MISSING | REQUIRED | Required in `x-cron-secret` for all `/api/cron/*` routes. |
| `BOT_TOKEN` | SET | REQUIRED | Primary Telegram bot token. |
| `DB_HOST` | SET | REQUIRED | MySQL host. |
| `DB_PORT` | SET | REQUIRED | MySQL port. |
| `DB_USER` | SET | REQUIRED | MySQL user. |
| `DB_PASS` | SET | REQUIRED | MySQL password. |
| `DB_NAME` | SET | REQUIRED | MySQL database name. |
| `NEXT_PUBLIC_APP_URL` | MISSING | REQUIRED | Public staging app origin, no trailing slash. |
| `NEXT_PUBLIC_SDK_URL` | MISSING | REQUIRED | Public staging SDK origin, no trailing slash. |
| `NEXT_PUBLIC_API_BASE_URL` | MISSING | REQUIRED | Public staging API base URL for SDK/docs. |
| `NEXT_PUBLIC_ADSGALAXY_APP_URL` | MISSING | OPTIONAL | Legacy SDK app URL alias. Prefer `NEXT_PUBLIC_APP_URL`. |
| `DOMAIN` | MISSING | REQUIRED | Host-only domain used in Telegram post links. |
| `PHP_VIEWS_API_URL` | MISSING | REQUIRED | Channel views service URL used by `update-views` cron. |
| `TELEGRAM_BOT_USERNAME` | MISSING | REQUIRED | Bot username without `@` for server-rendered Telegram links. |
| `NEXT_PUBLIC_BOT_USERNAME` | MISSING | REQUIRED | Bot username without `@` for client-rendered Telegram links. |
| `TELEGRAM_NEWS_CHANNEL` | MISSING | REQUIRED | News/referral channel username without `@` for server flows. |
| `NEXT_PUBLIC_CHANNEL` | MISSING | REQUIRED | News/referral channel username without `@` for client UI. |
| `NEXT_PUBLIC_CHANNEL_REWARD` | MISSING | OPTIONAL | Publisher join reward display value. |
| `BOT_ADD_USER_SECRET` | MISSING | REQUIRED | Required by `/api/bot/add-user`. |
| `MINIAPP_STATS_SECRET` | MISSING | REQUIRED if used | Required by `/api/internal/miniapp-stats`. |
| `ADSGRAM_BLOCK_ID` | MISSING | REQUIRED if AdsGram uses env config | AdsGram block/placement id. |
| `ADSGRAM_API_KEY` | MISSING | REQUIRED if AdsGram API access is used | AdsGram private credential. |
| `MONETAG_ZONE_ID` | MISSING | REQUIRED if Monetag uses env config | Monetag zone id. |
| `MONETAG_API_KEY` | MISSING | REQUIRED if Monetag API access is used | Monetag private credential. |
| `RICHADS_PUBLISHER_ID` | MISSING | REQUIRED for RichAds Mini App delivery | RichAds publisher id. |
| `RICHADS_API_KEY` | MISSING | REQUIRED if RichAds API access is used | RichAds private credential. |
| `RICHADS_ZONE_ID` | MISSING | REQUIRED if RichAds uses env config | RichAds zone id. |
| `ADEXIUM_API_KEY` | MISSING | REQUIRED if AdExium API access is used | AdExium private credential. |
| `ADEXIUM_ZONE_ID` | MISSING | REQUIRED if AdExium uses env config | AdExium zone id. |
| `GIGAPUB_APP_ID` | MISSING | REQUIRED if GigaPub uses env config | GigaPub project/app id. |
| `GIGAPUB_API_KEY` | MISSING | REQUIRED if GigaPub API access is used | GigaPub private credential. |
| `GIGAPUB_PRIMARY_ORIGIN` | MISSING | OPTIONAL | GigaPub primary script origin override. |
| `GIGAPUB_BACKUP_ORIGIN` | MISSING | OPTIONAL | GigaPub backup script origin override. |

## Domain Configuration

Required staging values:

```env
NEXT_PUBLIC_APP_URL=https://staging.example.com
NEXT_PUBLIC_SDK_URL=https://staging.example.com
NEXT_PUBLIC_API_BASE_URL=https://staging.example.com
DOMAIN=staging.example.com
PHP_VIEWS_API_URL=https://your-views-service.example.com/views/api.php
TELEGRAM_BOT_USERNAME=YourStagingBot
NEXT_PUBLIC_BOT_USERNAME=YourStagingBot
TELEGRAM_NEWS_CHANNEL=YourStagingNewsChannel
NEXT_PUBLIC_CHANNEL=YourStagingNewsChannel
```

Production fallbacks remain in code for continuity, but staging must override them.

## Migration Readiness

Migration files must be applied in filename order from `db/migrations`:

```text
20260619_0001_production_upgrade_preparation.sql
...
20260624_0039_admin_auth_security.sql
```

Required schema areas covered by migrations:
- Mini App foundation: `miniapps`, `miniapp_ad_networks`, `miniapp_daily_stats`, mediation/request tables.
- System logs: `system_logs` and cleanup settings.
- Cron locking: `cron_locks`.
- Revenue protection: `revenue_protection_settings`, validation columns, review columns.
- Referral sprint: `referral_reward_ledger`, sprint/team/claim tables.
- Developer platform: developer applications, API key, webhook, request tables.
- Admin sessions: `admins.password_hash`, `admins.password_migrated_at`, `admin_sessions`.

No duplicate migration prefixes were found during the audit.

## Safe Migration Command

Create a local MySQL defaults file outside git, for example `.mysql-staging.cnf`:

```ini
[client]
host=STAGING_DB_HOST
port=3306
user=STAGING_DB_USER
password=STAGING_DB_PASSWORD
```

Then apply migrations in order:

```powershell
Get-ChildItem .\db\migrations -Filter *.sql |
  Sort-Object Name |
  ForEach-Object {
    Write-Host "Applying $($_.Name)"
    cmd /c "mysql --defaults-extra-file=.mysql-staging.cnf STAGING_DB_NAME --binary-mode --comments < ""$($_.FullName)"""
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
  }
```

Run this only after a staging DB backup/snapshot. Do not run it against production during staging prep.

## SQL Verification Commands

Run after migrations:

```sql
SHOW TABLES LIKE 'miniapp%';
SHOW TABLES LIKE '%system_logs%';
SHOW TABLES LIKE '%cron%';
SHOW TABLES LIKE '%developer%';
SHOW TABLES LIKE '%referral%';
SHOW TABLES LIKE '%revenue%';
SHOW COLUMNS FROM admins;
SHOW COLUMNS FROM admin_sessions;
SHOW COLUMNS FROM miniapp_daily_stats;
SHOW COLUMNS FROM campaign_posts;
SELECT `key`, value FROM revenue_protection_settings WHERE `key` = 'suspicious_revenue_settlement_behavior';
```

Admin auth verification:

```sql
SHOW COLUMNS FROM admins LIKE 'password_hash';
SHOW COLUMNS FROM admins LIKE 'password';
SHOW TABLES LIKE 'admin_sessions';
SELECT COUNT(*) AS admins_without_hash FROM admins WHERE password_hash IS NULL OR password_hash = '';
```

The legacy `admins.password` column may still exist for compatibility, but login must use `password_hash`. Any admin without a hash must be reset/migrated before staging login tests.

## Cron Scheduler Configuration

Every staging scheduler request must include:

```http
x-cron-secret: <CRON_SECRET>
```

Example:

```bash
curl -fsS -H "x-cron-secret: $CRON_SECRET" "https://staging.example.com/api/cron/process-ads"
```

Unauthenticated cron requests should return `401`. If `CRON_SECRET` is missing, cron routes should return `503`.

## Staging Deployment Checklist

- Configure all `REQUIRED` env vars in staging.
- Build with `npm run build`.
- Snapshot staging DB.
- Apply migrations in order.
- Run SQL verification commands.
- Log in as admin and confirm session cookie has no credentials.
- Call one cron route without `x-cron-secret` and confirm `401`.
- Call one cron route with `x-cron-secret` and confirm scheduler compatibility.
- Load `/sdk.js?id=YOUR_INTEGRATION_ID` from the staging domain.
- Open publisher Mini App docs and confirm SDK snippets use the staging domain.
