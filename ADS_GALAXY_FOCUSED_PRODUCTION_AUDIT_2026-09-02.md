# Ads Galaxy focused production audit — 2026-09-02

Scope: read-only production investigation plus narrowly authorized source changes. Financial data below is a UTC snapshot; balances and settlement rows can continue changing while production runs. No deployment, production migration, PM2 action, withdrawal decision, balance mutation, reward reversal, or ban/unban was performed.

## Executive findings

- Channel registration: recent backend failures were MySQL `ECONNRESET` events, not the new audience format. The API correctly returns a structured `{ error: { code, message } }`, but both channel clients passed the object to `new Error`, producing `[object Object]`. The source fix adds safe structured-error parsing, bounded retry for idempotent reads/updates, ambiguous-insert recovery, and a safe 503 for transient database failures.
- Direct Mini App reward callbacks: migration `20260801_0109_direct_miniapp_reward_callbacks.sql` already contains the required additive schema, but production lacks the callback table and two delivery columns, and `deploy-vps.sh` omitted the migration. Source now wires the migration and distinguishes `CALLBACK_SCHEMA_NOT_READY` from “Disabled by publisher.” The migration was not run.
- Mini App #26: Ads Galaxy mediation selected only GigaPub. That provider timed out or failed to load its SDK; every alternative was disabled. This is a publisher/admin network configuration/integration problem, not a confirmed Ads Galaxy platform defect, so security and mediation rules were not weakened.
- Admin search: source now treats numeric `26` and `#26` as Mini App ID 26 while retaining all existing text search and shared pagination/count filters.
- Withdrawal #18: recommend **not payable / hold for manual fraud review**. Its amount is mathematically covered by the account balance, but the account has 29 open referral-abuse flags, extremely bursty/sparse-quality referrals, and a fraud-engine coverage gap.
- Vatalinos: no missing balance was found. The full $0.85973881 reconciles to a $0.50 join reward plus $0.35973881 advertising earnings; $0.18360282 remains locked by the normal settlement hold.

## 1. @Cade_Owner and Silver audit

### Snapshot and withdrawal #18

Snapshot time: `2026-09-02 07:56:45 UTC`.

| Item | Evidence |
|---|---:|
| User | ID 78930, `Cade_Owner`, active/not banned |
| Withdrawal | #18, **19.15000000 USDT**, BEP-20, pending, fee 0, paid_out 0 |
| Created | 2026-09-01 04:31:35 UTC |
| Wallet reuse | hashed wallet `wallet:9476abab813a00f8`; one withdrawal / one user observed |
| Available | 0.93908423 |
| Locked | 22.50449575 |
| Total | 23.44357998 |

Exact balance reconciliation:

```text
0.50000000  join reward
17.32511843 advertising publisher earnings
5.61846155  paid referral ledger
-----------
23.44357998 total balance

Available = 0.50000000 + 13.97062268 unlocked ads
          + 5.61846155 paid referrals - 19.15000000 pending withdrawal
          = 0.93908423

Locked    = 3.35449575 locked ads + 19.15000000 pending withdrawal
          = 22.50449575
```

There is no negative balance and no unexplained gap in the current arithmetic. The pending withdrawal moved funds from available to locked; it has not been paid.

### Advertising backing and settlements

- 815 settled click units: 640 unlocked and 175 locked.
- Advertisers were charged $47.95920000 for those rows; publisher credit was $17.32511843.
- No fraud adjustment is recorded on those settlement rows.
- Current click-settlement ranges: unlocked 2026-07-31 20:20:57 through 2026-08-03 07:30:07 UTC; locked 2026-08-03 14:30:24 through 2026-09-02 07:01:21 UTC.
- Channel advertiser-debit rows attribute 768 units / $45.14920000 advertiser debit / $16.30473683 publisher credit across channels 1078, 1079, and 1080. The smaller canonical `channel_settlement_ledger` contains only 47 historical units ($2.81 debit / $1.02038160 credit), indicating a ledger-cutover/coverage difference that should be reconciled before relying on that newer ledger alone.

Channel evidence:

| Channel | Subscribers | State | Debit units / advertiser / publisher | Fraud coverage |
|---|---:|---|---:|---|
| 1078 `bashlafilms` | 91,528 | active | 39 / $2.1996 / $0.75579163 | never evaluated |
| 1079 `cadefilmss` | 99,491 | active | 67 / $3.7378 / $1.28896739 | never evaluated |
| 1080 private `Cade Films` | 377,647 | active | 662 / $39.2118 / $14.25997781 | never evaluated |

All three currently show quality 100, low traffic risk, publisher trust 60, fraud risk 0, but `fraud_last_evaluated_at IS NULL` and `fraud_clean_streak = 0`. Those scores are therefore not proof of a completed clean evaluation.

### Referral evidence

- 921 referrals total; 734 were created on 2026-07-31 and 162 on 2026-08-01.
- Largest hourly bursts were 253, 166, and 134 creations.
- States: 883 joined/pending-verification with join reward paid; 17 fraud/verified/high-risk; 10 paid/verified/high-risk; 9 paid/verified/low-risk; 2 rejected self-referrals/critical.
- Open flags: 27 `mass_referral_creation` high-risk plus 2 `same_ip_or_device_self_referral` critical.
- Only 39 of 921 rows have captured IP/device/user-agent signals. Within that sparse sample: 36 distinct IPs, 29 devices, and duplicate device clusters up to four referrals. Two self-referrals were blocked. Sparse telemetry prevents a strong “no overlap” conclusion.
- 885 rows show reward-paid timestamps without a verification timestamp, predominantly immediate join rewards; another 17 were paid before their later verification timestamp.
- Paid referral ledger totals $5.61846155 after excluding 19 reversed join rewards totaling $0.095. The paid components include $4.51 join rewards, $0.19 verified rewards, $0.17 fraud-classified rewards, promotion/milestone rewards, and $0.03846155 publisher commission.
- Referred-user downstream activity is exceptionally weak: 9/921 own a channel, 0 own bots, 0 own Mini Apps, 0 made a paid deposit, 0 withdrew, and 0 are currently banned.

The balance is arithmetically valid, but the **$5.61846155 referral-derived portion is questionable** pending case review. The pending 19.15 USDT withdrawal exceeds advertising earnings alone by $1.82488157, so it cannot be characterized as fully advertising-backed without accepting some referral/join funds.

### Why Cade was not auto-banned

`src/lib/publisherTrustEnforcement.ts` bans only when both conditions hold:

1. publisher trust score `<= 20`; and
2. `balance_available >= 9.8`.

It ignores locked balance and referral-abuse flags. Cade has trust 60 and, after creating withdrawal #18, available balance below $9.80. Cade therefore did not meet either current ban predicate.

There is also a concrete coverage bug in `runChannelFraudDetection()` (`src/lib/channelFraudDetection.ts`): every run selects active/paused channels with `ORDER BY id ASC LIMIT 200`, with no cursor/rotation. Cade’s channels are IDs 1078–1080 and have never been evaluated, while the same oldest channel slice can be revisited. This gap allowed the account to remain active without the newer channels feeding the trust engine. Referral abuse flags are not integrated into the publisher trust auto-ban decision.

### Silver comparison

The relevant account is unambiguous: user ID 6, username `Silver_Got_paid`, withdrawal #10.

- Withdrawal #10: **181.70000000 USDT**, BEP-20, successful/paid, created 2026-07-03 19:02:54 and paid 19:03:49 UTC.
- Immediately before withdrawal creation, admin audit #110 manually changed locked balance from $0.28651050 to $97.28651050 and available from $22.70575 to $181.70075. Approval audit #111 then approved the withdrawal.
- Organic sources recorded by payment time were only $0.29651050 click earnings, $0.04560000 view earnings, $22.25 paid referral ledger, and $0.50 join reward: $23.09211050 total. The payment exceeded those sources by $158.60788950 and was enabled by the manual balance adjustment. Suspicious/manual funds were therefore included.
- The approval code’s decisive financial checks were withdrawal state/idempotency and sufficient locked balance. It did not gate payment on trust score, channel fraud history, or referral flags.
- Silver has repeatedly been manually banned/unbanned and auto-banned. Recorded auto-ban events occurred when trust was at/below 20 and available balance was at/above $9.80: approximately $18.14012 and $18.14612 on July 9, $69.39604 on July 14, $9.84324063 on July 31, $10.12661901 on August 22, and $12.91699123/$13.41699123 around August 31–September 1. Manual audit reasons also include “fake ads creation.”
- Silver’s channels 2 and 60 are now paused with trust -100/risk 100; channel 61 is `channel_not_found`. Fraud events repeatedly record deleted/inaccessible channel behavior. The user itself was manually unbanned again and is currently active with publisher trust -20, available $0, locked $97.08730598.

Enforcement is inconsistent in coverage and signal integration, not in the literal trust-rule comparison. Silver repeatedly met the exact rule; Cade did not because Cade’s trust never dropped and the available-only test ignores the pending-withdrawal locked balance. Cade’s unevaluated high-ID channels and unconsumed referral flags explain why the trust score never reflected the observed risk.

Recommendation: **withdrawal #18 is unpayable at present / hold for manual fraud review**. This is a recommendation only; no withdrawal or user state was changed.

## 2. Channel registration

### Root cause

Recent PM2 error logs classify multiple registration failures as `ECONNRESET` during operation `create`, alongside broader database reset activity. The API catch converted this to the generic `CHANNEL_CREATE_FAILED` object. The clients then executed `new Error(data.error || fallback)`, coercing that object to `[object Object]`.

The region change is not the root failure:

- UI supplies one supported slug: africa, asia, europe, north_america, south_america, or oceania.
- `normalizeChannelAudience()` accepts a string or a one-item legacy array and rejects empty/multiple/invalid selections.
- API stores `JSON.stringify([normalizedAudience])` in `channels.audience_continents` (MEDIUMTEXT), matching current consumers.
- Categories remain a JSON array in LONGTEXT.
- Telegram access/type/member count, duplicate `chat_id`, and reactivation validation remain intact.

### Source fix

- Shared `getApiErrorMessage()` supports legacy string errors and structured `{code,message}` errors and always falls back to a string.
- Both AddChannel clients use it for Telegram lookup and registration.
- Read queries and idempotent reactivation updates use the existing bounded database retry helper.
- New `INSERT` is not blindly retried. On a transient reset it queries by `chat_id` to determine whether the commit succeeded, preventing duplicate registration under an ambiguous connection loss.
- Remaining transient DB failures return `DATABASE_TEMPORARILY_UNAVAILABLE` / HTTP 503 with a safe publisher message. SQL and exception text remain server-side and classified.

## 3. Mini App direct reward callbacks

### Schema and deployment gap

Production lacks:

- table `miniapp_reward_callbacks`;
- `developer_webhook_deliveries.miniapp_reward_callback_id`;
- `developer_webhook_deliveries.miniapp_id`.

Migration `db/migrations/20260801_0109_direct_miniapp_reward_callbacks.sql` already creates the callback configuration table, adds nullable outbox destination columns, indexes them, and preserves existing Developer webhooks. It is additive and guarded. `deploy-vps.sh` skipped from migration 0107 to 0114, so 0109 was never applied through the normal list. Source now includes 0109 in order. Production was not migrated.

### Configuration, status, and safety

- Ownership check requires the authenticated publisher to own the non-deleted Mini App.
- Callback URLs must use public HTTPS with no embedded credentials; DNS answers are checked against local/private/reserved targets.
- The UI saves/enables, disables without deleting history, and rotates a 32-byte secret with a 24-hour previous-secret overlap.
- The secret is returned only on initial creation or rotation.
- The route now checks schema readiness and emits safe structured `CALLBACK_SCHEMA_NOT_READY` (503). SQL/table names are not exposed.
- The panel displays “Unavailable — callback database setup is pending” and disables actions. It no longer falsely says “Disabled by publisher.”
- `disabled_by_publisher` remains correct only for an existing/configurable callback whose publisher status is disabled. `saved_platform_disabled` distinguishes a saved active configuration while the global feature flag is off.

### Reward event, delivery, retries, and idempotency

- Qualifying direct callbacks are created only after an internally verified completed ad in `src/app/api/miniapp/internal-ads/impression/route.ts`.
- External browser-only completion remains client-confirmed/ineligible without request-level provider proof.
- Reward event creation is request-ID idempotent.
- Direct outbox logical key is `direct:{callback_id}:{event_id}:reward.eligible`; `INSERT IGNORE` prevents duplicate enqueue.
- Payload exposes only event_id, request_id, mini_app_id, verified Telegram user_id, status, and completed_at.
- Signature is HMAC-SHA256 over `timestamp.event_id.rawBody`. Delivery uses pinned validated DNS, verified TLS/SNI, no redirects, a 10-second timeout, and a bounded 64 KiB response hash.
- Delivery is at least once. Failures retry after 1, 5, 15, 60, and 360 minutes; attempt six is terminal. The receiver must enforce unique event_id in the same transaction as reward credit.
- Disabled direct-callback rows are excluded from leasing while existing Developer webhook deliveries remain unaffected.

The mock transport suite proves public URL enforcement, DNS rebinding resistance, redirect refusal, TLS host preservation, timeout, and bounded response handling. Source/behavior suites prove flag gating, transaction-scoped enqueue, stable event IDs/bodies across retries, idempotent logical keys, disable behavior, and safe schema status. A production persistence/delivery E2E cannot truthfully pass until the approved migration is applied and the feature is enabled; neither action was authorized in this pass.

Documentation was extended in the existing Publisher Mini App and Developer pages with configuration status, one-time secret handling, expected response behavior, retry schedule, schema-unavailable distinction, and common failures.

## 4. Mini App #26

Mini App row:

- ID 26, name REDTUBE, bot username `redtube12_bot`, bot ID 8924747237.
- Owner user ID 81763, username `o_oxmahi`.
- Web App URL `https://redtube-nine.vercel.app/`; Telegram Mini App link is present.
- Approved by admin on 2026-08-21 10:48:44 UTC; active/not deleted; quality 60 (`good`), traffic risk low; no revenue-protection hold.

Network configuration:

- GigaPub: enabled, placement configured.
- AdsGalaxyInternal, AdsGram, AdExium, Monetag, RichAds: disabled.

After the 2026-08-21 network changes, mediation diagnostics select GigaPub exclusively and record every other provider as skipped because it is disabled. Recent request aggregates include 358 selected GigaPub requests on August 22 and 63 on August 24 with zero confirmed impressions. Historical GigaPub failures are 1,196 `TIMEOUT` (“Ad timed out”) and 231 `SDK_UNAVAILABLE` (“Ad source failed to load”); provider health is 64 with no recorded success.

Exact cause: the sole enabled provider’s client SDK is not completing/loading. AdsGalaxy has no alternate enabled demand source, so calls time out or end with no fill. Approval, domain, Telegram bot identity, traffic quality, and platform revenue protection are not the blocking predicates in the inspected records.

Required publisher/admin correction: fix and validate the GigaPub SDK/placement in the actual Telegram WebView, or have an authorized admin enable a working eligible provider/internal demand source. Do not bypass Telegram initData, domain/origin validation, provider confirmation, frequency caps, or revenue backing. No source change was made because no Ads Galaxy backend defect was confirmed.

## 5. Admin Mini App search

The route previously searched name, Mini App username, bot ID, owner names/username, and Telegram ID, but not `m.id`. It now trims input, strips leading `#` only for numeric-ID interpretation, and adds exact `m.id = ?` to the same WHERE clause used by both list and count queries. Therefore `26` and `#26` find ID 26 without changing text search, filters, pagination, or total counts.

## 6. @Vatalinos balance audit

Snapshot: user ID 234, active/not banned; available $0.67613599, locked $0.18360282, total **$0.85973881**.

Exact reconciliation:

```text
$0.50000000 join reward
$0.17613599 unlocked click earnings (7 rows, 10 clicks)
$0.18360282 locked click earnings   (7 rows, 7 clicks)
-----------
$0.85973881 total
```

- No deposits, referrals/referral earnings, withdrawals, pending withdrawals, referral reversals, fraud billing adjustments, or reconciliation debits were found.
- No unexplained admin balance adjustment was found in the reviewed audit trail.
- The unlocked settlement rows span 2026-06-20 through 2026-07-25 UTC.
- The locked rows span 2026-08-12 through 2026-08-30 UTC and are still in the ordinary settlement hold.
- Channel 362 is active, quality/trust 100, low risk, fraud risk 0, with current fraud evaluation coverage.

Conclusion: no balance disappeared and no deduction event/timestamp exists. The apparent difference is the UI/accounting distinction between available and locked earnings. There is no missing ledger entry in the source-of-truth reconciliation.

## 7. Mini App CPM engine — audit only

No CPM code or setting was changed.

### Internal AdsGalaxy inputs and formulas

Primary implementation: `src/lib/miniappPublisherCpmEngine.ts`, especially `getMiniAppPublisherCpmSettings()`, `maxPublisherCpm()`, `repeatPenaltyFactor()`, and `calculateMiniAppPublisherPayout()`.

Production settings observed during the audit:

- min/recommended/max advertiser CPM: $2.50 / $6.00 / $32.00;
- publisher / AdsGalaxy / reserve shares: 60% / 30% / 10%;
- quality-factor min/max: 0.10 / 0.90;
- sensitivity: medium;
- repeat penalty and reserve pool: enabled.

Exact live-mode calculation for one internal impression:

```text
gross revenue                = advertiser CPM / 1000
publisher ceiling CPM       = advertiser CPM × publisher_share (60%)
diversity score              = unique users / impressions today
country score                = 0.85 when any country string exists, otherwise 0.70
repetition score             = 1.00 for repeats 1–3
                             = 0.85 for 4–10
                             = 0.65 for 11–20
                             = 0.40 for 21–50
                             = 0.20 above 50
engagement score             = constant 0.75
raw quality                  = average(country, diversity, repetition, engagement)
quality factor               = clamp(0.10 + raw quality × (0.90 - 0.10), 0.10, 0.90)
live publisher CPM           = ceiling CPM × quality factor × repetition score
publisher revenue            = publisher CPM / 1000
reserve                      = gross revenue × 10%
AdsGalaxy revenue            = max(0, gross - publisher revenue - reserve)
```

Repetition is effectively applied twice in live mode: once inside the averaged quality factor and again as the final multiplier. Fixed mode uses `min(fixedPublisherCpm, publisher ceiling CPM)` and sets quality/repeat metadata to null, so it bypasses the dynamic quality and repeat decay while retaining the 60% revenue ceiling.

`src/lib/miniappInternalAds.ts` charges the advertiser at advertiser CPM/1000 only after request-id/idempotency, balance, campaign budget, pacing, schedule, targeting, and optional per-user daily frequency-cap checks. Campaign country targeting is applied only when a country value exists; missing country can bypass the country inclusion test.

### GEO and identity

No Tier 1/Tier 2/Tier 3 country table or per-country value exists in the payout engine. All non-empty country strings receive 0.85 and missing country receives 0.70. SDK function `country(options)` currently resolves `options.country || Telegram user.language_code || ""`; consequently values such as EN, FA, ID, and AR are stored as country-like data for Mini App #26. This is language, not reliable GEO.

Repeated exposure is keyed by Telegram user ID for the same campaign + Mini App + current database day. The CPM engine does not use IP, device, session, or fingerprint. The campaign may add `frequency_cap_per_user`; internal optimization/cooldown rules provide additional request throttling, but fixed CPM does not economically decay repeated eligible views.

### External networks and dashboard CPM

External provider revenue is reconciled separately. Publisher revenue is provider gross revenue less the configured external platform fee (observed 15%), clamped so publisher revenue cannot exceed gross. It does not reuse the internal GEO/quality formula. Browser-side external display events initially carry no trusted revenue; earnings require provider/reconciliation input.

Publisher dashboard average CPM is the selected-period aggregate:

```text
SUM(publisher_revenue) / SUM(impressions) × 1000
```

Mini App #26 has 2,021 recorded internal impressions, $2.13967379 publisher revenue, and an average publisher CPM of about $1.05872 over those rows. A display of 3,161 impressions and $2.30 revenue yields `$2.30 / 3161 × 1000 = $0.72762`, consistent with the reported approximately $0.7261 after using the dashboard’s exact unrounded revenue/date selection. No current production aggregate exactly matching that historical screenshot was found, so this is a formula-based reconstruction rather than attribution to a specific surviving row set.

### Economic weaknesses and redesign recommendation

Current hard revenue ceilings protect the internal split from paying more than the advertiser charge, and external reconciliation clamps publisher revenue to gross. The main weaknesses are economic quality rather than a direct overpayment arithmetic bug:

- language code is treated as GEO and there are no demand/yield country values;
- missing GEO can bypass campaign country targeting;
- engagement is a constant, not measured performance;
- fixed mode bypasses quality/repeat decay;
- repeat control has no device/session/IP/fingerprint dimension;
- the same repetition signal is applied twice in live mode without an explicit economic calibration;
- upstream external yield and internal bid economics live in separate paths;
- selected external displays can exist before backed provider revenue arrives;
- publisher trust/fraud and conversion performance are not first-class CPM inputs.

Recommended future architecture, without choosing rates yet:

1. Normalize trustworthy GEO separately from Telegram language, with explicit unknown-GEO handling and demand-derived country/value bands.
2. Compute a conservative revenue envelope from actual advertiser bid or reconciled upstream yield.
3. Reserve a guaranteed platform+fraud margin before calculating the publisher ceiling.
4. Calculate quality/trust multipliers from verified completion, conversion/click quality, fraud score, publisher trust, and sample confidence.
5. Add user/campaign/Mini App frequency decay with Telegram identity plus privacy-safe device/session/fingerprint signals and hard rewarded-loop caps.
6. Make fixed overrides explicit, audited, expiring, and still subject to revenue backing and abuse decay.
7. Separate provisional external impressions from financially settled earnings.
8. Version the formula and persist every input/factor/output for reproducible settlement and dashboard explanations.
9. Simulate historical data and define floors/caps only after measuring GEO yield, demand fill, repeat curves, and required margin.

## 8. Verification and operational handoff

Verification results:

- 38 focused Node source/behavior/mock-receiver tests passed.
- The MariaDB callback/migration integration suite discovered 18 tests but skipped them because the explicitly isolated local test database/client variables are not configured; it did not touch production.
- Focused ESLint passed.
- A focused strict TypeScript check of the changed dependency graph passed.
- Isolated build did not complete: the server default Node 18 is below Next.js 16's Node 20.9 minimum. A second isolated attempt under the installed Node 24 runtime was stopped when the live host reached sustained high load and low available memory. No build was promoted, live `.next` was untouched, and the partial isolated directory was removed.

Required later release steps (not executed):

1. Review and commit the scoped source changes while preserving unrelated dirty worktree changes.
2. Back up the production database and confirm the target schema/database.
3. Run the additive `db/migrations/20260801_0109_direct_miniapp_reward_callbacks.sql` through the normal guarded deployment migration runner.
4. Verify the callback table, foreign keys/indexes, and new outbox columns.
5. Deploy/build using the project’s isolated build workflow, then restart/reload PM2 through the approved deployment process.
6. Enable `MINIAPP_DIRECT_REWARD_CALLBACKS_ENABLED=true` only after schema verification and controlled staging/mock-receiver validation.
7. Run a controlled callback lifecycle test: save URL/copy secret, create a verified internal reward, verify signature and unique event_id credit, force a retry, confirm no duplicate credit, disable, and confirm no future direct rows are leased.
