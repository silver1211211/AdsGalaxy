# Ads Galaxy Channel Recovery Audit — 2026-09-02

## Outcome

- Source deployed: **NO**
- Application restarted: **NO**
- Cron process restarted: **NO**
- Production build: **NOT RUN** — explicitly deferred by the operator.
- Full TypeScript typecheck: **NOT RUN** — explicitly deferred by the operator.
- The intentional publisher available-balance threshold remains **8.4 USDT**.
- No channel was deleted. No owner, earnings, balance, withdrawal, settlement, or financial-history row was changed.

## Controlled starting snapshot

The controlled audit began at `2026-09-02T16:17:23.741Z`. It selected all 1,480 non-deleted channels that existed at that instant. The database contained 1,514 total channel rows:

| Status | Not deleted | Deleted |
|---|---:|---:|
| active | 564 | 0 |
| bot_removed | 13 | 0 |
| channel_not_found | 727 | 0 |
| deleted | 0 | 2 |
| paused | 130 | 32 |
| pending | 5 | 0 |
| permission_missing | 31 | 0 |
| rejected | 10 | 0 |

One additional pending channel was created while the audit was running. It was not part of the fixed 1,480-row audit selection.

## Telegram verification and recovery

- Total channels checked: **1,480**
- Healthy Telegram connections observed: **683**
- Recovered to active: **74**
  - `channel_not_found` recovered by permanent chat ID: **20**
  - technical pauses recovered: **53**
  - bot removed then re-added: **1**
  - permission-restored recoveries: **0**
  - technical-rejection recoveries: **0**
- Username changes safely applied: **15**
- Title changes safely applied: **90**
- Migrated chat IDs applied: **0**
- Manual/policy rejections preserved: **24**
  - 10 already rejected at the controlled starting snapshot.
  - 14 explicit policy rejections had been overwritten into technical statuses by the legacy sync and were restored to rejected: 12 from `channel_not_found`, 1 from `bot_removed`, and 1 from `permission_missing`.
- Manual review remaining: **18**
  - duplicate permanent-ID collision blocks: **10 channel rows** across 5 duplicated IDs.
  - independent publisher/channel policy or review blocks: **8**.
- Telegram temporary results: **53**, all `Bad Request: member list is inaccessible`; these did not authorize activation or a permanent downgrade.
- Active connection issues at audit time: **36**. Current post-audit read: **33**.

The audit used stored permanent Telegram chat IDs first, one request at a time, with a 275 ms minimum request gap. Telegram 429 responses were retried only after `retry_after + 1 second`. No visible test messages or ads were sent.

## Remaining not-found inventory

At audit completion, 695 channel rows still had status `channel_not_found`. A later read after normal live processing still showed 695:

- Telegram-confirmed `channel_not_found`: **640** on the final read.
- Missing permanent identity: **43** identity rows; the channel records retain the concrete missing-chat-ID reason and were not matched or replaced by username alone.
- Temporary member-list-inaccessible result: **12**; the exact Telegram error is persisted and the prior status is preserved.

Thus every remaining `channel_not_found` row has a current concrete channel or identity reason. The “true not found” number in the final summary is the 640 rows with a current Telegram `channel_not_found` result, not the missing-ID or temporary-error rows.

## Active channel delivery diagnosis

The read-only delivery diagnosis observed 610 active channels and 4 active eligible campaign-supply rows at its snapshot. Fifty-seven active channels had no successful post in the preceding seven days:

| Diagnosis | Channels |
|---|---:|
| Recent delivery error | 26 |
| Healthy/eligible but not selected within the current slot limit | 25 |
| Telegram connection-check problem | 6 |

No active channel was marked bad merely for low delivery. The diagnosis followed current campaign supply, channel health, posts/day, inventory override, category/audience matching, advertiser ownership, exclusions, and recent delivery error state. No test ad was sent.

## Systemic defects found and source fixes

The existing `scripts/sync-channel-identities.mjs` job ran every ten minutes, selected every non-deleted channel, issued unpaced Telegram calls, ignored `retry_after`, repeatedly called `getMe`, and could overwrite rejected/manual states with technical states. Its runs generated large temporary-error counts, Telegram 429s/timeouts, and sustained production load.

Actions and source-only fixes:

- Stopped the in-progress unsafe sync and held its file lock during the controlled audit.
- Removed the unsafe sync line from the live crontab after saving a mode-600 backup at `tmp/crontab-before-channel-sync-disable-20260902`.
- The corrected sync source remains **disabled/unscheduled** until a future approved deployment.
- Limited each future sync batch to 100 by default, capped at 200.
- Added sequential request pacing, bounded retries, exact Telegram `retry_after` handling, and cached `getMe` identity.
- Added permanent-chat-ID-first verification, migration/collision guards, transactional compare-and-swap updates, and per-channel old/new audit evidence.
- Added rejection-history decisions so technical rejection can recover, policy rejection cannot auto-reactivate, and ambiguous rejection becomes manual review.
- Added admin API/UI fields for last Telegram check, exact current reason, bot membership/post permission, username history, recovered-by-ID, bot re-added, permission restored, policy rejected, technical recovery, and manual review.
- Updated `deploy-vps.sh` so a successful promoted build restarts both `AdsFusionApp` and `AdsFusionCron`. Neither was restarted during this task.

## Production data mutations performed

Exactly 1,480 channel-scoped transactions were committed. Each transaction locked the channel, verified unchanged identity/status, then wrote only:

- `channels`: operational status/health timestamps and reasons, safely verified title/username metadata, and recovery/review fields.
- `channel_telegram_identities`: current permanent identity, username history, bot membership/post permission, check timestamp, and exact failure evidence when a non-colliding permanent ID existed.
- `channel_admin_action_audits`: **1,480** `telegram_recovery_audit` rows containing old state, new state, reason, Telegram evidence, and timestamp.

Status transitions during the controlled audit:

| Transition | Count |
|---|---:|
| channel_not_found → active | 20 |
| paused → active | 53 |
| bot_removed → active | 1 |
| channel_not_found → rejected | 12 |
| bot_removed → rejected | 1 |
| permission_missing → rejected | 1 |

All other rows retained their status while receiving current audit/identity evidence. No inserts into `channels` occurred, duplicate identity collisions were blocked, channel IDs and owners were preserved, and no financial table appears in the mutation write set.

## Post-audit status snapshot

Normal live channel processing continued after the controlled audit. The latest read contained 1,515 total rows / 1,481 non-deleted rows:

| Status | Not deleted | Deleted |
|---|---:|---:|
| active | 610 | 0 |
| bot_removed | 11 | 0 |
| channel_not_found | 695 | 0 |
| deleted | 0 | 2 |
| paused | 105 | 32 |
| pending | 6 | 0 |
| permission_missing | 30 | 0 |
| rejected | 24 | 0 |

## Validation

- New recovery-policy tests run locally before the operator’s final “code only” instruction: **12 passed, 0 failed**.
- Coverage includes username change by stable ID, recovery by permanent ID, bot re-add, permission restoration, technical rejection recovery, policy rejection preservation, ambiguous/manual review, healthy active preservation, disconnected active non-recovery, collision prevention, Telegram 429 delay, and no financial-table writes.
- A source assertion for cached `getMe` and normal-health `retry_after` handling was added after that run and was not re-run per the instruction to stop after coding.
- Full TypeScript typecheck: **NOT RUN**.
- Isolated production build: **NOT RUN**.
- Focused production lint: **NOT RUN** after the final instruction.

## Files changed

- `deploy-vps.sh`
- `scripts/channel-recovery-policy.mjs`
- `scripts/sync-channel-identities.mjs`
- `src/lib/channelLifecycle.ts`
- `src/app/api/admin/channels/route.ts`
- `src/app/admin/channels/page.tsx`
- `tests/channel-recovery-policy.test.mjs`
- `ADS_GALAXY_CHANNEL_RECOVERY_AUDIT_2026-09-02.md`

Temporary audit programs and JSON results were used outside the deployed application. The detailed result is retained at `/tmp/channel-recovery-result.json`; it contains no bot token or database password.

## Deployment state

**SOURCE DEPLOYED: NO**

The `.next` production build was not replaced, no migration was run, and neither `AdsFusionApp` nor `AdsFusionCron` was restarted.
