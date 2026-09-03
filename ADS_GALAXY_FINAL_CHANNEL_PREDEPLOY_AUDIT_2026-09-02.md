# AdsGalaxy final channel predeployment audit — 2026-09-02

## Outcome

Source implementation is complete and ready for the normal deployment procedure. No application build, deployment, database migration, PM2 restart/reload, cron installation, forced channel status change, or financial mutation was performed in this pass.

Live evidence was captured with read-only database queries and Telegram API checks. The snapshot below is time-bound because publishers and background workers continue to change inventory.

## 1. Audience Analytics source of truth

Final live snapshot at `2026-09-02T17:27:15.466Z`:

| Measure | Exact count |
|---|---:|
| All channel rows | 1,516 |
| Non-deleted channel rows | 1,482 |
| Active, non-deleted channels | 606 |
| Previously shown by Audience Analytics | 566 |
| Missing from old analytics total | 40 |
| Active channels with authoritative GEO | 0 |

The 40-channel discrepancy was caused by analytics silently discarding 11 channels stored as Global and 29 unclassified channels. It was not caused by an `under_review`, health, fraud, or delivery-eligibility filter. The new total is defined identically to Admin Channels: `status='active' AND is_deleted=FALSE`.

| Audience bucket | Active channels | Subscribers |
|---|---:|---:|
| Global | 11 | 113,696 |
| Africa | 129 | 870,506 |
| Asia | 192 | 487,676 |
| Europe | 52 | 258,902 |
| North America | 179 | 1,206,041 |
| South America | 14 | 183,355 |
| Oceania | 0 | 0 |
| Unknown / unclassified | 29 | 81,435 |
| **All active channels** | **606** | **3,201,611** |

Implemented behavior:

- Global is a real stored audience bucket; it is no longer a roll-up and Unknown is never converted to Global.
- `All active channels` is the roll-up across Global, the six named regions, and Unknown.
- Current, non-conflicting authoritative GEO wins when migration 0123 has created and populated `channel_geo_classifications`; otherwise the stored publisher audience is used. Missing/invalid data remains Unknown.
- The API exposes total non-deleted, active, audience-classified, authoritative-GEO, and Unknown scope counts so the UI definition is visible.
- The 20-second cache is retained, but a live inventory signature invalidates it when active status, deletion state, subscriber count, stored audience, update time, or GEO classification changes.
- Channel metrics remain sourced from `channel_daily_stats`, aggregated for today, last 7 days, and last 30 days without changing financial data.

Migration 0123 is present in `deploy-vps.sh` but has not been run, as instructed. Consequently the live authoritative-GEO count is correctly reported as 0 before deployment rather than inferred or mislabeled.

## 2. Reconciliation of the 74 recovered channels

Recovery audit baseline: 564 active before recovery + 74 recovered = 638 active. Current count from that exact baseline set is 606. The exact difference is 32 channels.

All 32 are currently `paused`; all 32 were moved by `health_monitor_paused` with `paused_reason='Critical operational health'`. None moved because of Telegram disconnection, bot removal, permission loss, not-found classification, identity sync, or an admin action.

Affected channel IDs: 15, 18, 19, 43, 64, 65, 66, 67, 68, 69, 87, 88, 89, 118, 123, 152, 153, 155, 180, 187, 207, 230, 247, 259, 269, 277, 355, 358, 431, 437, 467, 482.

Exact issue counts among those 32:

- `dangerous_trust`: 32
- `high_fraud_risk`: 32
- `recent_critical_fraud`: 7
- `low_pqi`: 4
- `stale_post_success`: 14
- Primary recorded health failure: publisher trust below 20 for 18; no recent successful post for 14

This is an audit result only. These statuses were not manually overridden.

## 3. Telegram recheck of the 33 active connection candidates

Read-only recheck completed at `2026-09-02T17:07:22.383Z`:

| Result | Count |
|---|---:|
| Candidates checked | 33 |
| Fully healthy: bot administrator with posting permission | 3 |
| Chat resolves, but member lookup is inaccessible | 30 |
| Permanent Telegram failures | 0 |
| Proven invalid active channels | 0 |

Healthy IDs: 376, 418, 462.

The remaining 30 all returned a valid current chat/title/username from `getChat`, then `getChatMember` returned `Bad Request: member list is inaccessible`. That response does not prove removal or lost posting permission, so it remains temporary/non-authoritative and no channel was paused.

| ID | Username | Classification |
|---:|---|---|
| 209 | geramedia24 | temporary: member list inaccessible |
| 222 | moviebox0o | temporary: member list inaccessible |
| 238 | damsnumerique | temporary: member list inaccessible |
| 376 | HAPPYFXTRADER | healthy |
| 418 | islamic_visions | healthy |
| 462 | moviestur | healthy |
| 981 | Aliexpress_o | temporary: member list inaccessible |
| 1022 | vttaygs | temporary: member list inaccessible |
| 1149 | freeinterneetn | temporary: member list inaccessible |
| 1281 | FANBAROJSTUDIO | temporary: member list inaccessible |
| 1416 | bdearnmoneywithme | temporary: member list inaccessible |
| 1442 | moviebox_series | temporary: member list inaccessible |
| 1565 | airdropearningzone20 | temporary: member list inaccessible |
| 1567 | digitalznomad | temporary: member list inaccessible |
| 1569 | MAFIAPNELZONE | temporary: member list inaccessible |
| 1574 | Apostolic_Fellowship | temporary: member list inaccessible |
| 1585 | exchange1980 | temporary: member list inaccessible |
| 1588 | ProTvMaestros | temporary: member list inaccessible |
| 1594 | ZeeBangla_hdSerialFb | temporary: member list inaccessible |
| 1601 | ListasGparatodos | temporary: member list inaccessible |
| 1602 | AndroMasters | temporary: member list inaccessible |
| 1603 | Creator_Minte | temporary: member list inaccessible |
| 1604 | SAIYEM_EARNING_ZONE_6T9 | temporary: member list inaccessible |
| 1617 | FRUIT_NINJAX86 | temporary: member list inaccessible |
| 1625 | Animes_In_Tamil_Dubbed | temporary: member list inaccessible |
| 1642 | EduraReal | temporary: member list inaccessible |
| 1671 | aBcrypto257 | temporary: member list inaccessible |
| 1682 | afelafkrfetan | temporary: member list inaccessible |
| 1686 | planbnettt | temporary: member list inaccessible |
| 1687 | njmflix | temporary: member list inaccessible |
| 1689 | NX_TG_WS_BUYER | temporary: member list inaccessible |
| 1692 | digital_flow_K_E | temporary: member list inaccessible |
| 1711 | Ethio_V2ray | temporary: member list inaccessible |

## 4. MTProto private-channel membership and view collection

Private activation now requires the assigned MTProto tracking account to be a verified channel member. This gate is applied before status becomes active in:

- individual Admin Channels activation;
- Admin Control Center resume;
- bulk approval;
- health-checked lifecycle reactivation.

Onboarding verifies the bot identity with `getMe`, verifies the bot is an administrator with invite permission, creates a one-use/10-minute invite, joins the configured tracking account, revokes the invite, stores the permanent channel ID assignment, and normalizes Telegram's `already_member` result to verified `member`. A failure leaves the channel pending/manual rather than active.

Private view fetching now requires `tracking_account_status='active'` and member status `member`/legacy `already_member`, then uses only that assigned account. It cannot silently fall back to a different MTProto account. Access/membership failures mark tracking failed/not-member for repair; a successful fetch canonicalizes membership to `member`.

Account 1 remains intentionally excluded while its session is unauthorized. Account 2 remains the automated onboarding account. Manual tracking usernames are returned on onboarding failure.

## 5. Corrected identity sync deployment wiring

The old production identity-sync cron remains disabled. No sync was installed or run in this pass.

The corrected sync is now wired exactly once inside the deployment-managed cron block at `3-59/10 * * * *`. Deployment removes both old managed entries and any legacy standalone `scripts/sync-channel-identities.sh` line before installing the one canonical entry. The wrapper uses the production Node 24.15.0 binary, `nice -n 15`, and a non-blocking `flock` lock.

The sync implementation retains bounded batches, pacing, retry/Telegram 429 handling, cached `getMe`, permanent chat-ID authority, technical-vs-policy rejection rules, username/title refresh, permission classification, audit logging, and no financial-table mutation.

## 6. Safety and deployment consistency

- Migration `20260902_0123_channel_safety_foundation.sql` is present in the deployment migration list.
- Deployment restarts both `AdsFusionApp` and `AdsFusionCron` only after a successful build/promotion.
- Publisher available-balance enforcement remains exactly `8.4` in `publisherTrustEnforcement.ts`.
- Fraud coverage remains active + paused non-deleted inventory, because it is a monitoring scope rather than the delivery inventory count.
- Admin Channels `active_channels` and Audience Analytics `All active channels` now use the same active/non-deleted definition.
- Audience Analytics reports actual audience inventory, including Global and Unknown; GEO distinguishes current authoritative classification from stored fallback; Fraud may intentionally include paused channels and its scope is explicitly different.

## 7. Validation performed

- Focused Node tests: **40 passed, 0 failed** (Audience Analytics/targeting, recovery policy, safety foundation, and private MTProto membership).
- Focused ESLint on all changed TypeScript/TSX source: **passed, 0 errors**.
- `bash -n` on deployment and identity-sync wrappers: **passed**.
- Scoped `git diff --check`: **passed**.
- Full TypeScript typecheck: **not run** because production load remained high (`6.64, 7.71, 8.35` at the decision point); avoiding extra production pressure was safer. No build was run.

## Deployment note

The source changes will take effect only after the operator runs the normal deployment. That procedure will apply migration 0123, build, promote, restart both PM2 processes, and install the corrected managed cron. None of those actions was performed here.

## Files changed or added for this final pass

- `deploy-vps.sh`
- `scripts/sync-channel-identities.sh`
- `src/lib/audienceAnalytics.ts`
- `src/app/api/admin/audience-analytics/route.ts`
- `src/app/admin/audience-analytics/page.tsx`
- `src/lib/telegramMtproto.ts`
- `src/lib/privateChannelTrackingOnboarding.ts`
- `src/lib/channelHealthMonitor.ts`
- `src/app/api/cron/update-views/route.ts`
- `src/lib/channelAdminViewRefresh.ts`
- `src/app/api/admin/channels/route.ts`
- `src/app/api/admin/channels/[id]/actions/route.ts`
- `src/app/api/admin/channels/bulk-approve/route.ts`
- `src/lib/channelLifecycle.ts`
- `tests/channel-audience-targeting.test.mjs`
- `tests/private-channel-mtproto-membership.test.mjs`
- `ADS_GALAXY_FINAL_CHANNEL_PREDEPLOY_AUDIT_2026-09-02.md`

The corrected `scripts/sync-channel-identities.mjs`, recovery-policy tests, safety migration/tests, and app+cron restart wiring were already present from the preceding recovery/safety implementation and were re-audited here.

## Remaining issues / operator actions

- Run the normal deployment when ready; until then, the currently running app still serves the previous build.
- Migration 0123 is not yet applied, so live authoritative GEO remains 0 and stored audience fallback is the only currently available classification.
- The corrected identity sync cron count remains 0 until deployment installs the managed block.
- MTProto account 1 still needs separate Telegram session reauthorization; automated private onboarding intentionally uses account 2 meanwhile.
- The 30 member-list-inaccessible channels are not proven disconnected. They should remain active unless a future authoritative Telegram result proves a permanent failure.
- Full TypeScript typecheck remains to be run during a lower-load maintenance window or the normal deployment pipeline.
