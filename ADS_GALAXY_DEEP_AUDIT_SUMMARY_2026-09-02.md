# Ads Galaxy deep audit summary — 2026-09-02

## Silver

- Exact cause: seven auto-bans by `publisher_trust_score <= 20 AND balance_available >= 9.80` in `enforcePublisherTrust()`.
- The comparisons were correct, but there is no test-account exemption. Ordinary unban leaves low user trust unchanged, causing deterministic re-ban on a later 15-minute enforcement run.
- Recommended: add an audited, scoped/expiring user enforcement exemption and require an unban disposition (exempt, remediate/reset+freeze, or accept re-ban). Do not use inventory whitelist.

## Cade

- Withdrawal #18: **HOLD** 19.15 USDT pending referral/channel fraud review.
- Maximum defensible now: 14.60562268 USDT (13.97062268 cleared advertising + 0.50000000 join + 0.13500000 clearly legitimate referral).
- Questionable/unresolved within request: 4.54437732 USDT; no currently included amount is conclusively invalid, while 0.265 historical fraud/reversed referral rewards are excluded from current balance.
- Why not banned: trust 60, available below 9.80 after request, referral flags/locked withdrawal are not enforcement inputs.
- Coverage bug: fraud job repeatedly scans oldest 200 channels with no cursor. 696 eligible; 210 ever evaluated; 486 never. Channels 1078–1080 were never evaluated.

## Mini App CPM

- Current live formula: `advertiser CPM × 60% × quality factor × repeat factor`; repeat also participates inside quality, so it is applied twice. Fixed mode bypasses quality/repeat.
- GEO: SDK option or Telegram `language_code`; any non-empty string receives 0.85. No country tiers.
- Repeat identity: Telegram user ID per campaign/app/day; repeat buckets 1.00, 0.85, 0.65, 0.40, 0.20. No IP/device/fingerprint dimension.
- Internal economics currently retain margin. The zero-fee screenshot is a reporting semantic bug: internal publisher revenue is labeled internal ad revenue and internal platform fee is omitted from that global card.
- Advertiser CPM min/max: 2.50/32.00. Publisher cap: 60% (19.20 absolute fixed ceiling; 17.28 live ceiling). Live practical minimum is ~0.129 CPM; fixed/external reconciled impressions can pay zero.
- Biggest issues: fake GEO, fixed-mode bypass, Telegram-only daily repeat identity, constant engagement/no trust or fraud input, misleading margin reporting.
- Future: payout from verified economic value × GEO × yield × uniqueness × frequency decay × traffic quality × trust × fraud, bounded by configurable share of actual value and optional absolute CPM cap, with guaranteed retained margin and zero allowed.

## Mutations

None, except creation of the two requested Markdown reports.
