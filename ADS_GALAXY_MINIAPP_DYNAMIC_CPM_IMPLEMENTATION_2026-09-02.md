# Ads Galaxy Mini App Dynamic CPM Implementation — 2026-09-02

## Scope and deployment state

Implemented in production source for Mini Apps only. No build, database migration, deployment, PM2 restart, balance mutation, settlement replay, or historical data backfill was run. Channel targeting, channel CPM/payouts, channel statuses, referrals, withdrawals, and historical advertiser charges were not changed.

## Old formula

The former internal publisher calculation used a publisher-share ceiling of 60%, broad country factors (recognized country 0.85; unknown 0.70), fixed engagement, and Telegram-user daily repeat buckets. Repeat pressure was represented in both quality and a repeat multiplier, creating double-penalty behavior. Fixed publisher CPM bypassed quality/repetition protection. External trusted stats used a flat fee split, while provider reconciliation treated provider publisher earnings as the payout. Admin reporting mislabeled internal publisher payout as internal ad revenue and omitted internal retained revenue from platform fee totals.

## New versioned formula

Formula version: `miniapp_publisher_cpm_v2`.

For an impression or aggregate batch:

1. `economic_value` is the authoritative internal advertiser debit or reconciled external provider gross.
2. `reserve = economic_value × reserve_share`.
3. `publisher_envelope = max(0, min(economic_value × max_publisher_share, impression_count × absolute_cpm_cap / 1000, economic_value - reserve - required_platform_margin))`.
4. Live mode starts from the envelope. Fixed mode starts from the lower of requested fixed CPM value and the envelope.
5. Publisher payout multiplies the base by GEO, demand/yield, uniqueness, rolling frequency, measured quality, trust, and fraud factors.
6. Payout is clamped from zero through the envelope. `platform_retained = economic_value - publisher_payout - reserve` and cannot be negative.

Defaults are configurable settings: 50% maximum publisher share, $11 publisher CPM ceiling, 10% reserve, and 10% required retained platform margin. There is no positive publisher CPM floor; zero and very small values remain valid.

## GEO architecture and configuration

GEO is accepted only from edge country headers explicitly listed in `MINIAPP_TRUSTED_EDGE_COUNTRY_HEADERS`. An SDK-provided ISO country is accepted only when `MINIAPP_TRUST_VALIDATED_SDK_COUNTRY=1`. Telegram `language_code` is never treated as country. Missing, invalid, or untrusted data is recorded as `unknown` and receives the configured unknown factor.

Default factor bands are:

- 1.00: US, CA, GB, AU, NZ, DE, FR, NL, CH, NO, SE, DK, FI, IE, AT, BE, LU, SG, JP, KR, AE, IL.
- 0.85: ES, IT, PT, CZ, PL, EE, LT, LV, SI, SK, HR, GR, MT, CY, SA, QA, KW, BH, HK, TW.
- 0.68: IN, BR, MX, AR, CL, UY, CR, PA, MY, TH, TR, ZA, CN, RO, HU, BG, RS, ME, MK, BA.
- 0.52: ID, PH, VN, NG, KE, GH, EG, MA, DZ, TN, CO, PE, EC, DO, GT, SV, JM, JO, IQ, LB, KZ, UZ.
- 0.40: PK, BD, NP, LK, MM, KH, LA, ET, TZ, UG, RW, ZM, ZW, CM, SN, CI, ML, NE, BF, MG, MZ, AO.
- Unknown/unconfigured default: 0.45, bounded by configurable minimum 0.25 and maximum 1.00.

Country overrides are stored as editable JSON in `miniapp_publisher_cpm_v2_geo_multipliers`; all caps, shares, factor bounds, decay, and formula version are also settings rather than code-only controls.

## Frequency, uniqueness, quality, trust, and fraud

Frequency uses privacy-safe HMAC identities for Telegram user, device, session, and optionally network bucket. Matching impressions are measured over rolling 10-minute, 1-hour, 24-hour, and 7-day windows. Pressure decays continuously with an exponential function; the configured default forces publisher payout to zero at 120 matching impressions in seven days. Frequency is a separate factor and is not embedded into quality.

Uniqueness combines distinct user, device, session, and network signals when enough signals exist; sparse data receives a conservative 0.70 factor. No raw device, session, fingerprint, user agent, or IP value is stored by this implementation.

Quality combines completion/watch quality (50%), Mini App traffic-quality score (30%), and interaction timing (20%). Invalid, duplicate, or replayed impressions receive zero quality. There is no positive quality floor.

Publisher trust is mapped continuously to a bounded factor. Publisher/app risk and critical/high traffic risk reduce the fraud factor; confirmed duplicate/replay traffic produces zero publisher payout.

## Internal economics

Internal advertiser charging remains authoritative and unchanged: the existing campaign/user debit is still written for a valid billable impression even if publisher payout becomes zero. New impression rows record economic value, publisher cap, reserve, platform retained amount, formula version, GEO source, each factor, and privacy-safe identity hashes. Existing impressions and historical advertiser charges are not recalculated.

## External economics

External payout is based only on reconciled provider gross economic value. Zero provider gross produces zero publisher payout; low provider yield produces correspondingly low payout. The same envelope and quality/trust/fraud safeguards apply, and the $11 ceiling scales by provider-reported impression count. Daily provider aggregates currently use unknown GEO, neutral frequency, conservative uniqueness, and available app/completion quality because providers do not supply trusted per-impression identity/GEO data.

Migration records a UTC activation boundary. Because provider reports are daily aggregates, the activation day and all earlier dates retain legacy provider-payout semantics; dynamic v2 applies to later report dates. This prevents migration or reconciliation reruns from repricing historical settlement days.

## Fixed mode

Fixed mode is a requested/base publisher CPM, not an exemption. It remains subject to the economic envelope, 50% default share, $11 ceiling, reserve, required platform margin, frequency, quality, trust, and fraud factors. Admin fixed overrides require a reason, can have a validated future expiry, and are captured by existing before/after admin and automation audit records. Expired overrides automatically fall back to live mode.

## Reporting corrections

Admin Mini App reporting now separates:

- Internal advertiser gross, publisher payout, reserve, retained/platform revenue, advertiser CPM, and publisher CPM.
- External provider gross/reconciled revenue, publisher payout, reserve, retained/platform revenue, and effective CPM.
- Combined gross economic value, reserve, retained platform revenue, and margin percent.

The admin Mini App report also exposes compact v2 diagnostics: economic value, publisher cap, average GEO/demand/uniqueness/frequency/quality/trust/fraud factors, zero-payout count, and formula version. Impression, click, completed-view, and CTR sources were preserved.

## Schema and migration

Additive migration: `db/migrations/20260902_0124_miniapp_dynamic_cpm_v2.sql`.

It adds precision economics/factor/hash columns to `miniapp_internal_ad_impressions`, reason/expiry columns to `miniapp_rewarded_campaigns`, supporting indexes, configurable v2 settings, and the one-time activation timestamp. It contains no historical `UPDATE` or backfill. `deploy-vps.sh` includes migration 0124 after 0123, but the script was not executed.

## Files and principal functions changed

- `src/lib/miniappPublisherCpmEngine.ts`: settings loader, GEO, rolling frequency, trust/fraud, dynamic envelope/economics, database-backed signal calculation.
- `src/lib/miniappEconomicTelemetry.ts`: trusted GEO resolution and privacy-safe identity hashing.
- `src/lib/miniappInternalAds.ts`: v2 calculation, fixed-expiry fallback, precise impression telemetry/accounting.
- `src/lib/miniappStats.ts`: provider-backed aggregate economics.
- `src/lib/externalNetworkRevenueReconciliation.ts`: v2 external payout, reserve/retained split, activation boundary, reconciliation metadata.
- `src/lib/miniappRevenueEngine.ts`, `src/lib/miniappReports.ts`: corrected revenue semantics and diagnostics.
- Mini App SDK/request/impression routes: trusted country flow and private device/session identifiers.
- Admin Mini App pages/API: corrected labels/diagnostics and reasoned, optionally expiring fixed overrides.
- `db/migrations/20260902_0124_miniapp_dynamic_cpm_v2.sql`, `deploy-vps.sh`.
- `tests/miniapp-dynamic-cpm-v2.test.mjs`, `tests/miniapp-mediation-source.test.mjs`.

## Verification

- Focused tests: PASS — 28/28 (20 dynamic CPM plus 8 Mini App mediation regressions).
- Focused ESLint: PASS.
- `git diff --check`: PASS for tracked changes; new-file `--no-index --check` produced no whitespace errors.
- Typecheck: NOT RUN because this is the live production host and the instruction permits it only when production load is safe.
- Build: NOT RUN.
- Deployment/restart: NOT RUN.

## Remaining risks

- The code cannot activate until migration 0124, build, and process restart are intentionally performed later.
- Trusted GEO remains unknown until the production edge header allowlist is configured correctly; SDK country should be enabled only if the integration validates it upstream.
- Network bucketing remains disabled unless trusted proxy IP headers are explicitly enabled.
- Provider daily aggregates lack per-impression identity/GEO detail, so they necessarily use conservative aggregate safeguards.
- New telemetry should be monitored after activation to tune configurable factors without changing historical rows.

## Exact future deployment steps

1. Take the normal production database and source/build rollback backup.
2. Review `.env`: set `MINIAPP_TRUSTED_EDGE_COUNTRY_HEADERS` to headers actually overwritten by the trusted edge; set `MINIAPP_TRUST_VALIDATED_SDK_COUNTRY=1` only when SDK country is independently validated; set `MINIAPP_TRUST_PROXY_IP_HEADERS=1` only behind a trusted proxy; ensure a stable telemetry hashing secret is available.
3. From `/www/wwwroot/bots/AdsFusion`, run `bash deploy-vps.sh`. The existing script applies migration 0124 after 0123, builds in its isolated build directory, promotes the complete build, and restarts `AdsFusionApp` and `AdsFusionCron`.
4. Verify migration 0124 settings/columns and that `miniapp_publisher_cpm_v2_activated_at` was written once.
5. Smoke-test one internal request/impression and one external zero-yield case; verify advertiser debit, publisher payout, reserve, retained revenue, and formula diagnostics.
6. Verify the admin report labels/totals and PM2 health/logs, then monitor zero-payout, margin, GEO-source, and factor distributions.
