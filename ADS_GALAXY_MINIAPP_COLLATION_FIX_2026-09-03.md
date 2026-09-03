# Ads Galaxy Mini App request ID collation fix — 2026-09-03

## Root cause

`miniapp_mediation_requests.request_id` is `VARCHAR(64) NOT NULL` with
`utf8mb4_unicode_ci`, while `ad_click_attribution.request_id` is
`VARCHAR(100) NULL` with `utf8mb4_general_ci`. MariaDB 11.4.4 rejects direct
equality between these implicit collations with `ER_CANT_AGGREGATE_2COLLATIONS`.

## Live schema and size inspection

| Table / column | Definition | Index | Approximate live size |
| --- | --- | --- | --- |
| `miniapp_mediation_requests.request_id` | `VARCHAR(64) NOT NULL`, `utf8mb4_unicode_ci` | Unique BTREE `uniq_miniapp_mediation_request_id` | 65,107 rows; 144,375,808 data bytes; 53,542,912 index bytes |
| `ad_click_attribution.request_id` | `VARCHAR(100) NULL DEFAULT NULL`, `utf8mb4_general_ci` | Leading column of BTREE `idx_ad_click_attr_request_type_created (request_id, campaign_type, created_at)` | 9,586 rows; 4,734,976 data bytes; 7,012,352 index bytes |

The figures are InnoDB estimates from `information_schema.TABLES`, collected
before the correction.

## Correction

Migration `20260903_0125_miniapp_request_id_collation.sql` changes only the
smaller `ad_click_attribution.request_id` column collation to
`utf8mb4_unicode_ci`. It preserves the column's length, nullability, default,
and the existing composite BTREE. The migration is conditional and therefore
safe to rerun.

MariaDB reported that a collation change cannot use `ALGORITHM=INPLACE`.
The chosen `ALGORITHM=COPY, LOCK=SHARED` was first verified on a temporary
`LIKE ad_click_attribution` clone. The live table was selected because it is
about 4.7 MB / 9.6k rows, avoiding a rebuild of the roughly 144 MB mediation
table. The shared lock permits reads while preventing writes during the short
copy, protecting attribution data consistency.

No `COLLATE`, `CAST`, or `LOWER` expression was added to a join. All joins stay
as plain equality predicates so MariaDB can use the existing request-ID BTREEs.

## Other occurrences

The same `mr.request_id = ac.request_id` comparison occurs in:

- `src/lib/miniappRevenueOptimizer.ts`
- `src/lib/miniappOptimization.ts`
- `src/app/api/admin/miniapps/route.ts`

The schema-level correction covers all three occurrences.

## Scope and validation

No Dynamic CPM v2, channel, balance, settlement, referral, withdrawal, or
historical-record logic was changed. No historical rows were updated. No full
Next.js build, deployment, PM2 restart, or MariaDB restart was performed.

## Validation results

- Live migration: applied successfully in 4,075 ms; idempotent rerun completed
  in 13 ms.
- Live column verification: both request-ID columns are
  `utf8mb4_unicode_ci`.
- Live index verification: both request-ID BTREEs remain present; the
  attribution index retains all three columns in their original order.
- Live optimizer query: passed with 1,066 matching clicks for the sampled Mini
  App and completed in 61 ms. `EXPLAIN` used `idx_ad_click_campaign` for the
  filtered click rows and an `eq_ref` lookup through
  `uniq_miniapp_mediation_request_id` for the join.
- Focused tests: 3 passed, 0 failed.
- ESLint: passed for the added regression test.
- TypeScript: the low-priority project check reached its 180-second safety cap
  without emitting diagnostics, so it was not completed under the current high
  production load. No TypeScript source file was changed by this correction.
- `git diff --check`: passed for the repository excluding the pre-existing
  `.next-previous` generated artifact tree; explicit no-index whitespace checks
  also passed for all three newly added files.
