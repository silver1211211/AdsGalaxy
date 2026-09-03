# Ads Galaxy Channel Safety Implementation — 2026-09-02

## 1. Original problems

- Channel fraud evaluation used `ORDER BY id ASC LIMIT 200`, so the same low IDs could monopolize every run and newer channels could starve.
- Channel click accounting had no separate privacy-safe, replay-resistant telemetry stream for concentration analysis.
- Publisher risk signals were spread across channel fraud, trust, referral, and traffic systems without a persisted explanation layer.
- Withdrawal approval did not require a consolidated pre-clearance assessment or expose actionable review reasons.
- Admin reporting did not distinguish pre-cutover legacy settlement records from post-cutover canonical-ledger gaps.
- Publisher-selected channel geography had no confidence/source/conflict model.
- Trust & Safety coverage was not summarized on the admin dashboard.
- Authorized/test accounts had no first-class, audited enforcement exemption. Unban did not record a remediation disposition.

No Mini App CPM logic was changed. Withdrawal #18, Silver, balances, bans, rewards, withdrawals, settlements, and historical financial rows were not changed.

## 2. Exact fixes

- Fraud selection now sorts by never evaluated first, then oldest evaluation, then channel ID, with the existing bounded limit and evaluation-bucket unique guard retained.
- Added aggregate coverage measurements after each fraud run and on the admin dashboard.
- Added HMAC-derived event, network, device, and session identifiers; request-country capture; a unique event key; repeat flags; five-minute burst/concentration analysis; and 90-day bounded retention cleanup. The telemetry path is fail-open for click redirect/billing and does not alter settlement accounting.
- Added explainable publisher risk assessments covering channel risk/trust, stale or unscanned channels, open high/critical referral flags, unresolved referral rewards, mass referral creation, shared IP/device/identity referral signals, and traffic concentration. It is visibility/manual-review input only and does not independently auto-ban.
- Added withdrawal pre-clearance. New, unpaid approvals return HTTP 409 with structured reasons when review is required; they are not auto-rejected or refunded. Cleared withdrawals retain the existing locked/available balance and paid-out idempotency path.
- Added ledger cutover metrics that classify legacy-only records, legitimate pre-cutover legacy records, post-cutover records, canonical coverage, flagged canonical events, and genuine post-cutover count gaps. No backfill or financial duplication occurs.
- Added channel GEO classification with selected region, authoritative region, confidence, source/reason, conflict flag, and review status. Unknown stays unknown; language is retained only as a weak hint. Existing delivery continues to use the established `audience_continents` production field.
- Added compact responsive Trust & Safety cards, withdrawal reason badges, channel GEO details, and explicit unban disposition controls.
- Added scoped user enforcement exemptions with audit attribution, reason, type, timestamps, active state, and optional expiry. Enforcement checks before the transaction and again after locking the user row.
- Default admin unban disposition is trust remediation and resets `publisher_trust_score` to the platform default `60`. Exemption and no-remediation choices preserve the current score; no-remediation carries a re-ban warning.
- The publisher available-balance auto-ban threshold remains changed from `9.8` to `8.4` as requested.

## 3. Files and functions changed

- `src/lib/channelFraudDetection.ts`
  - `runChannelFraudDetection`: fair ordering, telemetry retention cleanup, risk persistence, coverage response.
- `src/lib/channelSafety.ts` (new)
  - `getFraudCoverageMetrics`
  - `assessPublisherRisk`
  - `persistPublisherRiskAssessment`
  - `getLedgerCoverageMetrics`
  - `assessWithdrawalPreclearance`
  - `getAdminChannelSafetyMetrics`
- `src/lib/channelTrafficTelemetry.ts` (new)
  - `telemetryCountry`, `buildTelemetryIdentity`, `recordChannelTrafficEvent`, `purgeExpiredChannelTrafficEvents`.
- `src/lib/channelGeoQuality.ts` (new)
  - `classifyChannelGeoConfidence`.
- `src/lib/userEnforcementExemptions.ts` (new)
  - `hasActiveUserEnforcementExemption`, `setUserEnforcementExemption`.
- `src/lib/publisherTrustEnforcement.ts`
  - 8.4 balance threshold and two-stage exemption checks.
- `src/app/api/clicks/[id]/[postId]/route.ts`
  - Sidecar channel click telemetry, isolated from billing and redirects.
- `src/app/api/admin/withdrawals/route.ts`
  - Pre-clearance payloads and approval gate.
- `src/app/admin/withdrawals/page.tsx`
  - Pre-clearance status/reasons and blocked approval control.
- `src/app/api/admin/dashboard/route.ts`, `src/app/admin/page.tsx`
  - Cached safety metrics and responsive cards; cached dashboard data renders immediately.
- `src/app/api/admin/channels/route.ts`, `src/app/admin/channels/page.tsx`
  - Schema-safe GEO persistence/selection and admin visibility.
- `src/app/api/admin/users/route.ts`, `src/app/admin/users/page.tsx`
  - Audited unban dispositions, default trust reset, exemption controls, warnings.
- `db/migrations/20260902_0123_channel_safety_foundation.sql` (new)
- `tests/channel-safety-foundation.test.mjs` (new)
- `deploy-vps.sh`
  - Adds migration 0123 to the normal migration sequence.

## 4. Database migration/schema

Migration `20260902_0123_channel_safety_foundation.sql` is additive and creates:

- `channel_traffic_events`: unique HMAC event key, event context, pseudonymous identities, country, duplicate/burst/concentration flags, and retention deadline.
- `publisher_risk_assessments`: latest score/state with JSON reasons and inputs.
- `withdrawal_preclearance_assessments`: durable schema reserved for assessment history; current UI/API computes live pre-clearance so it cannot become stale.
- `channel_geo_classifications`: selected/authoritative region, confidence, evidence, conflict, review status, attribution/timestamps.
- `user_enforcement_exemptions`: explicit user/scope/type/reason/admin/expiry/active/timestamps.
- `idx_channels_fraud_coverage`: supports the new fair fraud scan order.

The migration was not run in production.

## 5. Fraud coverage algorithm

Eligible non-deleted active/paused channels are selected with:

```sql
ORDER BY COALESCE(fraud_last_evaluated_at, '1970-01-01 00:00:00') ASC, id ASC
LIMIT <bounded limit>
```

Never-evaluated channels lead, followed by the oldest evaluated channels. Updating `fraud_last_evaluated_at` moves completed channels behind the remaining inventory. ID is a deterministic tie-breaker. Existing `(channel_id, evaluation_bucket)` idempotency prevents duplicate work in the same bucket. Therefore channels such as 1078/1079/1080 enter normal coverage after deployment without manual mutation.

## 6. Telemetry

- Captures channel/campaign/post, event type, hashed request key, optional Telegram user, HMAC session, HMAC `/24` IPv4 or `/64` IPv6 network identity, HMAC device/fingerprint, proxy-provided country, timestamp, duplicate flag, burst flag, and concentration flag.
- Does not add raw IP or user-agent columns to the new table.
- Unique event keys suppress replay insertion. Existing click deduplication remains authoritative for settlement.
- Concentration requires volume plus a strong same-user/session/device/network share; no single matching signal marks fraud by itself.
- Telemetry errors never block redirect or change billing.
- Records receive a 90-day retention deadline and bounded expiry cleanup runs with channel fraud processing.
- The current per-request producer is the channel click route. The schema supports impressions, but Telegram aggregate view collection has no legitimate per-view user/request identity, so it was not fabricated.

## 7. User-level risk aggregation

`assessPublisherRisk` combines existing publisher/channel scores with coverage, referral, identity-cluster, unresolved reward, and telemetry signals. Each contribution produces a stable code, severity, count where applicable, and human-readable detail. The latest result can be persisted to `publisher_risk_assessments`. The aggregate does not directly ban users.

## 8. Withdrawal pre-clearance

`assessWithdrawalPreclearance` checks:

- never-scanned and stale publisher channels;
- high/critical referral flags and unresolved referral rewards;
- recent concentration alerts;
- aggregate publisher risk/trust;
- the applicable locked balance, or available balance for a previously refunded request, against the withdrawal amount;
- publisher-scoped canonical/legacy ledger state for admin context.

Possible reasons include `incomplete_fraud_coverage`, `unresolved_referral_risk`, `traffic_quality_review`, `publisher_risk_review`, and `insufficient_cleared_earnings`. A review-required request is blocked from payment but remains pending; it is not automatically rejected.

## 9. Ledger coverage handling

The visibility layer finds the first canonical event time and classifies settlement rows before it as legitimate legacy records. Only settlement counts at/after cutover are compared with canonical click/view events for a gap. It also reports canonical flagged-event count and clear publisher allocation. No historical backfill was performed.

Future backfill plan: define source-key reconstruction per legacy settlement path, prove a deterministic unique key and payload hash in a dry-run manifest, reconcile totals, then insert with `INSERT IGNORE` plus conflict reporting in a separately authorized maintenance task.

## 10. GEO confidence design

Confidence order is manual admin (`verified`), verified metadata (`high`), request-country majority of at least 60% (`medium`), publisher selection (`publisher_declared`), otherwise `unknown`. Conflicting selected/strong evidence sets `conflict_detected` and review status. Language/content is recorded as a hint only and never promotes confidence. No existing channel audience was bulk changed, and unknown never defaults to Global.

## 11. Admin health metrics

Dashboard cards expose fraud coverage percent, never evaluated, stale evaluations, oldest age, GEO conflicts/stale, high-risk publishers, unresolved critical flags, manual-review withdrawals, incomplete-coverage withdrawals, seven-day concentration alerts, and ledger gaps/cutover state. Withdrawal rows show reasons and disable unsafe approval. Channel details show selected/authoritative GEO, confidence, reason, and conflict.

## 12. Authorized/test-account exemption

Exemptions are user-scoped to `publisher_trust_auto_ban`, never inventory-whitelist entries. Records require type and reason and retain creator/updater, timestamps, active state, and optional expiry. The enforcement worker checks once before transaction work and again inside the transaction after `SELECT ... FOR UPDATE`. Silver was not hardcoded, exempted, unbanned, or otherwise modified.

Admin unban requires one of:

- `trust_remediation` (default): reset publisher trust to 60 and disable an existing exemption;
- `enforcement_exemption`: preserve trust and create/update the audited scoped exemption;
- `no_remediation`: preserve trust, require a reason, disable exemption, and warn that enforcement can re-ban.

## 13. Tests/results

- Focused safety + audience targeting tests: **21 passed, 0 failed**.
- New safety suite alone: **11 passed, 0 failed**.
- Focused ESLint on all changed TS/TSX files: **0 errors, 1 existing `react-hooks/exhaustive-deps` warning** in the admin users page.
- `git diff --check` on changed implementation files: **passed**.
- `bash -n deploy-vps.sh`: **passed**.
- Full TypeScript typecheck: **not run on the production host** because it had one CPU, load average 9.72–18.28, and active MariaDB/PHP/Next workloads. ESLint's TypeScript parser validated changed-file syntax.
- Isolated Node 24 build: **not run** for the same production resource-safety reason.

## 14. Remaining risks

- Migration 0123 must be applied before deploying source. In particular, audited exemptions depend on its table.
- Existing legacy `campaign_clicks` behavior remains unchanged and may contain raw fields; the new sidecar telemetry is privacy-minimized.
- GEO rows for existing inventory remain absent/unknown until a future evidence-backed classification or normal admin activation; this is intentional to avoid silent mutation.
- Canonical ledger shadow writing still depends on `CHANNEL_ALLOCATION_LEDGER_SHADOW_WRITE_ENABLED`; no historical financial backfill was attempted.
- Withdrawal pre-clearance is deliberately conservative. A separate reviewed resolution/override workflow may be added later; this change does not auto-reject.
- Run full typecheck and isolated build during a low-load maintenance window before deployment.

## 15. Exact deployment/migration/restart steps

Run only in an approved maintenance window:

```bash
ssh adsgalaxy-codex
cd /www/wwwroot/bots/AdsFusion

# Confirm the intended files and obtain a database backup using the operator's normal secure backup process.
git diff --check
/root/.nvm/versions/node/v24.15.0/bin/node --test tests/channel-safety-foundation.test.mjs tests/channel-audience-targeting.test.mjs
nice -n 10 /root/.nvm/versions/node/v24.15.0/bin/node ./node_modules/typescript/bin/tsc --noEmit --pretty false

# Prefer a dedicated new HMAC key in .env; do not print it.
# TELEMETRY_HASH_SECRET=<strong random secret>

# The reviewed deploy script now applies migration 0123, builds in .next-build,
# promotes atomically only on success, and restarts AdsFusionApp.
bash deploy-vps.sh

# Verify after deployment.
pm2 status AdsFusionApp
curl -fsSI https://app.adsgalaxy.online/admin
pm2 logs AdsFusionApp --lines 100 --nostream
```

Allow the normal scheduled fraud worker to advance coverage; do not manually force production evaluations. Confirm admin dashboard coverage, channel GEO display, and withdrawal pre-clearance without acting on withdrawal #18. No deployment, migration, PM2 restart, cron invocation, or production data mutation was performed during this implementation task.
