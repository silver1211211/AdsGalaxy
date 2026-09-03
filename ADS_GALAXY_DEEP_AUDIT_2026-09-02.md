# Ads Galaxy deep production audit — 2026-09-02

Audit mode: live production, source and database read-only. Snapshot values in this report were queried between 14:31 and 14:35 UTC on 2026-09-02. Production continued to accrue activity during the audit. No deployment, migration, service action, user/account action, withdrawal decision, balance change, fraud change, or CPM change was made. The only production writes are this requested report and its summary.

## Executive conclusions

- Silver is user ID 6 (`Silver_Got_paid`, Telegram ID 7701909986). Seven automatic bans are conclusively recorded. Every one came from the same publisher-trust rule: `publisher_trust_score <= 20 AND balance_available >= 9.80`. The comparisons were correct, but applying this production fraud policy to an authorized test account without an exemption is operationally wrong. The repeated re-bans are deterministic: the ordinary user unban clears ban state but does not repair/reset/freeze the user trust score, so the next 15-minute enforcement bucket bans again whenever available balance remains at least 9.80.
- Cade is user ID 78930 (`Cade_Owner`, Telegram ID 5399701301). Withdrawal #18 remains pending for 19.15 USDT. The balance is mathematically funded, but only 14.60562268 USDT is presently defensible as cleared/low-risk value; 4.54437732 USDT of the request necessarily depends on questionable or unresolved referral value. Recommendation: HOLD for referral-fraud review, not pay or reject yet.
- Cade was not banned because trust is 60 (threshold is <=20), available balance after withdrawal is below 9.80, referral flags are not inputs to trust enforcement, and channels 1078–1080 have never been fraud-evaluated.
- Channel fraud coverage is materially broken: source always runs `ORDER BY id ASC LIMIT 200` with no cursor/pagination. Current live population is 696 eligible channels; only 210 have any evaluation row and 486 have never been evaluated. All Cade channels are in the uncovered high-ID population.
- Mini App live publisher CPM is bounded by 60% of advertiser CPM, then multiplied by a quality factor and repeat factor. Repetition is included once inside quality and then multiplied again. GEO is not economic GEO: any non-empty string gets the same 0.85 score, and the SDK defaults that string to Telegram `language_code`.
- The screenshot's `Internal Ad Revenue ≈ Publisher Revenue` and zero `Platform Fee Revenue` is a reporting-definition bug: `miniappRevenueEngine.ts` labels internal **publisher revenue** as internal ad revenue and calculates platform fee only for external rows. The underlying internal ledger currently shows nonzero margin.

## Audit 1 — Silver automatic bans

### Identity and current state

The live identity matches prior evidence: user ID 6, username `Silver_Got_paid`, Telegram ID 7701909986, created 2026-05-06 08:00:23 UTC. Current state is active/not banned; available 0, locked 97.08730598; publisher trust -20 and publisher risk 100.

Relevant channels include #2 and #60, both paused with trust -100/risk 100; #61 is `channel_not_found`, trust -100/risk 100. Several higher-ID channels remain paused but were never fraud-evaluated. Fraud events repeatedly identify deleted/inaccessible channel patterns. The authorized balance adjustment and completed test withdrawal are explicitly excluded from fraud conclusions as instructed.

### Exact rule and code path

The sole automatic user-ban implementation found is `enforcePublisherTrust()` in `src/lib/publisherTrustEnforcement.ts`, invoked by `src/app/api/cron/publisher-trust-enforcement/route.ts` and also reachable after channel settlement through `src/lib/channelSettlement.ts`.

Constants and decision:

```text
PUBLISHER_TRUST_BAN_THRESHOLD = 20
PUBLISHER_AVAILABLE_BALANCE_THRESHOLD = 9.8

candidate: user trust <= 20, not already banned, owns a non-deleted channel
ban:       candidate AND balance_available >= 9.80
reason:    Low Trust Score with Withdrawable Balance Threshold Reached
```

On a ban it atomically sets `users.status='banned'`, `is_banned=1`, timestamps/reason, and pauses all non-deleted publisher channels. It records `publisher_trust_enforcement_events`, a critical fraud event per channel, and `admin_action_audits` action `publisher_trust_auto_ban`.

Other inspected state-changing paths are manual: admin users ban/unban, withdrawal-review ban, admin automation suspension, and channel control-center actions. Referral abuse creates flags but does not ban. `runChannelFraudDetection()` changes trust/risk, but currently returns `publishersBanned: 0`; the separate trust job performs the user ban. No withdrawal-safety, traffic-quality, Mini App, referral, or channel job contains another automatic `users.status='banned'` transition.

### Every recorded automatic ban

| Auto-ban time UTC | Trust | Available USDT | Required | Condition met | Later unban UTC |
|---|---:|---:|---:|---|---|
| 2026-07-09 00:03:23 | -2.8 | 18.14012000 | trust <=20 and available >=9.80 | both | 2026-07-09 00:13:47 |
| 2026-07-09 00:17:02 | -2.8 | 18.14612000 | same | both | 2026-07-09 00:17:30 |
| 2026-07-14 00:03:03 | -20 | 69.39604000 | same | both | 2026-07-14 12:59:08 |
| 2026-07-31 00:03:06 | -20 | 9.84324063 | same | both | 2026-07-31 19:39:35 |
| 2026-08-22 11:22:23 | -20 | 10.12661901 | same | both | 2026-08-22 13:00:12 |
| 2026-08-31 20:17:10 | -20 | 12.91699123 | same | both | 2026-09-01 15:24:57 |
| 2026-09-01 16:17:13 | -20 | 13.41699123 | same | both | 2026-09-02 05:52:54 |

The first July 9 recurrence happened only 3m15s after manual unban because the next 15-minute bucket saw unchanged trust/balance. The September 1 recurrence happened after the same pattern. In addition, manual ban/unban records exist on July 4 and July 8, including manual reason `fake ads creation`; these are not auto-bans.

At each automatic decision, the event table captures the exact trust, available balance, 9.80 threshold, decision, reason, and timestamp. User risk was driven by channel fraud; current risk is 100, and the channel evidence consists principally of repeated deleted/inaccessible-channel events. Multiple fraud signals can lower trust, but only the single trust+available rule changes the user to banned, so there are not multiple simultaneous automatic ban implementations.

### Correctness, exemption, and repeated-ban diagnosis

- Silver was genuinely outside the literal production thresholds at all seven auto-bans.
- The trust/risk evidence is not fabricated by the comparator: channels #2/#60/#61 carry severe persisted values and repeated accessibility/deletion signals.
- The policy has no authorized/test-user exemption. Searches found only inventory `whitelist` behavior (ranking) and a channel-level temporary trust freeze; neither exempts user trust enforcement.
- The ordinary admin user unban in `src/app/api/admin/users/route.ts` only clears status/ban fields. It does not reset/freeze user trust. This makes re-ban expected on the next job while both predicates remain true.
- The channel control-center reactivate action resets the user trust to 60 and freezes channel trust for 24 hours, but the enforcement job does not directly check `trust_score_frozen_until`; that field only stops channel fraud from changing channel trust during the freeze.
- Recommended future location: a first-class, audited user enforcement policy (`user_enforcement_exemptions` or explicit user role) checked both in the candidate SELECT and again inside the locked transaction. It should be scoped, expiring, reasoned, admin-attributed, and visible in audit logs. Do not overload inventory whitelist. Separately, unban should require a disposition: exemption, trust remediation/reset with freeze, or acknowledgement that immediate re-ban is expected.

Conclusion: comparator behavior is correct; test-account handling and unban workflow are incomplete/too aggressive for authorized testing.

## Audit 2 — @Cade_Owner and withdrawal #18

### Account and balance reconciliation

Live account: user ID 78930; Telegram ID 5399701301; username `Cade_Owner`; created 2026-07-31 14:17:06 UTC; active, not banned, no automation suspension, normal revenue protection; publisher trust 60/risk 0. No ban history was found in the user action trail. Withdrawal #18 was submitted 2026-09-01 04:31:35 UTC for 19.15 USDT on BEP-20; it remains pending, fee 0, paid_out 0.

At withdrawal submission, the reconciled account was:

```text
0.50000000  join reward
17.32511843 advertising publisher earnings
5.61846155  paid referral ledger
-----------
23.44357998 total

Available before request: 20.08908423
Locked before request:     3.35449575
Withdrawal transfer:     -19.15000000 available, +19.15000000 locked
Available after request:   0.93908423
Locked after request:     22.50449575
```

Current snapshot changed only through later accruals:

```text
0.50000000  join reward
17.34236657 advertising earnings (13.97062268 unlocked + 3.37174389 locked)
5.62346155  paid referral ledger
-----------
23.46582812 = 0.94408423 available + 22.52174389 locked
```

No Cade deposit, paid withdrawal, refund, manual adjustment, Mini App earning, bot earning, fraud billing adjustment, or unexplained balance source was found. Withdrawal #18 is a hold/transfer between available and locked, not a debit from total wealth.

Balances are fungible and the withdrawal table does not persist source-lot allocation, so no truthful audit can claim a uniquely exact source composition. Using the maximally favorable allocation (all unlocked ads and join reward first), the 19.15 request necessarily contains:

```text
13.97062268 advertising earnings
0.50000000  join reward
4.67937732  referral-derived funds (minimum unavoidable referral portion)
-----------
19.15000000
```

### Advertising / channel audit

Cade owns exactly channels 1078, 1079, 1080, all active, approved/not deleted, not under review, and without settlement exclusion:

| Channel | Audience/category | Subscribers | Trust/risk | Fraud evaluated |
|---|---|---:|---|---|
| 1078 `bashlafilms` | Africa / Entertainment | 91,528 | 60 / 0 | never |
| 1079 `cadefilmss` | Africa / Entertainment | 99,491 | 60 / 0 | never |
| 1080 private `Cade Films` | north_america / Entertainment | 377,647 | 60 / 0 | never |

Current settlement source-of-truth totals: 816 clicks, advertiser charges 48.00920000, publisher earnings 17.34236657; 640 clicks / 13.97062268 publisher earnings are unlocked, 176 / 3.37174389 remain locked. No view settlement and no fraud-adjusted settlement row exists.

Economic totals imply 30.66683343 retained before interpreting platform/reserve accounting. The newer canonical channel ledger contains only 47 units for Cade (2.81 advertiser debit, 1.02038160 publisher credit, 1.124 platform revenue, 0.66561840 reserve), whereas legacy/current click settlements contain 816 units. This is a ledger cutover/coverage gap, not evidence that the 769 legacy units were uncharged. The ad settlements themselves identify advertiser payments that back the publisher credits.

The available schema captures click fingerprints but not a complete IP/device history for every channel view. Cade's channels were never run through the fraud evaluator, so current quality 100 / risk 0 is a default/stale state, not a completed clean assessment. No evidence supports declaring their traffic clean. Conversely, the reconciled advertiser charges mean the advertising earnings are economically backed in the ledger.

### Referral audit and buckets

Current total is 922 referrals. 890 arrived within 24 hours of account creation and 900 within 48 hours. Daily concentration: 734 on July 31 and 162 on August 1. Peak hours had 253, 166, and 134 accounts. Only 36 referrals are verified; all 922 have a reward-paid timestamp, 886 were paid without any verification timestamp, and 17 were paid before later verification.

States: 884 joined/pending/low-risk, 17 fraud/verified/high-risk, 10 paid/verified/high-risk, 9 paid/verified/low-risk, and 2 rejected self-referrals/critical. There are 27 open high-risk `mass_referral_creation` flags and two open critical `same_ip_or_device_self_referral` flags.

Telemetry coverage is sparse: only 39 rows carry IP/device data, with 36 distinct IPs and 29 devices; two self-referrals were blocked. This cannot support a clean uniqueness conclusion. Downstream activity is exceptionally weak: 9/922 own a channel, none owns a Mini App, none deposited, none withdrew, and none is currently banned.

Current referral balance classification (totals reconcile to 5.62346155):

| Bucket | USDT | Basis |
|---|---:|---|
| Clearly legitimate | 0.13500000 | nine verified low-risk referrals: 0.045 join + 0.090 verified rewards |
| Questionable | 1.06846155 | 0.150 rewards tied to verified high-risk referrals, 0.880 milestone/first-referral bonuses earned from the burst, 0.03846155 publisher commissions lacking enough clean referral context |
| Clearly invalid/fraud-linked in current balance | 0.00000000 | fraud ledger amounts are not included in current `total_referral_earnings` |
| Unresolved | 4.42000000 | 884 join rewards paid while verification remains pending |

Historical excluded/invalid amounts: 0.17000000 verified-referral rows classified fraud plus 0.09500000 reversed join rewards (19 rows, corresponding to fraud/rejected outcomes). These 0.26500000 are not counted in the 5.62346155 current referral-derived balance.

### Why Cade was not banned and fraud coverage

The auto-ban rule evaluated only trust and available balance. Cade's trust 60 fails the `<=20` predicate. After withdrawal submission, available balance is also below 9.80. Locked funds, referral-abuse flags, referral velocity, verification rate, and pending withdrawal are not inputs. Therefore Cade did not qualify under the literal current rule.

`runChannelFraudDetection()` in `src/lib/channelFraudDetection.ts` selects:

```sql
SELECT ... FROM channels
WHERE is_deleted=FALSE AND status IN ('active','paused')
ORDER BY id ASC
LIMIT 200
```

Default limit is 200 (bounded maximum 500), with no offset, cursor, last-evaluated ordering, or rotation. Production currently has 696 eligible channels. Flags show 207 with `fraud_last_evaluated_at`, 489 without; evaluation-table history shows 210 ever evaluated and 486 never evaluated. Cade channels 1078–1080 each have zero evaluations. This is a real, systematic high-ID starvation bug.

Recommended fix structure only: cursor/keyset or `ORDER BY COALESCE(fraud_last_evaluated_at,'1970-01-01'), id`, bounded batches, persisted cursor/lease, multiple pages per run within a time budget, per-channel idempotency bucket, coverage/age SLO metrics, and a full backfill. Referral risk should feed a separate, reviewed user-risk aggregation; do not silently overload channel trust.

### Withdrawal decision

```text
Fully cleared/unlocked advertising: 13.97062268
Clearly legitimate referral:         0.13500000
Join reward:                         0.50000000
Maximum presently defensible:       14.60562268
Questionable + unresolved request:   4.54437732
Clearly invalid amount in request:   0.00000000 proven (historical invalid rewards are excluded)
```

Decision: **HOLD**. The full 19.15 is mathematically funded, but at least 4.54437732 of it exceeds presently cleared/low-risk value. Resolve 29 open flags, verify the referral sample and rewards, run fraud coverage over channels 1078–1080, and reconcile the channel ledger cutover before pay/reject.

## Audit 3 — Mini App CPM engine

### Code-path map

- `src/lib/miniappPublisherCpmEngine.ts`: `getMiniAppPublisherCpmSettings`, `validateAdvertiserCpmBid`, `maxPublisherCpm`, `repeatPenaltyFactor`, `calculateMiniAppPublisherPayout`.
- `src/lib/miniappInternalAds.ts`: campaign selection and `recordInternalAdImpression`; charges advertiser, calls payout engine, persists impression economics and daily stats.
- `src/app/api/sdk/miniapp/impression/route.ts` and `src/app/api/miniapp/mediation/impression/route.ts`: verified impression entry points.
- `src/app/sdk.js/route.ts`: browser SDK identity/country collection; `country(options)` falls back to Telegram `language_code`.
- `src/app/api/cron/settle-miniapp/route.ts`: locks publisher earnings and applies internal publisher revenue into daily stats.
- `src/lib/miniappStats.ts`: generic/external stats ingestion; applies `miniapp_ads_galaxy_fee_percent` (default/current external policy 15%).
- `src/lib/externalNetworkRevenueReconciliation.ts`: reconciles provider reports, clamps publisher payout to provider gross, adjusts settlements.
- `src/lib/miniappRevenueValidation.ts`: upstream-revenue reasonableness/ceiling validation.
- `src/lib/miniappReports.ts`, `src/lib/miniappRevenueEngine.ts`, `src/lib/miniappRevenueOptimizer.ts`: aggregate/blended CPM and admin/publisher reporting.
- Advertiser/admin campaign routes under `src/app/api/advertiser/miniapp-rewarded-campaigns` and `src/app/api/admin/miniapp-rewarded-campaigns`: advertiser bid, CPM mode, and fixed override inputs.

### Current internal formula

Live settings: advertiser CPM min 2.50, recommended 6.00, max 32.00; publisher share 60%, Ads Galaxy share setting 30%, reserve 10%; quality range 0.10–0.90; medium sensitivity; repeat penalty and reserve enabled.

```text
advertiser charge/impression = advertiser_CPM / 1000
publisher ceiling CPM        = advertiser_CPM * 0.60
diversity                     = unique Telegram users / impressions today
country score                 = 0.85 if any country string, else 0.70
repeat score                  = 1.00 for impressions 1–3 by same user/app/campaign/day
                                0.85 for 4–10
                                0.65 for 11–20
                                0.40 for 21–50
                                0.20 after 50
engagement score              = constant 0.75
raw quality                   = average(country, diversity, repeat, engagement)
quality factor                = clamp(0.10 + raw_quality * 0.80, 0.10, 0.90)
publisher CPM (live)          = publisher_ceiling_CPM * quality_factor * repeat_score
publisher earnings/impression = publisher_CPM / 1000
reserve                       = advertiser charge * 0.10
Ads Galaxy retained           = max(0, charge - publisher earnings - reserve)
```

Repeat is applied twice: once in raw quality and once as the final multiplier. Fixed mode uses `min(fixed_publisher_CPM, publisher ceiling CPM)` and bypasses quality/repeat factors entirely. No production impression currently uses fixed mode.

### GEO behavior

There are no country tiers or country-specific values. USA, Canada, UK, Germany, France, Australia, India, Bangladesh, Pakistan, Nigeria, Brazil, and Mexico all receive exactly 0.85 when passed as non-empty strings; unknown/empty receives 0.70. The server does not derive country from IP or a third-party GeoIP source in this path.

SDK resolution is `options.country || Telegram.WebApp.initDataUnsafe.user.language_code || ''`. Production values such as EN, RU, AR, FA, ID and BN confirm language codes are stored as if countries. Publisher-declared/SDK-provided country can override it. Telegram identity/initData is verified for the request, but Telegram language is not geographic evidence.

### Repeated users

Economic repetition identity is Telegram user ID scoped to campaign + Mini App + database day. It does not use IP, device, fingerprint, cookie, or session. Request ID provides idempotency, not user uniqueness. An internal cooldown and optional campaign frequency cap can block some requests, but eligible repeated rewarded views continue earning.

For an otherwise isolated same user with a non-empty country and the current live formula, publisher CPM as a fraction of advertiser CPM is approximately:

| Same-user impression | Publisher CPM / advertiser CPM |
|---:|---:|
| 1st | 46.20% |
| 2nd | 49.20% |
| 3rd | 43.20% |
| 5th | 32.64% |
| 10th | 31.22% |
| 20th | 21.86% |
| 50th | 12.10% |

The counter resets at `CURDATE()`. Click count is not used in payout quality; the requested 10 impressions/1 click example pays according to repeat/diversity, not the click.

### Floors, caps, zero value, and economics

- Advertiser CPM validation floor/cap: 2.50 / 32.00.
- Publisher ceiling: 60% of advertiser CPM; absolute configured ceiling is therefore 19.20 in fixed mode and 17.28 in live mode at maximum quality/repeat.
- Fixed publisher CPM may be configured as zero; thus a zero publisher payout is architecturally possible in fixed mode.
- Live mode has no explicit publisher CPM floor, but current inputs imply a practical minimum about 0.129 CPM at advertiser CPM 2.50, missing country, zero diversity, and >50 repeat bucket. It cannot decay arbitrarily close to zero under present settings.
- Internal arithmetic guarantees publisher + reserve <= advertiser charge because publisher is capped at 60% and reserve at 10%; platform retention is therefore nonnegative and normally at least 30% before dynamic payout reductions.
- External reconciliation sets publisher revenue to `min(max(provider publisher earnings,0), provider gross)` and fee to gross minus publisher, so it prevents negative margin but permits zero margin when provider-reported publisher earnings equal gross. Generic external stats ingestion applies a 15% fee.

Live internal ledger snapshot: 22,518 impressions; advertiser revenue 61.15382000; publisher revenue 18.08721743; Ads Galaxy retained 36.95122257; reserve 6.11538200; publisher blended CPM 0.80323372. This is not zero-margin economics.

The admin screenshot is explained by `src/lib/miniappRevenueEngine.ts`: `internal_ad_revenue` is selected from internal `publisher_revenue`, not internal gross revenue, while `platform_fee_revenue` sums fees only where network is not `AdsGalaxyInternal`. Therefore when external revenue is zero, `Internal Ad Revenue == Publisher Revenue` and `Platform Fee Revenue == 0` by definition even though internal `ads_galaxy_fee` is positive. This is a display/reporting semantic bug.

### Production examples (PII redacted)

| Band | Mini App | Impressions | Unique users | Upstream/advertiser | Publisher | Effective publisher CPM | Platform retained | Reserve |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| High | #44 Cloud Earn Bot | 414 | 75 | 1.61228000 | 0.70053345 | 1.69210978 | 0.75051858 | 0.16122800 |
| Medium | #26 REDTUBE | 2,021 | 321 | 5.30818000 | 2.13967379 | 1.05872033 | 2.63768846 | 0.53081800 |
| Low | #11 ViewfiBot | 5,005 | 11 | 12.51250000 | 1.89954386 | 0.37952924 | 9.36170667 | 1.25125000 |

Repeated-user production buckets confirm decay: average publisher CPM 1.12347 at repeats 1–3, 0.86106 at 4–10, 0.61010 at 11–20, 0.34281 at 21–50, and 0.16994 above 50. Country values cannot be interpreted as GEO because they are predominantly language codes. External GigaPub/AdsGram rows currently contain impressions but zero reconciled revenue and zero publisher payout, proving zero-value external impressions are supported.

### Five largest CPM/economic problems

1. Language code is treated as country, and no country/yield tier exists.
2. Fixed CPM bypasses quality and repeat decay (though still respects the 60% ceiling).
3. Repeat identity is Telegram-only and daily; device/session/network concentration is not priced.
4. Engagement is a constant, and publisher trust/fraud/conversion quality are absent from payout inputs.
5. Reporting mislabels internal publisher earnings as internal ad revenue and omits internal platform fee from the global platform-fee card, hiding actual margin.

Additional weakness: external and internal economics are separate; external browser impressions can exist at zero pending reconciliation, and external provider reports may legitimately yield a zero platform fee under the current clamp.

### Future design (not implemented)

Use a versioned, persisted settlement calculation:

```text
economic_value = verified internal advertiser charge OR reconciled external provider yield
publisher_cap  = min(configured_share * economic_value, absolute_CPM_cap / 1000)

payout = publisher_cap
       * trusted_GEO_value
       * demand/yield_confidence
       * unique_user_quality
       * frequency_decay
       * traffic_quality
       * publisher_trust
       * fraud_risk_factor

0 <= payout <= publisher_cap
platform retained = economic_value - payout - configured reserve >= guaranteed margin
```

Required safeguards: derive GEO from trusted request IP/edge data with explicit unknown; keep language separate; base external payout on reconciled yield; use privacy-safe multi-signal frequency state; allow decay to zero; make fixed overrides audited/expiring and still subject to revenue/margin and abuse caps; separate advertiser charge from publisher payout; persist every input/output and formula version; backtest before selecting a 0–50% share or ~11 CPM absolute cap. Do not impose an arbitrary positive publisher floor.

## Mutations

None to application source, database, services, balances, users, withdrawals, flags, settings, or CPM logic. Only the two explicitly requested audit Markdown files were created.
