# Telegram tracking-session recovery

Cron workers never perform interactive Telegram login. When `session_auth_error` is recorded:

1. Confirm the unhealthy masked account in the admin-only tracking-health endpoint.
2. Reauthorize or replace that session using the owner-controlled secure process.
3. Store the replacement only in the protected runtime secret environment.
4. Restart or reload only the authorized worker environment.
5. Run a controlled admin health check without refreshing publisher records.
6. Retry affected channels after access membership is confirmed.

Do not place session strings, API hashes, access hashes, phone numbers, or invite secrets in UI, logs, tickets, or Git.
