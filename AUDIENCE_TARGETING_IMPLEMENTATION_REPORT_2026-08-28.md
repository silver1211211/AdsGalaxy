# AdsGalaxy Audience Targeting Audit Report — 2026-08-28

## AUDIT FINDINGS

Implementation was intentionally stopped before application changes because the production code has an explicit Global-as-wildcard semantic that conflicts with the requested Global-only classification. The task brief says to stop and document this conflict rather than silently change existing product semantics.

The repository was inspected on the live server after `git status --short` and `git diff --check`. Pre-existing unrelated modifications were present in:

- `src/app/api/advertiser/stats/route.ts`
- `src/app/api/me/status/route.ts`
- `src/lib/auth.ts`
- `src/lib/dbResilience.ts`
- `tests/database-transaction-resilience-source.test.mjs`
- `tests/referral-bot-start-source.test.mjs`

Those files were not changed by this task. `git diff --check` passed before the audit.

Next.js is 16.2.4. The installed Route Handler and caching documentation in `node_modules/next/dist/docs/01-app/` was read before considering code changes. Route Handlers are uncached by default, and the installed documentation marks `unstable_cache` as replaced by Cache Components / `use cache` in Next.js 16.

## EXISTING DATA MODEL

- Campaign region targeting: `campaigns.continents` (`MEDIUMTEXT`, nullable), containing JSON arrays of machine-safe lowercase values.
- Channel audience targeting: `channels.audience_continents` (`MEDIUMTEXT`, nullable), containing JSON arrays of display labels.
- Channel country: `channels.marketplace_country` (`VARCHAR(2)`, nullable). All 465 active, non-deleted channels currently have this field unassigned.
- Campaign category: `campaigns.category` (`VARCHAR(32)`).
- Channel categories: `channels.categories` (`LONGTEXT` JSON array).
- Channel subscribers: `channels.subscriber_count`.
- Authoritative bounded channel analytics: `channel_daily_stats` and `channel_post_daily_stats`.
- Raw click source: `campaign_clicks`; post/view source: `campaign_posts`.

Production table estimates observed during the read-only audit: 1,252 channels, 37 campaigns, 37,317 campaign posts, 19,707 campaign clicks, 54,965 channel daily-stat rows, and 645,575 channel post daily-stat rows.

## NEW TARGET AUDIENCE MODEL

Not implemented because of the Global semantic conflict. No parallel audience field is needed in principle: the existing campaign and channel audience fields can be normalized and reused. However, the current channel field is multi-value while the requested model requires one normalized classification per channel; that product/data-model change requires confirmation before implementation.

## REGION DEFINITIONS

Requested normalized keys:

- `global`
- `africa`
- `asia`
- `europe`
- `north_america`
- `south_america`
- `oceania`

The advertiser UI already uses exactly these seven machine-safe keys. Publisher storage currently uses title-case labels and permits multiple values.

## COUNTRY MAPPING

The requested mapping was not added. Existing UI descriptions substantially overlap it but are inconsistent: the publisher UI additionally lists Indonesia under Asia, while the advertiser UI uses examples including Vietnam and Fiji. Production `marketplace_country` cannot currently backfill active channels because all active values are unassigned.

## CHANNEL ASSIGNMENT LOGIC

Publisher add/edit UI already requires at least one audience selection, but its Global control selects all seven values. Server routes serialize `audience_continents` without an allow-list, normalization, or single-classification constraint, so unsupported strings can currently be stored. No channel data was changed or backfilled.

## CAMPAIGN TARGETING LOGIC

The advertiser channel/bot wizard already supports multiple regions. Its default and Global selection are all seven region keys. Campaign creation writes that JSON to `campaigns.continents`; campaign editing preserves or replaces the JSON string without audience-specific server validation. Existing campaigns generally store all seven keys for global reach.

## DELIVERY ELIGIBILITY LOGIC

Normal channel delivery in `src/app/api/cron/process-ads/route.ts` first requires category matching, then currently returns a region match when:

1. the campaign contains `global`, or
2. the channel contains `global`, or
3. any normalized campaign and channel region overlaps.

That is an explicit wildcard semantic and conflicts with the requested rule that Global campaigns match Global channels only.

The admin emergency-push channel path selects active channels without applying campaign category or audience matching. An existing test intentionally asserts that `campaignMatchesChannel` is not used by emergency push. This is a second product-policy decision: the new audience condition cannot be made universally required without changing the current emergency override contract.

Retries operate on already-created delivery records/posts; the normal new-allocation path is `process-ads`. The developer `/api/v1/channel/campaigns` endpoint is sandbox/event plumbing rather than the production allocator.

## LEGACY CAMPAIGN BEHAVIOR

Unchanged. No compatibility behavior was implemented. Existing campaigns continue to use current wildcard semantics. A later implementation must explicitly decide whether null/empty legacy campaign targeting remains unrestricted and how existing all-seven Global campaigns are interpreted.

## ADMIN AUDIENCE ANALYTICS

Not implemented because the stop condition was triggered. The appropriate data source is `channel_daily_stats`, whose aggregation already derives daily views/clicks from channel-post statistics and uses settlement-aware, fraud-adjusted view earnings where applicable. CTR is already computed as `IF(SUM(views) > 0, SUM(clicks) / SUM(views) * 100, 0)`.

The daily table covers 2026-07-03 through 2026-08-28. A proposed analytics query should use `stat_date >= CURDATE() - INTERVAL 29 DAY`, aggregate once by channel, join to the normalized channel classification, and return all seven zero-filled groups. Weekly/monthly averages should divide bounded totals by 7 and 30 business days respectively, with CTR calculated from aggregate clicks/views rather than averaging per-row CTR values.

## ADMIN MENU CHANGE

Not implemented. The current Growth entry maps `/admin/promote-ads-galaxy` to “Promote AdsGalaxy”. The feature remains intact through its admin page/API and publisher page/API. A later change must define a new reachable admin location for the existing admin controls before replacing the Growth entry with Audience Analytics.

## DASHBOARD UNASSIGNED REMOVAL

Not implemented. The obsolete UI is the “Audience by country” section in `src/app/admin/page.tsx`, backed by the `audienceByCountry` query in `src/app/api/admin/dashboard/route.ts`. No underlying data was mutated.

## PERFORMANCE DESIGN

Use one bounded aggregation over `channel_daily_stats`, not raw full-history event joins or N+1 queries. A 15–30 second server-side cache is appropriate after choosing a Next.js 16-compatible cache approach. Route Handlers are uncached by default in the installed Next.js documentation.

The tested 30-day grouped query examined approximately 54,965 daily rows and `EXPLAIN` reported `type=ALL`, `Using where; Using temporary; Using filesort`. The current primary key is `(stat_date, channel_id)` and secondary index is `(channel_id, stat_date)`. Because the table is presently small and the 30-day window covers a large fraction of it, no index was blindly proposed. The final query shape should be re-EXPLAINed after the audience model is settled.

## DATABASE QUERIES

Read-only queries used `INFORMATION_SCHEMA.COLUMNS`, `INFORMATION_SCHEMA.TABLES`, `INFORMATION_SCHEMA.STATISTICS`, grouped channel/campaign distributions, bounded analytics date inspection, and `EXPLAIN`. No credentials or row-level private data were printed.

Capacity scope/query basis: active, non-deleted channels. Classification treats an all-seven array or Global-only array as current Global; exactly one supported non-Global regional value maps to that region; missing or other multi-region arrays are unclassified.

## INDEXES

Existing relevant indexes include:

- channels: `(status, is_deleted)` and `(status, is_deleted, scheduler_slot)`
- campaigns: `(status, budget)` and `(status, start_at, end_at)`
- channel daily stats: primary `(stat_date, channel_id)`, secondary `(channel_id, stat_date)`
- campaign clicks: `(post_id, created_at)` and `(campaign_id, created_at)`
- campaign posts: `(channel_id, created_at)` and `(campaign_id, channel_id, created_at)`

No index was created.

## MIGRATIONS CREATED BUT NOT APPLIED

None. No migration was created or applied.

## EXISTING CHANNEL CAPACITY

Scope: 465 active, non-deleted channels; 2,426,530 total subscribers.

| Audience | Channels | Subscribers |
|---|---:|---:|
| Global | 297 | 1,405,017 |
| Africa | 12 | 425,128 |
| Asia | 9 | 4,839 |
| Europe | 0 | 0 |
| North America | 1 | 3,427 |
| South America | 4 | 8,310 |
| Oceania | 0 | 0 |
| Unclassified | 142 | 579,809 |

These figures are a read-only classification report, not a backfill. Of the unclassified channels, 129 have no audience array and 13 have ambiguous multi-region arrays under a one-classification model.

## UNCLASSIFIED CHANNEL COUNT

142 active, non-deleted channels with 579,809 subscribers under the conservative classification above.

## FILES MODIFIED

Application/source files modified: 0.

Report files created: 1 (`AUDIENCE_TARGETING_IMPLEMENTATION_REPORT_2026-08-28.md`).

## TEST RESULTS

No tests were run because implementation stopped at the explicitly mandated semantic-conflict gate. No Next.js build was run. Pre-change `git diff --check` passed.

## KNOWN RISKS

- Changing Global from wildcard to its own class will materially narrow live campaign delivery.
- Existing all-seven campaign/channel arrays encode the current Global meaning and need an explicit conversion/compatibility rule.
- 142 active channels cannot be assigned one region without a decision or manual review.
- Server routes currently accept unsupported audience strings.
- Emergency push currently bypasses category and audience matching by design/test.
- `marketplace_country` cannot currently support active-channel backfill.
- Replacing the only admin sidebar link to Promote AdsGalaxy without a new location would reduce discoverability of its admin controls.

## REQUIRES BUILD

This audit/report does not require a build. A future application implementation will require a controlled build/deployment in a separate authorized production step.

## REQUIRES MIGRATION

Undetermined until the single-classification storage decision is made. Existing fields can be reused, but enforcing/indexing normalized channel classification may justify a migration. No migration was created or applied.

## REQUIRES BACKFILL

Yes, if the product adopts one audience classification per channel. A proposal must handle current all-seven Global values, 13 ambiguous multi-region values, and 129 missing values. No backfill was performed.

## NEXT PRODUCTION STEPS

1. Obtain an explicit product decision authorizing either the requested Global-only semantics or preservation of the current wildcard semantics.
2. Decide whether emergency push must obey category and audience targeting or remains an explicit override.
3. Define conversion rules for all-seven, multi-region, and null channel arrays, including whether manual publisher/admin selection is required.
4. Define where the existing Promote AdsGalaxy admin controls remain reachable after the Growth menu replacement.
5. After those decisions, implement normalization, legacy behavior, delivery enforcement, analytics, UI changes, migration files if proven necessary, and targeted tests in a new authorized task.

No build, deployment, migration, restart, or data backfill was performed.

---

# Implementation Continuation — Product Decisions Applied

This continuation supersedes the audit-only “not implemented” statements above. The product owner explicitly resolved the Global and Emergency Push policy blockers, and the source implementation was completed without building, deploying, restarting, applying migrations, or backfilling production data.

## PRODUCT DECISIONS

- Global is exclusive as an advertiser selection and is a wildcard across all classified geographic audiences during delivery.
- New and edited channel campaigns must explicitly select one or more audiences.
- Global is exclusive; specific regions may be combined.
- Existing channel campaigns stored in the legacy array format remain geographically unrestricted.
- Explicitly targeted campaigns exclude unclassified channels.
- Legacy unrestricted campaigns remain compatible with unclassified channels.
- Emergency Push may bypass timing/pacing but may not bypass category or audience targeting.
- Channel publishers assign exactly one normalized audience classification on new submissions and general edits.

## GLOBAL WILDCARD DELIVERY SEMANTICS

The shared matcher now separates selection rules from delivery rules. Global remains mutually exclusive in campaign input, while an explicit Global campaign is eligible for every classified geographic audience. Specific-region campaigns continue to use exact matching:

- Global campaign + Global channel: match.
- Global campaign + Africa, Asia, Europe, North America, South America, or Oceania channel: match.
- Asia campaign + Asia channel: match.
- Asia campaign + Global channel: no match.
- Asia campaign + Africa channel: no match.
- Europe + Asia campaign + either Europe or Asia channel: match.
- Europe + Asia campaign + Africa, Global, or unclassified channel: no match.

Unclassified channels remain excluded from every explicit campaign, including an explicit Global campaign. Legacy unrestricted campaigns remain eligible for classified and unclassified inventory because that compatibility mode intentionally has no geographic restriction.

## LEGACY CAMPAIGN COMPATIBILITY

The existing `campaigns.continents` column is reused with two unambiguous shapes:

- `LEGACY_UNRESTRICTED`: any existing JSON array (or absent/unrecognized legacy value). Existing production campaigns remain unchanged and unrestricted geographically.
- `EXPLICIT_TARGETING`: `{ "version": 1, "mode": "explicit", "audiences": [...] }`. New or edited non-broadcast/channel campaigns use Global-wildcard or specific-region exact matching.

The string `global` is never used as the legacy marker. Invalid structured explicit configuration fails closed with no eligible audience.

## GLOBAL EXCLUSIVITY

The channel-campaign UI selects Global by itself. Selecting Global clears specific regions; selecting a specific region removes Global. Client and server validation both reject Global combined with any other audience. New and edited explicit channel campaigns require at least one supported audience.

## UNCLASSIFIED BEHAVIOR

Channel classification is derived from the existing `channels.audience_continents` JSON field:

- exactly one supported value: that normalized region;
- the historical all-seven representation: Global;
- missing, unsupported, or ambiguous multi-region values: Unclassified.

Explicit campaigns exclude Unclassified. Legacy unrestricted campaigns remain eligible subject to all existing non-geographic checks and category matching. No channel was automatically changed or backfilled.

## EMERGENCY PUSH TARGETING

Emergency Push now invokes the same shared category-and-audience eligibility helper as normal `process-ads` delivery. The check is applied even when ordinary timing rules are intentionally bypassed. Existing active-status, channel-status, exclusion, duplicate-delivery, settlement, safety, and budget protections remain in place.

## SHARED ELIGIBILITY LOGIC

`src/lib/channelAudience.ts` is authoritative for:

- supported audience keys and labels;
- ISO country-code mapping for the approved country list;
- explicit campaign serialization and validation;
- legacy versus explicit mode parsing;
- channel classification;
- Global-wildcard and specific-region exact audience matching;
- the combined category + audience inventory predicate.

Normal channel allocation, Emergency Push, and the admin availability estimator use this shared predicate so their targeting semantics cannot drift independently.

## IMPLEMENTATION CHANGES

- Added centralized audience constants, normalization, country mapping, storage-mode parsing, and eligibility logic.
- Reused `campaigns.continents`; no campaign schema migration was necessary.
- Normalized new/edited publisher channel audience values to a one-element canonical JSON array.
- Added server rejection for empty, multi-value channel classifications and unsupported values.
- Added structured explicit audience storage for new/edited channel campaigns.
- Preserved legacy campaign array behavior.
- Updated advertiser campaign details and both admin campaign views to render structured explicit targeting.
- Applied centralized Global-wildcard and specific-region exact matching in normal channel delivery.
- Enforced shared targeting in Emergency Push and admin capacity prediction.
- Replaced the Growth menu link with Audience Analytics.
- Kept Promote AdsGalaxy source routes intact and linked its admin controls from Audience Analytics.
- Removed the obsolete main-dashboard Audience-by-country query and UI block.

## ADMIN ANALYTICS

The new `/admin/audience-analytics` page and `/api/admin/audience-analytics` API return Global, Africa, Asia, Europe, North America, South America, Oceania, and Unclassified.

Each group includes channel/subscriber capacity plus today, 7-day, and 30-day view/click/CTR metrics. Seven- and 30-day view/click values are daily averages. CTR uses aggregate `clicks / views * 100` and returns zero when views are zero.

The API uses:

- one active-channel capacity query;
- one bounded 30-day grouped query against authoritative `channel_daily_stats`;
- no N+1 or raw full-history event joins;
- a 20-second in-process server cache;
- a partial-error response that preserves capacity totals if recent metrics fail.

The page uses stacked, min-width-safe cards on mobile and a compact two-column grid on wide screens. It does not use a horizontally scrolling table.

`EXPLAIN` results at implementation time:

- active channels: approximately 1,297 examined rows, `Using where`;
- 30-day daily stats: approximately 54,965 examined rows, bounded by date, `Using where; Using temporary; Using filesort`.

The current daily summary table is small, the date window covers a large fraction of it, and existing keys are `(stat_date, channel_id)` and `(channel_id, stat_date)`. No speculative index migration was created.

## FINAL PRODUCT-RULE VERIFICATION

- Global wildcard delivery: verified. An explicit Global campaign matches every classified audience from Global through Oceania.
- Regional exact-match delivery: verified. Specific-region campaigns match only their selected regions and do not match Global.
- Global selector exclusivity: verified in campaign input and server validation.
- Normal delivery: verified through the shared eligibility helper.
- Emergency Push: verified through the same shared eligibility helper.
- Category targeting: remains mandatory in the combined eligibility predicate.
- Capacity totals: queried dynamically; no delivery rule depends on a fixed active or Unclassified channel count.

## CAPACITY REPORT

Confirmed implementation baseline supplied and audited earlier: **465 active, non-deleted channels**.

| Audience | Baseline Channels | Baseline Subscribers |
|---|---:|---:|
| Global | 297 | 1,405,017 |
| Africa | 12 | 425,128 |
| Asia | 9 | 4,839 |
| Europe | 0 | 0 |
| North America | 1 | 3,427 |
| South America | 4 | 8,310 |
| Oceania | 0 | 0 |
| Unclassified | 142 | 579,809 |
| **Total** | **465** | **2,426,530** |

Because this is a live platform, the final read-only snapshot later in the same implementation window returned 464 active channels: one 23,491-subscriber channel moved from `active` to `paused` through external production activity. No task action changed channel state.

Final live snapshot:

| Audience | Channels | Subscribers |
|---|---:|---:|
| Global | 297 | 1,405,017 |
| Africa | 12 | 425,128 |
| Asia | 9 | 4,839 |
| Europe | 0 | 0 |
| North America | 1 | 3,427 |
| South America | 4 | 8,310 |
| Oceania | 0 | 0 |
| Unclassified | 141 | 556,318 |
| **Total** | **464** | **2,403,039** |

Both the explicitly confirmed 465-channel baseline and the timestamp-sensitive final snapshot are retained so the report does not hide live-state drift.

## MIGRATIONS CREATED

None. Existing JSON-capable text fields and existing analytics summaries were sufficient. No migration was applied.

## FILES CHANGED

20 application/source files, 3 test files, and this report were changed or created for this implementation. The six unrelated tracked modifications identified in the initial audit were preserved without edits. A transient `tsconfig.tsbuildinfo` change created by type checking was restored because it was generated solely by this task.

## TEST RESULTS

- Audience and relevant delivery regression suite: 23 passed, 0 failed.
- Final focused audience suite after the Global wildcard correction: 9 passed, 0 failed.
- TypeScript: `npx tsc --noEmit --incremental false --pretty false` passed.
- New audience analytics/helper files: targeted ESLint passed.
- `git diff --check`: passed.
- No Next.js build was run.

## REQUIRES BUILD

Yes. Source is implemented but intentionally not built or deployed in this task. A separately authorized production build/deployment is required before the UI/API/runtime changes become active.

## REQUIRES MIGRATION

No.

## REQUIRES BACKFILL

Not for compatibility or launch. Explicit campaigns already fail closed against unclassified channels, while legacy campaigns remain compatible. A future manually reviewed cleanup/backfill is recommended for the confirmed 142-channel baseline Unclassified inventory (141 in the final live snapshot), but none was performed.

---

## CHANNEL NICHE AND AUDIENCE VERIFICATION

Evidence snapshot: 2026-08-29T09:00:06.362Z. This was a read-only verification against the live production database and public channel/catalog pages. The active inventory and review set were queried dynamically; no previous Unclassified count was used as an input.

### Scope and methodology

- Live active channels: **474**.
- Channels reviewed: **474** (all active rows, because every active row currently lacks AdsGalaxy marketplace country and language metadata; this avoids trusting the existing region value alone).
- Already confidently classified: **4** existing normalized classifications independently corroborated at high or medium confidence.
- Classification method: AdsGalaxy username/title/current audience/category plus public Telegram title/about/recent-post text, TGStat public catalog metadata, Telemetr.me public catalog presence/title, and Telemetr.com public channel pages. Explicit country/flag/currency/city and region-specific language/script signals were required to agree across multiple available surfaces. One weak keyword was insufficient.
- Global was proposed only where there was positive international-scope language plus evidence spanning multiple regions. Unknown was never converted to Global.
- Low-confidence Unclassified rows remain Unclassified. Existing classified rows without independent corroboration are retained as proposals with low confidence; lack of evidence alone was not treated as a correction conflict.
- No login wall, CAPTCHA, rate limit, or private account was bypassed. No automated retries were made against blocked results.

### Public-source coverage

- TGStat: 452 unique usernames attempted; 26 matched public channel pages; 1 explicitly unavailable/blocked responses. Other misses were public “channel not found” or login-required pages.
- Telemetr.me: 452 attempted; 212 public catalog-title matches. Detailed analytics were login-gated on the responses observed, so no login was attempted.
- Telemetr.com: 452 attempted; 61 matched public channel pages. Other responses were public “channel not found” pages.
- Telegram public pages: 452 attempted; 446 usable; 6 unavailable/blocked.
- Existing Telegram bot metadata: 471 unique chats attempted; 409 usable; 62 rate-limited/unavailable. No retry was used.

### Region counts before review

| Region | Active channels |
|---|---:|
| Global | 306 |
| Africa | 12 |
| Asia | 11 |
| Europe | 0 |
| North America | 1 |
| South America | 4 |
| Oceania | 0 |
| Unclassified | 140 |

### Proposed region counts after review

| Region | Proposed channels |
|---|---:|
| Global | 251 |
| Africa | 64 |
| Asia | 55 |
| Europe | 3 |
| North America | 1 |
| South America | 4 |
| Oceania | 0 |
| Unclassified | 96 |

### Confidence distribution

| Confidence | Channels |
|---|---:|
| High | 33 |
| Medium | 70 |
| Low | 371 |

Channels still Unclassified: **96**.

### Classification conflicts

Rows below are flagged only when high/medium external evidence indicates a concrete region different from the current normalized AdsGalaxy value. Nothing was overwritten.

| Channel ID | Username / title | Current | Proposed correction | Confidence | External evidence |
|---:|---|---|---|---|---|
| 160 | @relax_incomesite / RELAX INCOME SITE | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 200 | @httpinjectordns / Http injector DNSTT | Global | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 209 | @geramedia24 / ጌራ ሚዲያ-Gera Media | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) |
| 239 | @aviatorpredictorethio1 / ህጋዊ ነን | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) |
| 283 | @antibirehanu / Anti ብሬ | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram) |
| 294 | @lifebigo / Ethio light | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 307 | @nature_capture_bd / প্রকৃতি | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 314 | @shuktus_books / ሹክቱስ pdf መፅሐፍት | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) |
| 322 | @DealspotGlobal / Amazon Deals | Global | Asia | medium | India (Telegram); India (TGStat); India (Recent public posts) |
| 524 | @freeinternet2018 / Max Tech | Global | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 874 | @freeincomesied1 / ফ্রি টাকা ইনকাম | Global | Asia | high | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.com); UAE (Telemetr.com) |
| 931 | @emoneydenu / E MONEY DENUWA🎉️🇱🇰 | Global | Asia | medium | Sri Lanka (AdsGalaxy); Sri Lanka (Telegram); Sri Lanka (Recent public posts) |
| 935 | @WalakathalanthayaNew / Wal katha Lanthaya New💋📝🥇 | Global | Asia | medium | Sri Lanka (Telegram); Sri Lanka (Recent public posts) |
| 939 | @rafi_Free_income / RAFI FREE INCOME | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 948 | @OnlineIncomeGansta / ONLINE INCOME TEAM BD | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 969 | @ethiofreeinternetfiles_b / FREE INTERNET FILES | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) |
| 974 | @NeronLab_bd / Neerob Earning Lab | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 980 | @allincametex / EASY CRYPTO HOUSE BD 🇧🇩!!️ | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 987 | @Sakib_2400 / ফ্রি ইনকাম সাইড বাংলাদেশ 💸💸 | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 992 | @FreeIncomeHub31626464 / 💰Free Income Hub💰 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1022 | @jsojsk6s / TR-X ܔ HGZY BIG COMMUNITY ➪ 💙࿐ | Global | Asia | high | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.com); UAE (Telemetr.com); Bangladesh/Bengali (Recent public posts) |
| 1048 | @videolinksove / সব ধরনের ভাইরাল ভিডিও 😘 | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1066 | @ethio_fiction / ልብወለድ Ethio_Fiction | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Telemetr.com) |
| 1073 | @movie_night_9 / Movie Night 9 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1083 | @X_X_X3x2 / X_X_Xray | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1084 | @MoviePlanetbest / Movie Planet | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1108 | @TR_Coins / 🇹🇷TR🇹🇷 Kripto🧧 | Global | Asia | high | Turkey (AdsGalaxy); Turkey (Telegram); Turkey (Telemetr.me); Turkey (Recent public posts) |
| 1115 | @Anadolu_m / 🇹🇷Anatolian Boxes | Global | Asia | medium | Turkey (AdsGalaxy); Turkey (Telegram); Turkey (Recent public posts) |
| 1148 | @amirthelverpoolfun / Etho Liverpool family 🇪🇹 | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 1171 | @Mamun47YT / Mamun 47 YT | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1264 | @ / UGANDAN LINKS🇺🇬 | Global | Africa | medium | Uganda (AdsGalaxy); Uganda (Telegram) |
| 1265 | @SengaUganda / UGANDA❤️SSENGA🇧🇪⚡️ | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) |
| 1266 | @UGANDANLINKS / UGANDAN LINKS 2🇺🇬 | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) |
| 1269 | @UgandaNewsFeeds247 / UGANDA NEWS FEEDS | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) |
| 1270 | @UgandanVibez / UGANDAN🇧🇪MUSIC🎵 | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) |
| 1275 | @Anime_world_en_VF / Anime World VF🇫🇷 | Global | Europe | high | France (AdsGalaxy); France (Telegram); France (Telemetr.me); France (Recent public posts) |
| 1276 | @Film_serie_en_vf / Film et Séries vf🇫🇷 | Global | Europe | high | France (AdsGalaxy); France (Telegram); France (Telemetr.me); France (Recent public posts) |
| 1287 | @adimasmedia / አድማስ ሚዲያ | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 1390 | @YeRasBirr / የራስ ብር \|\| YeRas Birr 💰 | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 1462 | @RealPaymentbd / Help To Income💸 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1496 | @abfreenet / ABBIYO FREE INTERNET | Global | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 1497 | @sinhala_wal_lk / වැල් ලන්තය | Global | Asia | high | Sri Lanka (AdsGalaxy); Sri Lanka (Telegram); Sri Lanka (Telemetr.me); Sri Lanka (Recent public posts) |
| 1506 | @bd_wh_eran1 / ◥👑◤ Bd_Wh_ERAN | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1508 | @allinbd / ALLINBD 🇧🇩 | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1512 | @gmailbuyer2938 / Gmail buy & sell & premium vpn seller | Global | Asia | high | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.com); UAE (Telemetr.com); Bangladesh/Bengali (Recent public posts) |
| 1527 | @islamicpediia1 / ইখওয়ানুল মুসলিমিন(الإخوان المسلمون) | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1552 | @V2Ray_Files / ETHIO FREE SERVER | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) |
| 1555 | @EthioFreeBingo / ABISINIYA FREE BONUS'S | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) |
| 1565 | @airdropearningzone20 / Airdrop Earning Zone ▶️ | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1566 | @Bangladesh_Big_Communite_26 / Bangladesh Big Communite 👑 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) |
| 1571 | @JK_FREENET / JK ነፃ | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) |
| 1574 | @Apostolic_Fellowship / Aᴘᴏsᴛᴏʟɪᴄ FᴇʟʟᴏᴡSʜɪᴘ \| ሐዋርያት ኅብሬት (ACE) | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) |
| 1580 | @CameroonEarningHub / Cameroon 🇨🇲 Earning hub | Global | Africa | medium | Cameroon (AdsGalaxy); Cameroon (Telegram); Cameroon (Recent public posts) |
| 1587 | @ / The Nairobi Lowdown | Global | Africa | medium | Kenya (AdsGalaxy); Kenya (Telegram) |
| 1595 | @sonicupdate02 / VY NGN TASK 🟢 | Global | Africa | medium | Nigeria (AdsGalaxy); Nigeria (Telegram); Nigeria (Recent public posts) |

### Niche/category observations

Stored channel categories were treated only as supporting metadata. Public descriptions and recent-post text frequently indicated more specific combinations such as Crypto + Finance/Trading, Technology, Gaming, Entertainment, Education/Books, News, Religion, Sports, Jobs, Food, or Health. The detailed table records a conservative niche only where matching public text was available; otherwise it preserves the stored category or marks Unknown.

### Per-channel classification proposal

| Channel ID | Username / title | Current region | Proposed region | Confidence | Evidence | TGStat result | Telemetr result | Language | Niche/category |
|---:|---|---|---|---|---|---|---|---|---|
| 3 | @allgoodforu5 / An Earning 2.0 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 35 | @topearningsitefk1 / Top Earning Site FK | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Cyrillic-language / English | Crypto + Finance/Trading |
| 36 | @r064d / ONLINE EARN | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Cyrillic-language / English | Finance/Trading + Technology |
| 40 | @HappProxyT / HAPP PROXY | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / Spanish / French | Crypto + Finance/Trading |
| 45 | @patroleium / Patroleium Movie | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Entertainment |
| 57 | @riug5ryhgt / ONLINE MARKET | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 71 | @Hardness430 / Hard Ness 💧💠📲💤💻 | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Gaming |
| 82 | @bansbn / بوت افلام بوت فديوهات بوت دردشة سكس قصص امهات جنسية مطلقات ارامل تعارف فديو مقاطع محارم ميغا نيك اخوة تعارف كروبات كروب صداقة | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Crypto + Finance/Trading |
| 90 | @cyberprotips / @cyber tip's official channel | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 95 | @cryptoRootsPay / Crypto Roots Payment | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 98 | @Daandii_Tech / DAANDII TECH & Internet 🛜 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 108 | @blordhudmaker / 🅱️_Lord HUB | Global | Global | low | United Kingdom (TGStat); existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 111 | @advancedgamers01 / ADVANCED GAMERSTM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | French / English | Finance/Trading + Technology |
| 124 | @DropsPayout / Airdrop | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 125 | @cashdropsfree / Free Crypto bots | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 126 | @Soltips_gemini / Sol tips | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 137 | @modvectorofficial / MOD VECTOR | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 142 | @SilverUsdtChannel / SILVER USDT CHANNEL️ ️️ ️ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 146 | @my_faucet_hub / My faucet hub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 154 | @Moon_Cryptoz / ɱσσɳ ƈɾყρƚσ 🌼 | Unclassified | Unclassified | low | no reliable geographic signal | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 157 | @GhostDataHub / GHOST DATA | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Finance/Trading |
| 159 | @primegig / PRIMEGIG 💼💰 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 160 | @relax_incomesite / RELAX INCOME SITE | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Crypto + Finance/Trading |
| 163 | @AbdiiNagahoo / Godaannisa Kulkule | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Entertainment,Other |
| 170 | @ALCaesar24 / قناة بوت تمويل القيصر | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / English | Crypto + Finance/Trading |
| 171 | @raft_24 / قناة كنز الارباح | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / English | Crypto + Finance/Trading |
| 179 | @earnwithchi / Money Making Opportunities | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 182 | @sjdbskdb / اخبار العملات الرقمية يومياً | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / English | Crypto |
| 187 | @candyvi53 / Earn money online with Candyvi | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 200 | @httpinjectordns / Http injector DNSTT | Global | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 207 | @dwtec / MAKE MONEY 💰💰💰 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 209 | @geramedia24 / ጌራ ሚዲያ-Gera Media | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Amharic | Other |
| 213 | @VF_films_thiller4 / WINNERS PRONO | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Finance/Trading + Technology |
| 216 | @UnpredictableEarning / Unpredictable Earning | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 222 | @moviebox0o / MOVIE BOX (أفلام) | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Arabic/Persian / English | Entertainment |
| 223 | @mensurcryptoANDairdrop / Robit airdrop alert & crypto info | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 233 | @SmartAirdropHub / Smart Airdrops Hub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance,Crypto,Entertainment |
| 234 | @CryptoFarmKe / Crypto farm | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 236 | @Tskkk_sinhala_wala / Sinhala Wala Rasa katha | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 237 | @damsdeslivres / Dams Des Livres | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | French | Finance,Tech,Education |
| 238 | @damsnumerique / Dams Numérique | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French | Technology + Education/Books |
| 239 | @aviatorpredictorethio1 / ህጋዊ ነን | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading |
| 245 | @hexashield / HEXA SHIELD UPDATES 3️⃣ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 265 | @cryptosignalsdaily4 / CRYPTO SIGNALS | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 277 | @movie_100k / Spider-noir~Kattalan~Glory | Global | Global | low | UAE (Telemetr.com); India (Recent public posts); existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Finance/Trading + Entertainment |
| 278 | @movie_98k / Movie 2k | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Entertainment |
| 283 | @antibirehanu / Anti ብሬ | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic | Crypto,Entertainment,NSFW +18 |
| 285 | @Viralvideobd013 / Viral Video BD 모 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | NSFW +18 |
| 294 | @lifebigo / Ethio light | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 295 | @cryptowithred / CRYPTO WITH REDSCOR | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / Chinese / Spanish | Crypto + Finance/Trading |
| 297 | @Adreswww / فرص لربح من تلكرام | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / English | Finance/Trading + Technology |
| 298 | @happynessandfun / FUNLAND😁 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 305 | @kdrama_time_movies / #Faq [ Kdrama Backup ] | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 307 | @nature_capture_bd / প্রকৃতি | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Finance/Trading + Technology |
| 308 | @Tranding_capcut_tamplate / Tranding capcut tamplate | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | French / English | Technology |
| 309 | @EarnTheLoots / 𓆩Ahmed By TaskTM𓆪 ✨ 👑 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 314 | @shuktus_books / ሹክቱስ pdf መፅሐፍት | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Amharic | Education/Books |
| 316 | @The_God_Empire / 🏆 The God Empire | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Finance/Trading + Technology |
| 322 | @DealspotGlobal / Amazon Deals | Global | Asia | medium | India (Telegram); India (TGStat); India (Recent public posts) | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 323 | @cryptofreedaily18 / CoinOrbit | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 340 | @fotbuasport / World Cup | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Finance/Trading + Technology |
| 341 | @NiazComTMS / NiazCom \| ترفند TM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Finance/Trading + Technology |
| 342 | @danestanirozanee / دانستنی ها 🔝 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Arabic/Persian / English | Finance/Trading + Technology |
| 344 | @Edujoshwithmk / EDUJOSH WITH MK | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Hindi/Devanagari / English | Crypto |
| 359 | @Desu_tech_tips / ĐESU ŦECH TIPS | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (TGStat); Ethiopia/Amharic (Recent public posts) | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 361 | @HAPPYFXTRADER / Happy fx📈📉 | Unclassified | Unclassified | low | no reliable geographic signal | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 362 | @The2018_Official / 🎯THE 2018 Education🎯 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Technology + Entertainment |
| 369 | @RLYkX8ZrLpc1ZDZl / ALL ERAN MONEY WORLD | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 370 | @DAILY_EARNING_OFFICIAL2 / DAILY EARNING [OFFICIALTM] | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 371 | @easyearnings78 / EASY EARN HUB | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 372 | @livrespdflecture / LIVRE pdf | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: matched public channel; Telemetr.com: not found | French | Education/Books |
| 374 | @Fun_zone24 / ፈን ዞን ❴View❵ | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (TGStat); Ethiopia/Amharic (Telemetr.me) | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / French / English | Finance/Trading + Technology |
| 375 | @Pashtotech1 / Najibullah Zirak 🇦🇫 | Unclassified | Asia | high | Afghanistan/Pashto (AdsGalaxy); Afghanistan/Pashto (Telegram); Afghanistan/Pashto (TGStat); Afghanistan/Pashto (Recent public posts) | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | Pashto / English | Crypto + Finance/Trading |
| 376 | @HAPPYFXTRADER / Happy fx📈📉 | Unclassified | Unclassified | low | no reliable geographic signal | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 377 | @Photo_Dizain_Af / ۞ مواد ډیزاین ۞ | Unclassified | Asia | high | Afghanistan/Pashto (AdsGalaxy); Afghanistan/Pashto (Telegram); Afghanistan/Pashto (Telemetr.me); Afghanistan/Pashto (Recent public posts) | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Pashto / English | Crypto |
| 378 | @font_Af / ⛖فونت افغانی Font AF⛗ | Unclassified | Asia | medium | Afghanistan/Pashto (Telegram); Afghanistan/Pashto (Recent public posts) | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Pashto / English | Crypto |
| 379 | @Keybord_AF / ڪیبورد افغانی | Unclassified | Asia | medium | Afghanistan/Pashto (Telegram); Afghanistan/Pashto (Recent public posts) | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Pashto / English | Crypto |
| 380 | @PixeiLab_Af / پیکسلاب افغانی | Unclassified | Asia | medium | Afghanistan/Pashto (Telegram); Afghanistan/Pashto (Recent public posts) | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Pashto / English | Technology |
| 381 | @KineMaster_AF / انشات/ڪپ کت/افغانی | Unclassified | Asia | medium | Afghanistan/Pashto (Telegram); Afghanistan/Pashto (TGStat); Afghanistan/Pashto (Recent public posts) | matched public channel | Telemetr.me: matched public channel; Telemetr.com: not found | Pashto / English | Technology |
| 384 | @income_help_sakib / Income Hub | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Cyrillic-language / English | Crypto + Finance/Trading |
| 388 | @hgzysignal98 / Hgnice signal mentor | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading |
| 389 | @GiftCardsCreditCardSeller / Credit cards and gift cards seller | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Technology + Entertainment |
| 390 | @prime_channel01 / The Prime Channel | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Entertainment |
| 391 | @mjobforu / Mjobforu | Unclassified | Asia | medium | India (Telegram); Bangladesh/Bengali (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Finance/Trading + Technology |
| 392 | @airdropbot2026telegram / NEW EARNİNG BOTS 💲 | Unclassified | Unclassified | low | UAE (Telemetr.com); Korea (Recent public posts) | not found | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Cyrillic-language / English | Crypto + Finance/Trading |
| 396 | @you_free_top / i️🆕🆓FREE_MEDiA_MATERiALS🆒🔝 | Unclassified | Unclassified | low | UAE (Telemetr.com); Indonesia (Recent public posts) | matched public channel | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Cyrillic-language / English | Crypto + Finance/Trading |
| 397 | @Earnnify / Earnnify | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked (403) | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 398 | @Sumon_sm_Tech_sm / SUMONsm TECH🇧🇩💙 | Unclassified | Asia | high | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.me); Bangladesh/Bengali (Recent public posts) | not found | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 399 | @MasterPrimeTrick / Mᴀꜱᴛᴇʀ TʀɪᴄᴋꜱTM | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 400 | @Jaysfxhubb / The Crypto Express | Unclassified | Unclassified | low | no reliable geographic signal | not found | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 403 | @YashxUdit / ʏᴀsʜ x ᴜᴅɪᴛ ᴛᴜᴛᴏʀɪᴀʟs ʏᴛ | Unclassified | Unclassified | low | no reliable geographic signal | matched public channel | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / Korean / English | Crypto + Finance/Trading |
| 404 | @ethiopian_newsjob / ETHIOPIAN NEWS | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 405 | @SnowyNightTimelessLoveEng / Snowy Night Timeless Love 2024 Eng Sub | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Crypto |
| 414 | @Easy_Tech_1 / Easy Tech | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Cyrillic-language / English | Finance/Trading + Technology |
| 415 | @justforfuns1 / JUST FOR FUN | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Entertainment |
| 416 | @oussama55cryptos / oussama55cryptos | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | French / English | Crypto + Finance/Trading |
| 417 | @islamic_visions / Islamic Vision | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Amharic / English | Finance/Trading + Entertainment |
| 418 | @islamic_visions / Islamic Vision | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Amharic / English | Finance/Trading + Entertainment |
| 422 | @MAHAMANAVVIDYUTH_superyoddha / MAHAMANAV VIDYU / Super Yoddha | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Hindi/Devanagari / English | Crypto |
| 423 | @ethiocryptora / ETHIO Crypto | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Amharic / English | Crypto + Finance/Trading |
| 424 | @ET_WALLPAPERS / Wallpaper | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / French / English | Finance/Trading + Technology |
| 425 | @king_ena_queen / king & Queen | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / French / English | Finance/Trading + Technology |
| 427 | @ESPN_Sports1 / Sports ET | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / French / English | Finance/Trading + Technology |
| 430 | @Valchurx / Valchur | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 432 | @Ethiofreeinternet2 / NAOL TECH | Unclassified | Unclassified | low | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 433 | @InstantAirdr0pCash / 💰 Instant Airdrop Cash | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 434 | @CryptoDropZone077 / Crypto Drop Zone 🔐 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Crypto |
| 439 | @Siketamanet / ስኬት | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto |
| 440 | @h247235 / Crypto abridged 💵💲💸 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 442 | @cryptonewsupdates1234 / Crypto news | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 445 | @Ethio_short_note1 / Ethio short note | Unclassified | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Education/Books |
| 446 | @ORO_HALA_MADRID / ORO_HALA_MADRID | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 447 | @trustyproofs / Trusty 💯 notice | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 449 | @Zola_20 / Zola20 | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 453 | @EthiopiaHighSchool1 / Ethiopian High School | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Education/Books |
| 454 | @Abe_gaming / Abe Gaming | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 456 | @ethio_liontech / Ethio lion tech | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Amharic / English | Finance/Trading + Technology |
| 457 | @EthioVoiceChatEVC / Ethio Voice Chat | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 458 | @moviestur / Movies tur | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Unknown | Entertainment |
| 461 | @Fresh_Hub1 / Fresh & Remedial HUB | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic | Crypto + Entertainment |
| 462 | @moviestur / Movies tur | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Unknown | Entertainment |
| 463 | @dailyinjera12 / Daily injera | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Amharic / Chinese / Japanese | Education/Books + Religion |
| 473 | @Oro_Sportzone / ORO SPORT ZONE ⚽️ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Sports |
| 474 | @N5NHz1gd_K00MDI1 / 🇪 🇦 🇷 🇳 🇬 🇭 🇴 🇷 | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 475 | @sca_tech / SCA TECH | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 476 | @ethiopianj_job / ETHIO PROMOTION | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 477 | @oro_Besoccer_all_league / ORO BESOCCER ALL LEAGUE | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 478 | @beeksisa_hojjetaa / BEEKSISA HOJII | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 479 | @bingoethii / Fana Bingo | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Gaming |
| 480 | @sarfzmp / Think positiveTM ✊ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading |
| 481 | @Htechtips01 / H Tech Tips 💻📱🖥 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 484 | @kefafi_service / Kefafi Service 🦅 | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading |
| 485 | @LinklayersVpn / 4G Free VPN | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 486 | @crypto_0978 / Crypto | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 487 | @dedaracademy / Dedar Academy | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic | Crypto |
| 488 | @sodare_store / MR ADONAY | Unclassified | Unclassified | low | Ethiopia/Amharic (Telemetr.me) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Crypto |
| 489 | @SeenaaJalaala / Seenaa Jaalalaa ❤️ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 490 | @lookoojalaala / LOOKOO JALAALA | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / Arabic/Persian / English | Crypto + Technology |
| 491 | @loulmaedit / Bura Creator | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Amharic / English | Technology + Entertainment |
| 492 | @motivation4301 / Money Without Money 💰 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 494 | @ETHIO_FREE_INTER / ETHIO FREE INTERNET TM | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 495 | @misitiodenegocios / Mi Sitio de Negocios \| Noticias \| Canal de Proyectos | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Spanish / French / English | Finance/Trading + Technology |
| 496 | @darkstars2025 / Black_Stars 🖤 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Finance/Trading + Technology |
| 499 | @Darshini_Sookshmaa / Sookshma Darshini Movie 🎥 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Entertainment |
| 502 | @Ashamtech24 / ASHAM TECH Multimedia (ATM) | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 503 | @Danbalii_jaalala / Danbalii jaalalaa♥️🦋 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 504 | @crypto23795 / Crypto house | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Crypto |
| 505 | @exam1621B / WCU Brilliant Student 📖 | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic | Gaming |
| 507 | @beststady / BEST STUDY | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Education/Books |
| 513 | @t2t2t2a / t2t2t2a | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish / French / English | Finance/Trading + Technology |
| 514 | @ffultrapanel / FF ULTRA PANEL❕ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 524 | @freeinternet2018 / Max Tech | Global | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 552 | @Termux_For_Android / Termux Hackers (Users) | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Technology + Entertainment |
| 565 | @admoneyhub / Admoney hub | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 568 | @CHELSEAclud / CHARLES FC👑 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 569 | @HIREE_JAALALA / Diraamaa Hiree Jaalala© | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto |
| 571 | @dunyabellichanel / DünÿaBelliChanel | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / English | Finance/Trading + Technology |
| 573 | @Fast_telekom / HAPP VPN | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / English | Technology + Gaming |
| 574 | @servers_community / SERVERS_COMMUNITY | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / Spanish / French | Finance/Trading + Technology |
| 576 | @NARUTO_SMM_PANEL / NARUTO SMM PANELTM7❤️ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 579 | @gbintos_fims_club_ii / GBINTOS FILMS CLUB II🐊 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Finance/Trading + Gaming |
| 580 | @Diraamaa_Hirkoo_Marsaa_3 / Diraamaa Hirkoo Maarsaa 3ffaa | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 581 | @FREE_INCOME_USDT_BOT1 / FREE INCOME | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Japanese / English | Finance/Trading + Technology |
| 583 | @Regents_Combos / BD EARNERZ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 584 | @surestairdrop123 / UPDATE 2💯 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 585 | @SINELINKS / SINELINKS MOVIES 🎬 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Entertainment |
| 587 | @Gbintos_Netflix_series / NETFLIX SERIES🐊 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Entertainment |
| 588 | @TarekMonour12 / Tarek Monour | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 589 | @Tech_GEDR / Tech GEDR | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 593 | @fujv2025 / Money Bux | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / Cyrillic-language / English | Finance/Trading + Technology |
| 601 | @Rkapic12 / Christian profile picture RK | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Religion |
| 604 | @freeinternet_crypto / Free internet,Ethiocryptocurrency, financial News | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Amharic / English | Crypto + Technology |
| 605 | @mamuntricks / MAMUN TRICKS | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Technology |
| 608 | @TradingVcomunity / Trading V Signal Harian All Pair | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 610 | @talepalthlagi / الربح المجاني$ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Crypto + Finance/Trading |
| 611 | @BHAIPAISAINVEST / Earning Opportunity 💸 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 612 | @freeupdateontelegram / Naija🇳🇬 community free 💯 online update | Unclassified | Unclassified | low | Nigeria (AdsGalaxy); Nigeria (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | French / English | Crypto + Finance/Trading |
| 613 | @vpns_serwer / VPNS_SERWER🔑 | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Finance/Trading + Technology |
| 614 | @Make_money_online13 / Make Money | Unclassified | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 615 | @Anime_Union_Movies / Anime Movie ✿ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Entertainment + News |
| 616 | @UNION_LIBERTE_AFRICAINE_TV / UNION LIBERTÉ AFRICAINE ✊🏿💪🏿🌍✨️️ | Unclassified | Africa | high | Africa (AdsGalaxy); Africa (Telegram); Africa (Telemetr.me); Africa (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French | Finance/Trading + Education/Books |
| 619 | @newincomebd445 / New Airdrop | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 621 | @freemarrow24 / Main group lectures | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 624 | @Crest_Airdrop / Crest Airdrop 👨‍💻 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 625 | @LegotMoney / Legot Money🎄☃️ | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 626 | @Book_Zzone / Bookzone | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Finance/Trading + Technology |
| 627 | @TeamVFE / Team </> V F E | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 628 | @renegade_immortall / Renegade immortal (xian ni) | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Unknown | Crypto |
| 634 | @RBlNCOMEZONE1 / RB INCOME ZONE | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading + Technology |
| 636 | @anegagaris / አነጋጋሪ | Unclassified | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 637 | @bleachanimesubeng / Bleach Sub English | Unclassified | Unclassified | low | UAE (Telemetr.com) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Unknown | Crypto |
| 638 | @NeverlosehopeF / Never Lose Hope | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Education/Books |
| 641 | @cryptocenterethiopia / Crypto Center Ethiopia️ | Unclassified | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 645 | @Red_Serwer / ❄️VIPPER TELECOM 2🇹🇲 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / English | Finance/Trading + Technology |
| 647 | @CO_Earnings / CO-Earnings❤️‍🔥 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Cyrillic-language / English | Crypto + Finance/Trading |
| 855 | @amoneyyguide / MONEY GUIDE | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 857 | @freeearningairdrob / الربح المجاني | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Finance/Trading + Technology |
| 861 | @DannyYoungOfficial / Danny Young Official | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 862 | @haunted_gamer / Haunted gamers | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Japanese / English | Crypto + Gaming |
| 869 | @twerkishi / TWERKISH HUB 🔞 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | NSFW +18,Entertainment,Gambling |
| 870 | @toypenetration / PENETRATION TOYS | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | NSFW +18,Finance,Crypto |
| 871 | @MacroMindsX / MacroMindsX | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 873 | @bsqbox / Daily Crypto Drop 🎁 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto + Finance/Trading |
| 874 | @freeincomesied1 / ফ্রি টাকা ইনকাম | Global | Asia | high | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.com); UAE (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Bengali / Hindi/Devanagari / Arabic/Persian | Crypto |
| 876 | @ / Make cash way | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Crypto,Finance,Other |
| 877 | @ / CASH PLUG | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment,Crypto,Other |
| 881 | @pepepayoutstreak / Pepe Payout | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | News |
| 885 | @winner12435 / FOOTBALL BET AND SURE FIXED FREE GAME ⚽ | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 902 | @GAMERS_ESCROW_TEAM / GAMERS ESCROW [ REDIRECT ] | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Gambling,Entertainment,Shopping |
| 905 | @EmdeePCGames / 🖥💻📲 PC GAMES / Winlator_GameHub_Switch Emulator | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 908 | @CryptoGreal / CryptoG | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 911 | @Marvelousvibes001 / MΛRVΞLØUSHUB | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Crypto,Gambling,Entertainment |
| 914 | @meualways / Beautyhub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 915 | @Multi_Talents / Multi Talents | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 920 | @AirdrpPartner / AIRDROP PARTNER | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 921 | @AndroidFullGame / ANDROID GAME | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish | Technology + Gaming |
| 925 | @makemoneyonlain99 / 🔥 make money online 🔥 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 931 | @emoneydenu / E MONEY DENUWA🎉️🇱🇰 | Global | Asia | medium | Sri Lanka (AdsGalaxy); Sri Lanka (Telegram); Sri Lanka (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 932 | @cryptoairdrop240 / 💟Crypto Airdrop 💟√💯 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 935 | @WalakathalanthayaNew / Wal katha Lanthaya New💋📝🥇 | Global | Asia | medium | Sri Lanka (Telegram); Sri Lanka (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Entertainment |
| 939 | @rafi_Free_income / RAFI FREE INCOME | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 948 | @OnlineIncomeGansta / ONLINE INCOME TEAM BD | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 950 | @ / VIJAY JI TRICKS 🔥 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Crypto,Education,Gambling |
| 952 | @easytips430 / Asian Asset | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 957 | @habersimeencuentras2 / Peliculas y Series Gratis Para Ti😎 😎😎 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Spanish / French / English | Entertainment |
| 965 | @Free_Money_Mining_Crypto_airdrop / FREE CRYPTO AIRDROP MINING 2026💰 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 967 | @xxxmood_adultdesi / PRIVATE XXX MOOD 🥵 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Entertainment,NSFW +18,Tech |
| 968 | @DailyFreeEarnings1 / Daily Free Earnings | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Finance/Trading + Gaming |
| 969 | @ethiofreeinternetfiles_b / FREE INTERNET FILES | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Telemetr.com); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Technology + Entertainment |
| 971 | @CineVerseHubOficial / CineVerse Hub Official | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Entertainment |
| 972 | @mbadults / MB21 Adults | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Entertainment,Crypto,Education |
| 974 | @NeronLab_bd / Neerob Earning Lab | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari | Finance/Trading |
| 980 | @allincametex / EASY CRYPTO HOUSE BD 🇧🇩!!️ | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Crypto + Finance/Trading |
| 981 | @Aliexpress_o / تخفيضات ALIEXPRESS و AMAZON | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian | Gaming |
| 983 | @ernining_ads / EARNING AND ADS | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 987 | @Sakib_2400 / ফ্রি ইনকাম সাইড বাংলাদেশ 💸💸 | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 992 | @FreeIncomeHub31626464 / 💰Free Income Hub💰 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading + Entertainment |
| 997 | @howl_for_money1 / Howl for Money(ብር)//24HrTM🐺 | Africa | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Finance/Trading + Entertainment |
| 1001 | @CapComPCGames / CapCom PC Games | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Gaming |
| 1003 | @EsayEarn_Cash_BD / Esay Earn Bd | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Technology |
| 1010 | @digital_Marketing_groups / Digital Marketing Group \| Canva pro | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1011 | @moviexyz9 / HINDI MOVIE BOX | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Entertainment |
| 1013 | @coinbaskets / CryptoCoinBaskets | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / Chinese / English | Crypto + Technology |
| 1014 | @brother59787 / Brother Earning Group🤑 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Cyrillic-language / English | Crypto + Finance/Trading |
| 1015 | @SHIB_PY / SHIB PY | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Religion |
| 1017 | @captech_official / K-NEWS TM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Gaming + News |
| 1020 | @ucdriveterapelis / UC DRIVE pelis y series 2026 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish / French / English | Finance/Trading + Entertainment |
| 1021 | @teleboxpeliserieslat / Telebox - Peliculas y series Gratis😎 😎😎😎😎 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish / French | Entertainment |
| 1022 | @jsojsk6s / TR-X ܔ HGZY BIG COMMUNITY ➪ 💙࿐ | Global | Asia | high | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.com); UAE (Telemetr.com); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Bengali / English | Finance/Trading + Technology |
| 1025 | @ASTRA_TUNNEL / GLOBAL PUBG🇹🇲 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language | Technology + Gaming |
| 1027 | @bunnyearnhubpay / Bunny earn hub payment 💸 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1030 | @NextGenCryptoOfficial / NextGen Crypto | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1031 | @earningways37 / Earning ways | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1032 | @withdrawlProof2026 / Withdrawal Proofs💰 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1033 | @seximodell / Sexiimodell | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1034 | @payoutalwayshere / ✨ Crest Hub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1036 | @passiveincomewithemily / Passive Income with Emily | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1037 | @found200ok / 404 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Finance/Trading + Technology |
| 1044 | @brs_apk / ☁️☁️☁️ BRS APK ☁️☁️☁️ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / English | Finance/Trading + Technology |
| 1046 | @online_income_forum / 💵 ONLINE INCOME HUB | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Education/Books |
| 1048 | @videolinksove / সব ধরনের ভাইরাল ভিডিও 😘 | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Gaming |
| 1049 | @cryptoearnnow1 / Crypto Earn Now | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Bengali / English | Crypto + Finance/Trading |
| 1050 | @bugismp3 / Pecinta lagu bugis | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish | Crypto,Entertainment,Shopping |
| 1053 | @ton_pro_life / Tonprolife | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish / French / English | Crypto + Finance/Trading |
| 1054 | @Luminalearn23 / LuminaLearnTM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Gaming |
| 1062 | @DirectorioTelegram / DIRECTORIO TELEGRAM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / English | Crypto,Tech,Other |
| 1063 | @binasou4 / BINASOU4💸CHANNEL😎 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / English | Technology |
| 1066 | @ethio_fiction / ልብወለድ Ethio_Fiction | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Telemetr.com) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Amharic / English | Crypto + Entertainment |
| 1067 | @SPOILMILKCHRNO / dev dé Chronos [spoilmilk] | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Technology + Gaming |
| 1072 | @capcut4u / Capcut Pro | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Finance/Trading + Technology |
| 1073 | @movie_night_9 / Movie Night 9 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / English | Entertainment |
| 1078 | @bashlafilms / Bashka films | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Entertainment |
| 1079 | @Baabajifilms / Cade Films | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Entertainment |
| 1080 | @ / Cade Films | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment |
| 1083 | @X_X_X3x2 / X_X_Xray | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Education/Books |
| 1084 | @MoviePlanetbest / Movie Planet | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / English | Technology + Entertainment |
| 1089 | @BFMcfkxpQ9M0MWZk / PREMIUM ACCESS TO AI TOOLS AND APPS | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto,Finance,Tech |
| 1093 | @onlineincome1090 / Online Income Bd | Global | Global | low | UAE (Telemetr.com); Bangladesh/Bengali (Recent public posts); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | Bengali / English | Crypto + Finance/Trading |
| 1095 | @gsf8mqOl0atkMTM / PREMIUM ACCESS TO 10,000+ MOBILE SOFTWARES | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Technology |
| 1096 | @GetCanvaProTips / Canva Pro & Tips | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Technology |
| 1097 | @rPtNb1SSQJUzNTVk / PREMIUM ACCESS TO CAPCUT APPS ONLY | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Tech,Crypto,Education |
| 1100 | @elismandate1 / Elismandate | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1101 | @whaletracks_trading / WhaleTracks \|\| Trading | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1102 | @xHeartMafia / 🅗🅔🅐🅡🅣❤️‍🔥🅜🅐🅕🅘🅐 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Crypto + Technology |
| 1107 | @SBCryptoz / ❤️‍🔥S&B🌞 Crypto Club | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1108 | @TR_Coins / 🇹🇷TR🇹🇷 Kripto🧧 | Global | Asia | high | Turkey (AdsGalaxy); Turkey (Telegram); Turkey (Telemetr.me); Turkey (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1109 | @HB_VIPS / ❤️‍🔥HB VIP🌹 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1111 | @HBoxes / BOXES💎 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1112 | @HB_CRPB / Crypto Red Packet Box | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1113 | @HBCryptoClub / CryptoClub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1114 | @HB_Cryptoz / 🤘HB🤘Cryptoz | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1115 | @Anadolu_m / 🇹🇷Anatolian Boxes | Global | Asia | medium | Turkey (AdsGalaxy); Turkey (Telegram); Turkey (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1116 | @BoxxSquare / Box Binance Square | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1117 | @boxmafia2 / BoxMafia | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / Chinese / English | Crypto + Finance/Trading |
| 1118 | @PSMOMP / PS M | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1119 | @TGBOXXX / Tgbox | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1120 | @catsreed / 🦋RED PACKET 🦋 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto + Finance/Trading |
| 1121 | @MMBoxes / 🧧MMBoxes🎁 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1122 | @HBAnatolia / ❤️‍🔥ANATOLIA🌞 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1123 | @hbcryptobox / HBCryptoBox | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1126 | @FENGSKCRYPTO / SK CRYPTO | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Technology |
| 1127 | @binanceredpacketcodetoday / Binance Red Packet 🤑 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Arabic/Persian / Chinese / English | Crypto + Finance/Trading |
| 1128 | @JoinChainSpark / ChainSpark | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / Chinese | Crypto + Finance/Trading |
| 1129 | @hubcut / Hubcut | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Finance/Trading + Entertainment |
| 1132 | @ / Premium collection | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment,NSFW +18,Other |
| 1133 | @BDEarnigMoney / BD Earning Money | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Finance/Trading |
| 1140 | @crypto_stream_hub / Crypto Stream Hub | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto |
| 1141 | @fetbyop / Free Earning Together | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1143 | @DSRKAK / °”RamCrypto”° | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1144 | @tour_harar / Tour_Harar 👍😉 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1145 | @CryptoAmbarr / CrYpto ÁmBar ✨💕 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Crypto |
| 1146 | @Babagonigambocryptoupdates / TRUST UPDATES 💯💯💯 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 1147 | @earntogether32 / 🔥 EARN TOGETHER🤝🔥 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1148 | @amirthelverpoolfun / Etho Liverpool family 🇪🇹 | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / Arabic/Persian / English | Finance/Trading + Technology |
| 1149 | @freeinterneetn / Free Internet | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / Cyrillic-language / English | Finance/Trading + Technology |
| 1151 | @usdt_usdc_hub / Only USDT & USDC | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto + Finance/Trading |
| 1152 | @Cryptorain21 / Crypto Rain🤑💵 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Crypto + Finance/Trading |
| 1153 | @Rainbox11 / Rain Box🤑🎁 Binance y Bybit | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / Spanish / French | Crypto + Finance/Trading |
| 1156 | @pkgoldtv5700 / PK Gold TV | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Finance/Trading + Technology |
| 1157 | @desarrollo_personal_plus / Desarrollo Personal Plus 🚀 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish / French / English | Finance/Trading + Health |
| 1164 | @OttomanCripto / OTTOMAN EMPIRE ☾⋆ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1166 | @cryptoupdate1136 / CRYPTO UPDATE and FREE AIRDROP INCOME | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1168 | @hiveearnpayment / Hive earn \| payment 🐝 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Finance/Trading + Technology |
| 1170 | @binanceXcodes / BINANCE X CODES | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1171 | @Mamun47YT / Mamun 47 YT | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading + Technology |
| 1173 | @premmium_giveaway / Telegram premium giveaway مسابقات تلجرام مدفوع | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Arabic/Persian / Cyrillic-language / English | Crypto + Finance/Trading |
| 1175 | @RemiXoSuond / ریمیکسوRemixo | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian | Crypto,Tech,Finance |
| 1179 | @Binanceairdropsclaim / Binance Airdrops & Rewards | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / Spanish / English | Crypto + Finance/Trading |
| 1183 | @JUST_CHELSEAFC / JUST CHELSEA FC | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + News |
| 1188 | @ / Instagram work | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment |
| 1253 | @earnverse182 / Earn With Rasel | Unclassified | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Finance/Trading + Technology |
| 1258 | @msiam20 / EASY mone💣💥❤️‍🩹❤️‍🩹❤️‍🩹 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1259 | @jobsformaharashtra / Jobs Update | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Hindi/Devanagari | Jobs |
| 1263 | @moneybymbm / MONEY BY MBM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading |
| 1264 | @ / UGANDAN LINKS🇺🇬 | Global | Africa | medium | Uganda (AdsGalaxy); Uganda (Telegram) | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Other |
| 1265 | @SengaUganda / UGANDA❤️SSENGA🇧🇪⚡️ | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Education/Books |
| 1266 | @UGANDANLINKS / UGANDAN LINKS 2🇺🇬 | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Other |
| 1267 | @ / UGANDAN 🇺🇬LINKS BACKUP | Global | Global | low | Uganda (AdsGalaxy); existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Other |
| 1268 | @medicalmedagebeya2 / Medical Meda Gebeya26 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Finance/Trading + Health |
| 1269 | @UgandaNewsFeeds247 / UGANDA NEWS FEEDS | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Gaming |
| 1270 | @UgandanVibez / UGANDAN🇧🇪MUSIC🎵 | Global | Africa | high | Uganda (AdsGalaxy); Uganda (Telegram); Uganda (Telemetr.me); Uganda (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Entertainment |
| 1273 | @AF_FreeInternet / 🇾🇪 AF Free Internet 🇾🇪 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Technology |
| 1274 | @ / Instagram viral | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment |
| 1275 | @Anime_world_en_VF / Anime World VF🇫🇷 | Global | Europe | high | France (AdsGalaxy); France (Telegram); France (Telemetr.me); France (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Entertainment |
| 1276 | @Film_serie_en_vf / Film et Séries vf🇫🇷 | Global | Europe | high | France (AdsGalaxy); France (Telegram); France (Telemetr.me); France (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French | Other |
| 1277 | @SALMANPHONK / ┈━═❣️ SIMPLE_PHONK❣️═━┈ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Entertainment |
| 1281 | @FANBAROJSTUDIO / KAAPE STUDIO | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Entertainment |
| 1287 | @adimasmedia / አድማስ ሚዲያ | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading |
| 1288 | @BiniTech69 / Bini_TechTM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / Cyrillic-language / English | Finance/Trading + Technology |
| 1289 | @shadhin_media / Shadhin Media | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1291 | @binanceXboxes / BINANCE BOXES | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto |
| 1293 | @theTechgu7 / TECH GUY | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1341 | @cieloffcialshow / khalifa show🎀 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1349 | @NEXUSDTOFFICIAL / SONIC UPDATE⚡️ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1384 | @ / Maahir-filmis 3🎬 | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment,Other |
| 1385 | @maahir222 / MAAHIR FILIMS 🎥2 | Africa | Africa | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Unknown | Entertainment,Other |
| 1390 | @YeRasBirr / የራስ ብር \|\| YeRas Birr 💰 | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 1391 | @BinanaceRewards / 🧧Binance Red Packets And Events🧧 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Finance/Trading |
| 1392 | @cryptominingproject0 / Crypto Airdrop | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1395 | @alfa_wolf_16 / FREE EARNING⚡ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1416 | @bdearnmoneywithme / BD EARN MONEY WITH ME | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1421 | @ethtypingfree / Typing free internet | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 1424 | @click_mint / CLICKMINT | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1437 | @h_uma / 🦋BLACK CRYPTO | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto + Finance/Trading |
| 1438 | @ / Kdrama Talkies-NEWS/UPDATES | Global | Global | low | China (Telegram); Korea (Telegram); existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | English | News |
| 1442 | @moviebox_series / MOVIE BOX (مسلسلات) | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Entertainment |
| 1444 | @HD_ANIME_MOVIES / My 1 channel | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1445 | @ / Movie Park 2.0 🇺🇬⚡️ | Global | Global | low | Uganda (AdsGalaxy); existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment |
| 1447 | @courseguy_udemy / Udemy courses FREE courseguy | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Education/Books |
| 1448 | @courseguy_vip / COURSEGUY VIP | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1450 | @English_course_books / Language courses and books | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Education/Books |
| 1455 | @binanceredpacketcodes17 / Binance Red Packet🎁🎁 Codes And Crypto Airdrops | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1456 | @CryptoHBChannel / Crypto world | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1457 | @As_Alvi_Crypto / As_ALVI_CRYPTO_OFFICIAL🤑 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Crypto + Finance/Trading |
| 1458 | @Ani_Cryptoo / ANI CRYPTO | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Crypto + Finance/Trading |
| 1462 | @RealPaymentbd / Help To Income💸 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1463 | @vairal_video_ofc / VAIRAL VIDEO | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1467 | @GokenCryptoo / GOKEN CRYPTO | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 1469 | @muhahahayha / Muhahahahaha | South America | South America | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Entertainment |
| 1470 | @Mundo_Memess / 😂 Memes de humor negro | South America | South America | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Finance/Trading |
| 1471 | @HoroscopoTarot / 🃏🔮 Horóscopo / Tarot 🔮🃏 | South America | South America | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French | Technology + Entertainment |
| 1472 | @ultimasnoticias24h / 🚨!!️Noticias del mundo 24h | South America | South America | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Spanish / French / English | Finance/Trading |
| 1473 | @alvisevoxayuso / Curiosidades | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | News |
| 1474 | @mepartoelojal / Me parto el nucleo | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Spanish | Entertainment |
| 1475 | @recetasrapidas / Amo La Comida 🍔 | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French | Entertainment |
| 1476 | @juasjuasjo / Juasjuasjuas | Unclassified | Unclassified | low | no reliable geographic signal | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Entertainment |
| 1483 | @Modapkpremiumunlocked09 / MODDING HUB | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Japanese / English | Technology + Entertainment |
| 1485 | @dawit3991 / Dawit Creates | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Education/Books |
| 1487 | @Abhishek63897 / EARNING WITH ABHISHEK | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1490 | @red_packet_hunter / Crypto Hunter | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto + Finance/Trading |
| 1491 | @CTET_CDP / CTET CDP MISSION 2026-2027 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Education,Tech |
| 1494 | @canvaproteam02 / Canva Pro Team | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Tech,Education,Entertainment |
| 1495 | @APKPREMIUMFULL / APK PREMIUM FULL | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish | Technology |
| 1496 | @abfreenet / ABBIYO FREE INTERNET | Global | Africa | medium | Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Technology |
| 1497 | @sinhala_wal_lk / වැල් ලන්තය | Global | Asia | high | Sri Lanka (AdsGalaxy); Sri Lanka (Telegram); Sri Lanka (Telemetr.me); Sri Lanka (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Entertainment |
| 1504 | @EarnHub_India / EarnHub | Asia | Asia | medium | India (Telegram); India (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Technology |
| 1505 | @Crypto_BD420 / Crypto BD | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 1506 | @bd_wh_eran1 / ◥👑◤ Bd_Wh_ERAN | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading + Technology |
| 1507 | @ / EarnPro Official 💵 | Global | Global | low | Bangladesh/Bengali (Telegram); existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Bengali | Crypto,Other,Education |
| 1508 | @allinbd / ALLINBD 🇧🇩 | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading + Technology |
| 1509 | @easyearnprorm / EASY EARN PRO | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading |
| 1510 | @bd_web_zone01 / BD WEB ZONE | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Bengali / English | Finance/Trading + Technology |
| 1511 | @financefreedomtv / Finance Freedom TV | North America | North America | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Finance/Trading + Entertainment |
| 1512 | @gmailbuyer2938 / Gmail buy & sell & premium vpn seller | Global | Asia | high | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Telemetr.com); UAE (Telemetr.com); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Bengali / English | Finance/Trading + Technology |
| 1514 | @Cryp2Butterfly / ʙᴜᴛᴛᴇʀꜰʟʏ ᴄʀʏᴘᴛᴏ 🦋 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1518 | @zuckeredits_official / Zucker Edits | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Finance/Trading |
| 1519 | @satyagamer01 / Satya Gamer | Global | Global | low | UAE (Telemetr.com); India (Recent public posts); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Finance/Trading + Technology |
| 1520 | @ShahbazSaeedOfficial / SS Official Earning Hub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1521 | @AirdropsGlobally / Airdrops Globally | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1523 | @mautvirusgaming / MAUT VIRUS GAMING | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Finance/Trading + Gaming |
| 1524 | @amazingproducts24 / Amazing Products | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Shopping |
| 1527 | @islamicpediia1 / ইখওয়ানুল মুসলিমিন(الإخوان المسلمون) | Global | Asia | medium | Bangladesh/Bengali (AdsGalaxy); Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / Arabic/Persian | Crypto |
| 1528 | @Aysquaretv / Ay square TV 📺 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Entertainment,Tech,Crypto |
| 1529 | @ / MatchMe 💌 Channel | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment,Other,Crypto |
| 1531 | @easytips643 / Easy Tips | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / Arabic/Persian | Crypto + Finance/Trading |
| 1532 | @memestendencias / MEMES HOY🔥 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / English | Technology |
| 1533 | @streamhoy / StreamHOY \| Noticias De Cine 🌀 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Spanish / French / English | Entertainment |
| 1534 | @online_tech56 / Online tech | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1535 | @treward_ton / TRewards News N Update | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1536 | @ltcminernews / LTC Miner News | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Finance/Trading + News |
| 1537 | @Freerewardes / Free Reward 🧧 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / Chinese / Spanish | Crypto + Finance/Trading |
| 1538 | @Secret_ViP_Box / Secret ViP Box 🎁 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Arabic/Persian / Chinese / Spanish | Crypto + Finance/Trading |
| 1539 | @freevipbox / Free ViP Box 🎁 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | Chinese / English | Crypto + Finance/Trading |
| 1543 | @cryptocashx1 / CRYPTOCASH$$$ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1544 | @Take_TechX / Tᴀᴋᴇ TᴇᴄʜX \|\| CʀʏᴘᴛᴏTM | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1545 | @orkonos / ORKONOS | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1546 | @MedianFire / 2 channel | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Entertainment |
| 1547 | @HorrorAllMovies / 3 channel | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1548 | @sarrbalgyi40 / Ton&usd | Asia | Asia | medium | Myanmar (Telegram); Myanmar (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto |
| 1549 | @Online_Shopping_Spot / Online Shopping | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Shopping |
| 1550 | @nairobigossipclupunique / CRYPTOVERTS | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1552 | @V2Ray_Files / ETHIO FREE SERVER | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Technology |
| 1553 | @AScryptoz / ❀A&S ᴄʀʏᴘᴛᴏ ꜰᴀᴍɪʟʏ❀ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1554 | @ECryptozz / ELITE CRYPTO | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Chinese / English | Crypto + Finance/Trading |
| 1555 | @EthioFreeBingo / ABISINIYA FREE BONUS'S | Global | Africa | medium | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Amharic / English | Finance/Trading + Technology |
| 1556 | @Zaahidmusalsals / ZAAHID MUSALSALS | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Other |
| 1557 | @THENEWEARNERS / ALL EARNINGS (.) | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Crypto + Entertainment |
| 1559 | @ElevenCourses / Eleven Courses 👾 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / English | Gaming + Entertainment |
| 1560 | @ElevenBooksOfc / Eleven Books | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Education/Books |
| 1561 | @ / Tech Hub | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Technology |
| 1562 | @CentralApksOficial / Central APKs | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Gaming + Entertainment |
| 1563 | @Aesthetic_GalleryOfc / Aesthetic Gallery | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / English | Gaming + Entertainment |
| 1564 | @ElevenCoursesofc / Eleven Co*rses (Backup Oficial) 👾 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Gaming + Entertainment |
| 1565 | @airdropearningzone20 / Airdrop Earning Zone ▶️ | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 1566 | @Bangladesh_Big_Communite_26 / Bangladesh Big Communite 👑 | Global | Asia | medium | Bangladesh/Bengali (Telegram); Bangladesh/Bengali (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / English | Other,Crypto,NSFW +18 |
| 1567 | @digitalznomad / Digitalz nomad academy | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading + Education/Books |
| 1568 | @freeAdrop57 / Free Airdrop | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Crypto |
| 1569 | @MAFIAPNELZONE / 𖤍 THE_SILENT_MAFIA 𖤍 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Hindi/Devanagari / English | Gaming + Education/Books |
| 1570 | @F67Drop / 67 Drop | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Crypto + Finance/Trading |
| 1571 | @JK_FREENET / JK ነፃ | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / English | Crypto + Finance/Trading |
| 1572 | @Cryptochannel0752 / Earn with ton❤️ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Finance/Trading |
| 1573 | @fguiookj / INCOME BD | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Bengali / Hindi/Devanagari / English | Finance/Trading + Technology |
| 1574 | @Apostolic_Fellowship / Aᴘᴏsᴛᴏʟɪᴄ FᴇʟʟᴏᴡSʜɪᴘ \| ሐዋርያት ኅብሬት (ACE) | Global | Africa | high | Ethiopia/Amharic (AdsGalaxy); Ethiopia/Amharic (Telegram); Ethiopia/Amharic (Telemetr.me); Ethiopia/Amharic (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Amharic / Arabic/Persian / English | Technology + Religion |
| 1575 | @nipanyar / နည်းပညာရှမ်းကော | Asia | Asia | medium | Myanmar (AdsGalaxy); Myanmar (Telegram); Myanmar (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Tech |
| 1576 | @Royal_Quiz_Hub / 🎖️ROYAL QUIZ HUB🎖️ | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Hindi/Devanagari / English | Education/Books + Health |
| 1577 | @ / Movie Crib🏆🏆 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Entertainment |
| 1578 | @CryptXbox / BINANCE RED PACKET🧧 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Crypto + Technology |
| 1579 | @binanceredpacketall078 / Binance red Packet Gift 2.0 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: matched public channel | English | Technology |
| 1580 | @CameroonEarningHub / Cameroon 🇨🇲 Earning hub | Global | Africa | medium | Cameroon (AdsGalaxy); Cameroon (Telegram); Cameroon (Recent public posts) | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Crypto + Finance/Trading |
| 1581 | @make_money_daily_0 / 💶 CASH ORBIT INCOME 💰 | Global | Global | low | UAE (Telemetr.com); existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: matched public channel | English | Crypto + Finance/Trading |
| 1582 | @Perrydrop / ESHIZ UPDATES | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance/Trading |
| 1583 | @nrie0 / thunder 🚬 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Cyrillic-language / English | Tech,Finance,Crypto |
| 1584 | @quote_jalala / STORE JALALA | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Finance,Entertainment,Shopping |
| 1585 | @exchange1980 / ربح مجانا مضمونه 💯 في 💯 | Africa | Africa | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Crypto + Finance/Trading |
| 1586 | @Totalgroup1 / The total group | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Arabic/Persian / English | Entertainment + News |
| 1587 | @ / The Nairobi Lowdown | Global | Africa | medium | Kenya (AdsGalaxy); Kenya (Telegram) | not checked | Telemetr.me: not checked; Telemetr.com: not checked | English | News |
| 1588 | @ProTvMaestros / 🧿🥇PRO TV MAESTROS 🧿📺 | Unclassified | Europe | medium | Spain (Telegram); Spain (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Spanish / French / English | Technology + Entertainment |
| 1589 | @ / 彡[ᴄᴀʀᴅᴇʀ ʜᴜʙ]彡 | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Tech,Education,Shopping |
| 1590 | @ / Tellywood | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | not checked | Telemetr.me: not checked; Telemetr.com: not checked | Unknown | Crypto,Gambling,Entertainment |
| 1591 | @nickupdates / Nick Bot Updates (Era of Bypass 2023 - 202?) | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | English | Finance/Trading + Gaming |
| 1592 | @Coderoomexe / CODEROOM \| HACKING | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Tech |
| 1593 | @breaker_bhai / Breaker_moids | Global | Global | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | English | Technology + Entertainment |
| 1594 | @ZeeBangla_hdSerialFb / Star Jalsha · Zee Bangla · Sun Bangla | Asia | Asia | low | no reliable geographic signal; existing value not independently corroborated; retained only as current value | blocked/login page | Telemetr.me: generic/login page; Telemetr.com: not found | Unknown | Entertainment |
| 1595 | @sonicupdate02 / VY NGN TASK 🟢 | Global | Africa | medium | Nigeria (AdsGalaxy); Nigeria (Telegram); Nigeria (Recent public posts) | blocked/login page | Telemetr.me: matched public channel; Telemetr.com: not found | Unknown | Finance,Crypto,Education |

### Production impact

No production channel classification or other database data was modified. No build, deployment, restart, migration, or automatic data backfill was performed.

NO BUILD, DEPLOYMENT, MIGRATION, RESTART, OR DATA BACKFILL WAS PERFORMED.

## 2026-08-29 FINAL PUBLISHER-REGION AND ANALYTICS CORRECTION (SUPERSEDING UPDATE)

This section supersedes the earlier read-only classification proposal and the earlier terminal statement above. The administrator subsequently authorized a production channel-audience data reclassification.

### Publisher channel audience rule

- Publisher add/edit/monetization inputs now expose only Africa, Asia, Europe, North America, South America, and Oceania.
- `normalizeChannelAudience` centrally rejects `global`; the publisher POST and PATCH routes already use this normalizer.
- Advertiser campaign targeting remains separate: advertiser Global is still exclusive in campaign selection and remains a wildcard across every otherwise-eligible specifically classified channel.
- Normal scheduled delivery and Emergency Push continue to call the same shared category-and-audience eligibility helper. Category matching remains required.

### Authorized live classification

- Evidence snapshot captured dynamically at `2026-08-29T10:19:55.347Z`: 481 active channels.
- Snapshot distribution before correction: Global 309, Africa 12, Asia 13, Europe 0, North America 1, South America 4, Oceania 0, Unclassified 142.
- Public evidence reviewed: AdsGalaxy channel metadata, Telegram public pages and bot metadata, TGStat responses, Telemetr.me, Telemetr.com, descriptions, recent public text, and detected language/script.
- Snapshot assignments requiring correction: 451. Confidence: 39 high, 59 medium, 353 mandatory low-confidence language/fallback assignments. Low-confidence fallback rows are recorded transparently and are not represented as externally certain.
- During the review, channel 905 was externally made inactive. The guarded transaction therefore locked and updated 450 currently active target rows, leaving the inactive row untouched.
- Transaction verification at `2026-08-29T10:49:16.121Z`: 480 active channels; Africa 90, Asia 144, Europe 45, North America 188, South America 13, Oceania 0; active Global/Unclassified/invalid count 0.
- The full before/after classification, rationale, confidence, and evidence sources are recorded in `CHANNEL_AUDIENCE_CLASSIFICATION_MANIFEST_2026-08-29.json`. The committed transaction result is in `CHANNEL_AUDIENCE_CLASSIFICATION_APPLY_RESULT_2026-08-29.json`.
- Counts were queried from live state. No previously reported fixed active or Unclassified count was used as an update input.

### Audience Analytics correction

- Region cards now represent only the six publisher-specific regional inventories.
- Today remains the current database server day.
- Seven-day and 30-day values are period totals, not divided daily averages.
- A compact overall section returns total views and clicks for today, the last seven days, and the last 30 days.
- Overall delivery combines authoritative channel totals from `channel_daily_stats` with Mini App impressions from `miniapp_daily_stats` and Mini App clicks from `ad_click_attribution` where `campaign_type = 'miniapp'`.
- The Audience Analytics `Promotion controls` / Promote AdsGalaxy button was removed. The underlying Promote AdsGalaxy feature was not deleted.

### Files changed in this correction

- `src/lib/channelAudience.ts`
- `src/lib/audienceAnalytics.ts`
- `src/app/api/admin/audience-analytics/route.ts`
- `src/app/admin/audience-analytics/page.tsx`
- `src/components/publisher/AddChannelForm.tsx`
- `src/components/publisher/AddChannelScreen.tsx`
- `tests/channel-audience-targeting.test.mjs`
- `CHANNEL_AUDIENCE_CLASSIFICATION_MANIFEST_2026-08-29.json`
- `CHANNEL_AUDIENCE_CLASSIFICATION_APPLY_RESULT_2026-08-29.json`
- `AUDIENCE_TARGETING_IMPLEMENTATION_REPORT_2026-08-28.md`

### Final validation

- Targeted audience, billing, and Emergency Push suite: 24 passed, 0 failed.
- TypeScript: `npx tsc --noEmit --incremental false --pretty false` passed with zero diagnostics.
- Targeted ESLint remains nonzero only for pre-existing `any`/unused-import findings in the publisher components and the existing test loader's `module` variable; the new lines introduced no lint diagnostics.
- No Next.js build was run.
- Source changes require a separately authorized production build/restart before the compiled Next runtime and browser UI can reflect them. Refresh alone cannot load unbuilt source changes from a `next start` runtime.

NO BUILD, DEPLOYMENT, MIGRATION, OR RESTART WAS PERFORMED. THE EXPLICITLY AUTHORIZED CHANNEL-AUDIENCE DATA RECLASSIFICATION WAS PERFORMED.

## 2026-08-29 GLOBAL ANALYTICS ROLL-UP CLARIFICATION

- Unclassified / Data quality queue is not returned or rendered by Audience Analytics.
- Global remains unavailable as a publisher channel selection.
- The Global analytics card is a computed roll-up of Africa, Asia, Europe, North America, South America, and Oceania.
- Global channels and subscribers are the sums of the six regional cards.
- Global today, last-seven-day, and last-30-day views and clicks are the sums of the corresponding regional totals.
- Global CTR is recalculated as combined clicks divided by combined views; regional CTR percentages are not averaged.
- The separate all-delivery summary continues to add Mini App views and clicks once, without double-counting the Global roll-up.

NO BUILD, DEPLOYMENT, MIGRATION, OR RESTART WAS PERFORMED IN THIS FOLLOW-UP.
