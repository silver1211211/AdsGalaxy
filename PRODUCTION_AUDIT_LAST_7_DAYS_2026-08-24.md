# AdsGalaxy Production Audit — Last 7 Days — 2026-08-24

## EXECUTIVE SUMMARY

Audit window: **2026-08-17T10:42:15Z through 2026-08-24T10:42:15Z** (server UTC). The PM2 logs are not timestamped consistently and no readable rotated AdsGalaxy/Nginx logs were available to the SSH account, so signatures without an embedded timestamp are classified as retained/current-runtime evidence rather than falsely assigned to the full seven-day window. The host rebooted on 2026-08-22 and the current App/Cron logs contain post-boot activity.

Four interacting causes explain the complaints: a saturated 1-vCPU host; severe MariaDB lock/query pressure; synchronous/uncached Admin aggregation; and Mini App boot/diagnostic request amplification. The source already contains extensive unbuilt hardening work. This audit added two narrow source guards to stop unconditional Mini App diagnostics. Nothing was built, deployed, restarted, reloaded, or migrated.

**Issue totals:** 14 unique issues: P0 2, P1 8, P2 4, P3 0. Statuses: 2 FIXED_IN_SOURCE, 2 ALREADY_RESOLVED, 4 REQUIRES_BUILD, 3 ACTIVE_NOT_FIXED, 2 REQUIRES_CONFIG_ACTIVATION, 1 EXPECTED_EXTERNAL_FAILURE.

## CURRENT PLATFORM HEALTH

- Host: `vps3383895.trouble-free.net`; uptime 1d 21h at capture; 1 vCPU; load 4.26/3.04/2.84.
- CPU samples reached 90–99% user CPU. MariaDB used about 37% CPU; public Next worker about 4.4%; cron worker about 2.2%.
- RAM 3.8 GiB, 2.2 GiB used, 408 MiB free, 1.6 GiB available. Swap 348 MiB used of 3 GiB.
- Disk 36% and inode 10% used: no ENOSPC condition.
- Verified listeners: AdsFusionApp `*:3006`, AdsFusionCron `*:3007`, AdsGalaxyGames `*:3010`, MariaDB `0.0.0.0:3306` and `[::]:3306`.
- Current direct loopback baselines: `/` 8 ms, `/admin` 10 ms, unauthenticated `/api/me/status` 7 ms, `/sdk.js` 11 ms, cron unauthorized response 15 ms, Games `/` 194 ms. These do not exercise authenticated/database-heavy paths.
- Nginx active. MariaDB runs under `mysqld_safe`; `skip_grant_tables=OFF`. One failed Postfix unit is unrelated.
- PM2 dump lists exactly adsFusionBot, AdsGalaxyGames, AdsFusionCron, and AdsFusionApp. Root PM2 metadata could not be queried because this SSH account has no sudo permission. A mistaken empty per-user PM2 daemon was spawned while attempting read-only status; it has no applications and does not control production.

## ERROR INVENTORY

| ID | Sev | Component | First/last seen | Evidence | Root cause / impact | Fix / validation / status |
|---|---|---|---|---|---|---|
| AG-001 | P0 | MariaDB/all write paths | Current post-boot retention; exact endpoints unavailable | 99 InnoDB deadlocks, 34,271 lock waits, 26,973,518 ms cumulative row-lock time; App log has 36 `ER_LOCK_DEADLOCK`, Cron 48 | Concurrent settlement, broadcast, fraud and mediation transactions lock shared campaign/user rows in inconsistent/high-contention patterns. Causes 500s, retries and stalls. | Existing unbuilt `dbResilience.ts` and transaction hardening tests pass; remaining paths listed below. **REQUIRES_BUILD** |
| AG-002 | P0 | Security/DB | Active at 2026-08-24T10:42Z | `ss` shows 3306 on all IPv4/IPv6 interfaces; DB `bind_address` empty | Direct Internet exposure expands credential/brute-force risk. | Bind/firewall change intentionally not activated. `skip_grant_tables` verified OFF. **REQUIRES_CONFIG_ACTIVATION** |
| AG-003 | P1 | Infrastructure | Active at baseline | 1 vCPU, load 4.26, vmstat 90–99% CPU, MariaDB ~37% | CPU queueing magnifies all DB, Node, cron and PHP latency. | Requires additional CPU and workload isolation. **ACTIVE_NOT_FIXED** |
| AG-004 | P1 | Mini App/observability | Current logs; active source | ~593,912 raw `MINIAPP_RELOAD_DEBUG` matches; App out log 288 MB | Every instrumented browser event produced an ingest POST plus client/server log records, increasing Mini App requests, Node work and disk I/O. | Telemetry and ingest are now opt-in by env guards. Static diff check passed. **FIXED_IN_SOURCE** |
| AG-005 | P1 | Admin dashboard | Active source | `/api/admin/dashboard` executes roughly 30 independent queries sequentially, full-history aggregates, then returns `private, no-store` | Serial round trips and repeated full aggregates block the dashboard and amplify DB load; any query failure becomes generic 500. | Requires query consolidation/parallel groups plus short authenticated server cache after correctness testing. **ACTIVE_NOT_FIXED** |
| AG-006 | P1 | Admin broadcasts | Active source | page polls `/api/admin/platform-broadcasts` every 1.5 seconds | Continuous polling adds Admin/API/DB traffic even when state is unchanged. | Increase interval and pause when hidden, preferably event-driven later. Not changed because this dirty file contains existing production work needing owner review. **ACTIVE_NOT_FIXED** |
| AG-007 | P1 | Mini App bootstrap | Active source | initData loop allows 80×150 ms = 12 s before failure; status can retry 3×8 s plus backoff | Missing/delayed initData or DB trouble can hold the entire shell for an unacceptable period. | Existing source improves URL fallback and avoids per-poll telemetry, but shell/status separation needs product-safe refactor. **REQUIRES_BUILD** |
| AG-008 | P1 | DB performance | Since current DB boot | 16,730 slow queries, 167,942 disk temp tables / 598,509 total temp tables, 42.5M queries in 164,452 s; MariaDB ~37% CPU | Aggregations/grouping and cron scans spill to disk and consume the only CPU. | Query/index work requires slow-log access and EXPLAIN capture under privileged account; no blind index added. **REQUIRES_CONFIG_ACTIVATION** |
| AG-009 | P1 | Cron routing/contention | Active config/source | dedicated worker correctly receives two visible root cron jobs on 3007; `refresh-channel-subscribers.sh` still targets 3006; all ports bind publicly | A daily cron still reaches the public App worker; Cron and App contend for the same DB/CPU. | Change script target to 3007 during controlled activation and bind/firewall 3007. **REQUIRES_BUILD** |
| AG-010 | P1 | External HTTP | Active source | multiple Telegram, OxaPay, image and webhook fetches lack an explicit AbortSignal timeout | Remote stalls can occupy request/cron execution and make Admin/Mini App dependencies fail slowly. | Existing modified files add several timeouts, but inventory remains incomplete. **REQUIRES_BUILD** |
| AG-011 | P2 | Telegram/MTProto | Current runtime retention | Cron error log: 20,729 `mtproto_error`, 2,796 `post-not-found`; recurring CHANNEL_INVALID/private/deleted channels | Mostly expected remote/channel states, but repeated processing and high-volume logging waste CPU and obscure bugs. | Classify terminal failures, back off, and stop retrying terminal channel IDs. **EXPECTED_EXTERNAL_FAILURE** |
| AG-012 | P2 | Next deployment | Retained App log | 269 `Failed to find Server Action` matches | Clients held stale action identifiers across deployments; not evidence that current source exports are invalid. | Current route export scan found no invalid custom route exports; source has build marker/cache recovery. **ALREADY_RESOLVED** |
| AG-013 | P2 | DB availability | Historical/current-retained | App has 6 and Cron 38 `ECONNREFUSED`; DB PID started after Aug-22 boot and now answers normally | Boot ordering/readiness race, not connection exhaustion: peak connections 32/500 and current threads 27. | Existing bounded pool/connect retry hardening tests pass; add service readiness ordering when activating. **ALREADY_RESOLVED** |
| AG-014 | P2 | Games/upstreams | Current baseline | Games direct TTFB 179 ms; historical error log retained, no current connection failure reproduced | Separate Next 15 worker shares host resources; historical port failure not active in current probe. | Observe after infrastructure change. **FIXED_IN_SOURCE** (no new Games change; current runtime verified healthy) |

## ADMIN FINDINGS

Inventory discovered 28 Admin pages and 53 Admin API route handlers, including dashboard, campaigns, channels, users, withdrawals, deposits, miniapps, bots, broadcasts, referrals, settings, traffic quality, automation, availability, production readiness, revenue protection, inventory optimization, system logs, audits, developer platform and enterprise.

The main dashboard maps directly to `/api/admin/dashboard`, which calls Admin session auth, then users/campaign/channel/bot/finance/conversion/miniapp aggregate queries plus `getGlobalBotAudienceStats()` and `getMiniAppPlatformStats()`. It has no external provider dependency but is latency-sensitive to MariaDB. Its major defect is the serial chain and no-store response. Other pages generally call one paginated API; campaign detail correctly starts three supplemental APIs together. Broadcasts is the notable aggressive poller.

Admin 500s are consistent with lock/query failures and the broad catch in dashboard. Server logging identifies the route but lacks request ID, safe DB error code and duration. Recommended implementation: consolidate related counts into conditional aggregates, parallelize only independent low-cost groups with a concurrency cap, cache the authenticated aggregate payload for 10–15 seconds, and log `{route, request_id, duration_ms, safe_code}`.

## MINI APP FINDINGS

Critical path is Telegram SDK (root `beforeInteractive`) → initData from SDK or launch URL → `/api/me/status` → shell → page stats; mediation/provider work is not in the DashboardLayout critical path. `TelegramScript` no longer injects another SDK tag, so duplicate loading is resolved in source. The remaining worst-case gate is 12 seconds for initData followed by up to three 8-second status attempts and 1.5 seconds backoff. Usable shell is deliberately withheld during that sequence.

The diagnostic storm was a confirmed self-amplifier. The new source guards require `NEXT_PUBLIC_MINIAPP_RELOAD_DEBUG=1` for client emission and `MINIAPP_RELOAD_DEBUG=1` for ingestion. Leave both unset normally. Mediation fetches remain isolated after shell bootstrap, but provider request/config/fallback calls need consistent client timeouts and bounded provider initialization.

## DATABASE FINDINGS

- Uptime 164,452 seconds; Threads_connected 27; Threads_running 1; Max_used_connections 32; max_connections 500.
- Connections 48,526; Aborted_connects 16,358 (high and merits source/IP breakdown); Aborted_clients 66.
- Queries 42,512,322; Questions 16,182,520; Slow_queries 16,730.
- Temp disk tables 167,942 of 598,509 temp tables.
- Buffer pool reads 7,942,192 versus 24,883,891,836 logical read requests.
- Largest tables: channel_post_daily_stats 142 MB/541k rows; miniapp_mediation_requests 108 MB; channel_health_checks 87 MB/208k; broadcast_deliveries 46 MB/131k; system_logs 33 MB; platform_broadcast_recipients 33 MB; campaign_posts 32 MB; users 29 MB.
- Only one mysql2 pool creation exists. Source now uses a process-global bounded pool, queue cap, idle timeout, connect timeout and keepalive.
- Processlist had no long-running non-sleep query at capture. `SHOW ENGINE INNODB STATUS` was denied because this account lacks PROCESS privilege.
- No migration was created: index proposals without the slow-log query text and safe EXPLAIN results would be speculative.

## CRON FINDINGS

AdsFusionCron is listening on 3007. Visible root jobs for promotion and platform broadcasts correctly target loopback 3007 and use independent locks/timeouts. Subscriber refresh still targets public worker 3006. Logs show settlement, fraud evaluation, broadcast and cleanup overlap on the same financial/campaign rows. Existing dirty source adds bounded transaction retry and lock ordering to several critical paths; targeted tests passed. Cron port 3007 is nonetheless bound on all interfaces.

## NGINX FINDINGS

Nginx is active, but this SSH account could not enumerate the panel vhost or `/www/wwwlogs` files; therefore last-seven-day 110 timeout counts and the historical `157.250.198.46:3006` upstream choice could not be safely verified. Do not change that upstream blindly. Acquire privileged read access and map each hostname before activation. Application root and static SDK are fast on loopback; authenticated aggregate behavior is the bottleneck.

## PM2 FINDINGS

Listeners and dump topology match the expected four processes. App PID 45202 and Cron PID 18061 have run since the post-boot period. The dump contains no duplicate AdsFusionApp entry. Root PM2 restart counters were not readable through this account, so the historical 2,000+ count cannot be separated into deployment/manual/crash restarts from available evidence. No OOM kill was found in accessible seven-day journal data.

## TELEGRAM FINDINGS

CHANNEL_INVALID, private/deleted channel and post-not-found are expected external states. They must be terminally classified and deduplicated so the same identifiers are not retried/logged indefinitely. Telegram API calls in several routes still lack explicit timeouts. Unauthorized/No initData counts are small (52/52 raw App-out matches and 2/2 App-error matches) relative to telemetry volume and are consistent with non-Telegram or delayed sessions, but the long blocking UI makes them visible to users.

## SDK / MEDIATION FINDINGS

`/sdk.js` responds in 11 ms locally and preserves the documented script URL. Raw logs contain 71,201 no-fill markers and 6,870 AbortError markers; no-fill is a business/provider outcome, not automatically an application failure. Provider failure must remain bounded and fall through without holding initial UI. Existing mediation transaction tests confirm Mini-App-first lock order for request/fallback source changes.

## INFRASTRUCTURE AND SECURITY FINDINGS

The single CPU is the central capacity constraint and is shared by two Next 16 workers, a Next 15 Games worker, MariaDB, Telegram bot, PHP queues, PostgreSQL, Nginx and control panel services. MariaDB and ports 3006/3007/3010 are publicly bound. Restrict 3306 and worker ports at the firewall/listener layer after verifying Nginx’s non-loopback upstream dependency. `skip_grant_tables` is OFF, resolving the historical critical state.

## SOURCE CHANGES MADE

1. `src/lib/miniappReloadDebug.ts`: made browser telemetry opt-in.
2. `src/app/api/debug/miniapp-reload/route.ts`: made ingest a no-op unless explicitly enabled.

These files were already untracked before this audit; the changes preserved all other dirty work. The repository was already ahead of origin by 16 commits with many modified/untracked production files. No unrelated content was reverted.

## MIGRATIONS CREATED BUT NOT APPLIED

None by this audit. Existing untracked migrations were preserved and not applied.

## CONFIG CHANGES REQUIRED BUT NOT ACTIVATED

1. Firewall/bind MariaDB 3306 to trusted/loopback access after verifying application topology.
2. Restrict port 3007 (and preferably 3006/3010) from public ingress, preserving the currently required Nginx upstream route.
3. Route subscriber refresh to the dedicated worker on 3007.
4. Provide privileged slow-log/Nginx/PM2 read access for follow-up evidence and tune only from measured queries.

## ISSUES VERIFIED RESOLVED

- MariaDB is not running with `--skip-grant-tables`.
- Telegram SDK has a single root loader in current source.
- Next route scan found no invalid custom exports.
- Dedicated cron worker is active and the visible frequent jobs target 3007.
- No connection-cap exhaustion, disk exhaustion or current Games connection failure was observed.

## ISSUES STILL ACTIVE

CPU saturation; DB lock contention and slow/temp-table pressure; serial uncached Admin dashboard; aggressive broadcast polling; long Mini App bootstrap gate; incomplete external timeouts; public DB/worker listeners; repetitive Telegram terminal failures.

## ISSUES NEEDING BUILD

All source fixes, including the two telemetry guards and the pre-existing DB/auth/cron/Mini App changes, require the owner’s manual build/deployment. The running `.next` does not include them.

## ISSUES NEEDING MIGRATION

None proven safely in this pass. Follow-up EXPLAIN work may produce targeted indexes.

## ISSUES NEEDING SERVICE RESTART/RELOAD

Firewall/listener changes and any Nginx/systemd/PM2 changes require controlled activation. None was performed.

## BEFORE / AFTER EXPECTED EFFECT

After build, normal Mini App navigation will stop generating diagnostic POSTs and duplicate client/server telemetry logs, removing a measurable request and disk-I/O amplifier. Existing DB source hardening should reduce transient 500s/deadlocks, but Admin response time will remain vulnerable until dashboard query consolidation/cache and DB slow-query remediation are completed. Capacity pressure cannot be solved in source alone.

## VALIDATION

- Read installed Next.js 16.2.4 Route Handler and environment-variable guides before final validation.
- `node --test` targeted DB resilience, transaction resilience and Telegram script tests: 8/8 passed.
- `git diff --check`: passed before report creation.
- TypeScript produced no diagnostics during the captured run.
- Direct runtime curls were baseline only; no claim is made that new source is live.
- Classification: source guards **STATICALLY VERIFIED** and targeted supporting behavior **TEST VERIFIED**; deployment **REQUIRES BUILD**; security/network changes **REQUIRES CONFIG ACTIVATION** and **REQUIRES PRODUCTION OBSERVATION**.

## REMAINING RISKS AND RECOMMENDED NEXT ACTIONS

1. Immediately restrict public 3306 exposure using a verified, recoverable firewall rule; preserve application DB connectivity.
2. Upgrade to at least 2–4 vCPU or isolate MariaDB/cron; current 1-vCPU contention is unsafe for this workload.
3. Manually review dirty changes, build/deploy once, restart App/Cron in a controlled window, and leave Mini App debug env flags unset.
4. Refactor `/api/admin/dashboard` into consolidated/parallel bounded aggregates with a 10–15 second authenticated server cache; measure p50/p95/p99.
5. Shorten Mini App’s blocking gate and render a safe shell while noncritical stats load; retain a fast banned-session check.
6. Read the MariaDB slow log and Nginx rotated logs with privilege, group exact seven-day signatures, run safe EXPLAIN, then create only justified indexes.
7. Add structured route duration/request IDs and terminal Telegram failure suppression without logging secrets.
8. Confirm PM2 root restart counters and boot resurrection under a privileged read-only session.

---

**NO BUILD OR DEPLOYMENT WAS PERFORMED. SOURCE CHANGES REQUIRE YOUR MANUAL BUILD/DEPLOYMENT.**

## REMEDIATION PASS 2

### Remediation outcome

Pass 2 addressed the safe source-level portions of AG-001 through AG-010. No build, deployment, migration, process restart, service reload, firewall change, or database configuration change was performed.

| Issue | BEFORE | ROOT CAUSE | CHANGE MADE | FILES | EXPECTED EFFECT | VALIDATION | STATUS | REQUIRES BUILD? | REQUIRES MIGRATION? | REQUIRES CONFIG ACTIVATION? |
|---|---|---|---|---|---|---|---|---|---|---|
| AG-001 P0 deadlocks | 99 deadlocks and 34,271 row waits after boot | Concurrent financial/settlement writers contend on campaign, delivery and user rows | Verified existing bounded retry/lock-order hardening for mediation and pool time limits. Did not bulk-wrap uncovered financial mutations because some are not safely retryable without idempotency integration tests. | `src/lib/dbResilience.ts`, existing mediation route changes | Covered operations release connections, cap lock waits and retry transient deadlocks | DB resilience/transaction tests pass | ACTIVE_NOT_FIXED (partially remediated) | Yes | No | No |
| AG-002 P0 public DB | 3306 listens on all IPv4/IPv6 addresses | Empty MariaDB bind address and absent ingress restriction | Exact activation plan documented below; intentionally not activated | Configuration plan only | Removes public DB attack surface | Listener and DB variables previously verified | REQUIRES_CONFIG_ACTIVATION | No | No | Yes |
| AG-003 P1 CPU | One vCPU at 90–99% sampled CPU | Too many CPU-sensitive workloads share one core | Reduced avoidable dashboard, polling and diagnostic work; hardware plan below | Multiple source files | Lower request/query/log amplification, but cannot create CPU capacity | Static/test validation | INFRASTRUCTURE_LIMIT | Yes for source gains | No | Host resize |
| AG-005 P1 Admin dashboard | About 30 serial uncached queries; one failure returned 500 | Repeated counts, serialized independent sections, no cache | Consolidated four user scans into one conditional aggregate; parallelized campaign, channel, and financial groups; added 15-second authenticated aggregate cache and stale-cache fallback | `src/app/api/admin/dashboard/route.ts` | Fewer DB round trips/scans; warm requests avoid aggregate work; transient metric failure can serve last good payload | EXPLAIN, diff check, targeted lint attempted | FIXED_IN_SOURCE | Yes | No | No |
| AG-006 P1 Admin polling | Broadcast page fetched every 1.5 seconds while hidden | Fixed unconditional interval | Changed to 15 seconds, refresh on focus/visibility, and skip while hidden | `src/app/admin/broadcasts/page.tsx` | About 90% lower idle polling load and no hidden-tab polling | Static source review/diff check | FIXED_IN_SOURCE | Yes | No | No |
| AG-007 P1 Mini App boot | Shell blocked by up to 12-second initData wait plus status retries | Authentication probe controlled the full layout render; concurrent consumers independently polled initData | Shell now renders immediately; restricted-account check continues in background; active initData waits are shared/deduplicated; API routes remain authoritative | `src/components/layout/DashboardLayout.tsx`, `src/lib/telegramWebApp.ts` | Immediate first meaningful shell render; one initData polling loop per browser at a time; failures do not blank UI | Telegram tests pass | FIXED_IN_SOURCE | Yes | No | No |
| AG-008 P1 temp tables/slow queries | 167,942 disk temp tables and 16,730 slow queries after boot | Broad GROUP BY/ORDER BY analytics and historical aggregates on one CPU | Ran safe EXPLAIN. Existing indexes cover campaign/channel/date filters. Conversion ranking reports temporary/filesort but current cardinality was negligible. No speculative index created; dashboard cache bounds repeat execution. | Dashboard source only | Prevents repeated heavy dashboard executions without adding write-heavy indexes | Six safe EXPLAIN plans captured | ACTIVE_NOT_FIXED | Yes | No currently | Privileged slow-log follow-up |
| AG-009 P1 cron routing | Subscriber refresh used public App port 3006 | Legacy script URL | Changed update-subscribers target to `127.0.0.1:3007`; scan found only the intentional public-App health check on 3006 | `scripts/refresh-channel-subscribers.sh` | Daily refresh no longer competes inside public App worker | Source scan/diff check | FIXED_IN_SOURCE | No build required; script is interpreted | No | Cron port firewall still required |
| AG-010 P1 external calls | Several Telegram/image calls had no timeout | Native fetch defaults permit indefinite waits | Added 8-second Telegram/image validation and 10-second IMG upload timeouts to four confirmed paths | publisher verify-join, rewarded-campaign image validation, campaign image edit, upload-image routes | Remote dependency stalls release request capacity predictably | Static source review/diff check | ACTIVE_NOT_FIXED (inventory reduced) | Yes | No | No |

### ADMIN PERFORMANCE CHANGES

- Authentication remains outside the dashboard cache and is executed for every request.
- User total/today/week/month changed from four scans to one conditional aggregate.
- Campaign status/type/miniapp campaign metrics now run concurrently.
- Channel status/approved/eligible metrics now run concurrently.
- Withdrawal status/deposit total/withdrawal total now run concurrently.
- Successful aggregate payloads are cached in-process for 15 seconds. Browser caching is private and bounded; mutation/action APIs are not cached.
- If a refresh fails after one successful load, the API serves the last good payload with `X-AdsGalaxy-Cache: STALE` instead of returning a whole-dashboard 500.
- The Admin shell was already independent because `AdminLayout` renders around its loading state. The expensive metric payload remains one endpoint, but it no longer runs for every warm navigation.
- Broadcast polling is visibility-aware, focus-refreshable, and reduced from 1.5 to 15 seconds.

### MINI APP PERFORMANCE CHANGES

- Root layout remains the only Telegram WebApp script loader; `TelegramScript` performs setup/cache recovery only.
- The application shell starts in `ready` state and renders without waiting for Telegram or `/api/me/status`.
- Account restriction checks run in the background. A confirmed 403/banned response still replaces the shell with `BannedScreen`; all protected APIs independently enforce authentication.
- Concurrent bootstrap/API consumers share one active initData wait. The 12-second compatibility window is retained for delayed Telegram WebViews but no longer blocks first shell render.
- Status retry failure is logged diagnostically only when the controlled debug flag is enabled and no longer changes the whole shell to an error page.
- Pass 1 production diagnostics remain opt-in via `NEXT_PUBLIC_MINIAPP_RELOAD_DEBUG=1` and `MINIAPP_RELOAD_DEBUG=1`.

### DATABASE / DEADLOCK CHANGES

Existing dirty source already provides a single process-global mysql2 pool, bounded queue, connection limit 10, idle/connect/query timeouts, keepalive, transient-query retry and a transaction helper that caps lock wait and statement time. Pass 2 verified only one pool creation.

The retained deadlock evidence names channel settlement, broadcast reservation/refund, fraud billing, miniapp settlement and mediation. Mediation request/fallback share Mini-App-first locking and use bounded transaction retry. Other financial families still manually control transaction commit/rollback. They were not mechanically converted because retry safety depends on durable idempotency keys and integration tests for double payout/double debit. AG-001 therefore remains unresolved P0 until those specific flows receive integration coverage and controlled refactors.

No external HTTP call was found inside the begin/commit interval of the inspected transaction files; files containing both fetch and transactions perform them in separate functions/regions.

### CRON CHANGES

- `refresh-channel-subscribers.sh` now targets `http://127.0.0.1:3007/api/cron/update-subscribers`.
- Repository and system-cron scans found no other heavy intended cron target using the public domains or 3006.
- `scripts/adsgalaxy-app-healthcheck.sh` intentionally checks public App `/api/settings` on 3006 and is not a heavy job.
- Shell locks inspected acquire immediately and contain no intentional sleep while held.
- Existing frequent crons use independent flock files and bounded curl timeouts.

### INDEX MIGRATIONS

None created. EXPLAIN evidence:

- Campaign status aggregation: covering status index, about 36 rows.
- Channel status/deleted aggregation: composite covering index, about 1.2k rows.
- Miniapp daily date aggregation: indexed date lookup, about 3 rows.
- User combined total/recent aggregate: full scan, about 66.8k rows, now once per cache window rather than four scans per request.
- Broadcast sent lifetime financial aggregate: full scan, about 131k rows because `sent` is non-selective. A simple status index would not materially reduce work; a wide covering financial index would impose write cost. Cache/pre-aggregation is preferred.
- Conversion top grouping reports temporary/filesort but had negligible current cardinality. No index justified from present evidence.

Privileged slow-log access is still required to attribute the global disk-temp counter before any migration is proposed.

### EXTERNAL CALL CHANGES

Explicit AbortSignal timeouts were added to publisher join verification, rewarded campaign remote-image validation, advertiser campaign image editing, and the image upload route. Existing source already added timeouts to multiple Telegram/bot/cron paths. Remaining external fetch inventory must be completed route-by-route; AG-010 remains active rather than overstated as resolved.

### CONFIGURATION PLAN — NOT ACTIVATED

Before running these commands, confirm no legitimate remote DB client or direct worker consumer exists and preserve an out-of-band root session.

1. MariaDB: set `bind-address = 127.0.0.1` in the active MariaDB server configuration (Baota installs commonly use `/www/server/mysql/my.cnf`; verify with `mariadbd --help --verbose` and `SHOW VARIABLES` first). If legitimate private hosts require DB access, bind the private interface instead and allow only their addresses.
2. Firewall activation example after verification: `ufw deny 3306/tcp`; if UFW is not the active firewall, create the equivalent provider/nftables rule. Verify with `ss -lntp` and an external connection test after the controlled MariaDB restart.
3. Worker ports: deny external ingress to TCP 3007 and 3010. Do not block local loopback. Port 3006 must remain reachable from the currently configured Nginx upstream until the historical non-loopback dependency is fully understood.
4. Prefer starting AdsFusionCron with a loopback hostname/bind option if supported by the approved Next 16 start command; otherwise firewall 3007 while retaining `127.0.0.1` access.
5. Add service ordering/readiness so App/Cron start only after MariaDB is accepting connections. Do not merely increase retry counts.

No command above was executed.

### INFRASTRUCTURE PLAN

CPU-sensitive workloads observed concurrently: AdsFusionApp, AdsFusionCron, AdsGalaxyGames, adsFusionBot, MariaDB, PHP/Laravel queue and monitoring workers, Nginx, PostgreSQL and the server panel. Software request amplification and serial queries were bugs; one core for this combined workload is an infrastructure limit.

Recommended minimum: **4 vCPU and 8 GiB RAM** for the current consolidated host, with 2 vCPU/4 GiB considered only a short-term emergency floor. Prefer isolating MariaDB or heavy PHP/cron workloads if growth continues. Keep swap for emergency pressure, not routine working memory. After deployment/resize, measure CPU run queue, MariaDB p95 query time, Admin p95, Mini App bootstrap milestones and cron overlap before further tuning.

### PASS 2 VALIDATION

- No Next build was run.
- Targeted Node tests: 10 passed, 0 failed.
- `git diff --check`: passed.
- Safe EXPLAIN: six dashboard query shapes inspected.
- TypeScript full-project check completed under a timeout worker but its disconnected SSH invocation did not preserve the exit status; it is not claimed as passed.
- Targeted ESLint was attempted but exceeded the interactive window on the saturated one-vCPU host; no result is claimed.
- Running `.next` was not changed, so all compiled application behavior requires the owner’s build/deployment except the interpreted subscriber-refresh shell script.

### PASS 2 REMAINING PRIORITIES

- Unresolved P0: AG-001 deadlock families need idempotency-backed integration tests/refactors; AG-002 needs controlled network configuration activation.
- Unresolved P1: AG-003 infrastructure capacity, AG-008 measured slow-log/temp-table attribution, and the remaining AG-010 external timeout inventory.
- After manual build/deploy, production observation is required to validate Admin cache hit rate/latency, Mini App first-render timing, deadlock rate, CPU, and log volume.
