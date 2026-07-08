# Channel Campaign Lifecycle

Channel campaign operations are intentionally separate so delivery control, financial settlement, and Telegram cleanup do not happen as accidental side effects.

## Actions

| Action | Delivery | Telegram stats | Settlement | Telegram cleanup | Final campaign state |
| --- | --- | --- | --- | --- | --- |
| Pause Only (`pause_only`) | Stops future delivery immediately | No | No | No | `paused` |
| Legacy Pause (`pause`) | Stops future delivery immediately | One final refresh | Yes, deltas only | Attempted after settlement | `paused` |
| Pause + Finalize | Stops future delivery immediately | One final refresh | Yes, deltas only | Attempted after settlement | `paused` |
| Resume | Restarts delivery | No | No | No | `active` |
| Delete | Pause + Finalize first, then archive/delete | One final refresh | Yes, before delete | Attempted after settlement | `deleted` |
| Retry Telegram Cleanup | No delivery change | No | No | Retry only | unchanged |

## Admin Operations

Phase 2 adds admin-only operations that do not change campaign lifecycle status by themselves:

| Operation | Action | Behavior |
| --- | --- | --- |
| Force Refresh Statistics | `force_refresh_stats` | Refreshes Telegram view totals for eligible campaign posts with monotonic writes. If `campaign_posts.clicks` exists, stored click totals are synced from `campaign_clicks`. No settlement runs. |
| Force Settlement | `force_settlement` | Runs the existing channel settlement engine for the campaign using current database values only. No Telegram fetch runs. |
| Refresh + Settle | `refresh_and_settle` | Runs Force Refresh Statistics first, then Force Settlement. Partial refresh failures are returned, and settlement uses available database totals. |
| Retry Failed Cleanup | `retry_cleanup` | Retries failed Telegram cleanup only. No financial writes. |

Visibility endpoints:

- `GET /api/admin/campaigns/:id/settlement-summary`
- `GET /api/admin/campaigns/:id/delivery-status`
- `GET /api/admin/campaigns/:id/cleanup-errors`

## Financial Rules

- Pause Only does not change financial records. Existing live posts continue through the normal statistics, fast billing, settlement, and lifetime cleanup jobs.
- Finalization reuses the existing channel settlement engine and its row locks.
- Views are refreshed with monotonic `GREATEST(existing_views, fetched_views)` updates.
- Click settlement continues to count rows from `campaign_clicks`.
- Settlement calculates only deltas: `views - settled_views` or recorded clicks minus `settled_clicks`.
- Publisher credits, advertiser debits, campaign spend, remaining budget, and ledgers are updated in the existing settlement transaction.
- Pending fast-debit publisher credits are settled for the campaign during finalization before post cleanup.
- `channel_settlement_finalized_at` is set only after settlement reports no failed or outstanding posts.
- Force Settlement uses `settleChannelCampaigns` and does not manually update balances, campaign budget, publisher earnings, settled counters, or ledgers.

## Cleanup Rules

- Telegram cleanup runs after settlement for Pause + Finalize and Delete.
- Cleanup failures do not rollback settlement.
- Each post stores `cleanup_status`, `cleanup_attempted_at`, `cleanup_completed_at`, `cleanup_error`, and `cleanup_retry_count`.
- Cleanup states are `pending`, `success`, `failed`, and `retry`.
- Non-fatal Telegram errors are logged and do not fail settlement: `CHAT_NOT_FOUND`, `CHANNEL_INVALID`, `MESSAGE_NOT_FOUND`, `MESSAGE_ID_INVALID`, `MESSAGE_CANT_BE_DELETED`, `PEER_ID_INVALID`, `BOT_REMOVED`, `BOT_IS_NOT_MEMBER`, `CHAT_ADMIN_REQUIRED`, `403_FORBIDDEN`, and Telegram `400 Message Not Found`.
- Retryable Telegram errors, such as rate limits or temporary network/API failures, are marked `retry`.
- Retry Telegram Cleanup only attempts deletion again. It does not refresh stats or change financial records.
- `/api/admin/campaigns/:id/cleanup/retry` retries cleanup for one campaign.
- `/api/cron/retry-telegram-cleanup` retries pending retry/delete-failed cleanup rows platform-wide.

## Backward Compatibility

- The existing admin action endpoint remains `/api/admin/campaigns/:id/actions`.
- Existing `pause`, `resume`, and `delete` actions are still accepted.
- `pause` remains backward-compatible with the older finalize behavior.
- New actions are `pause_only`, `pause_finalize`, and `retry_cleanup`.
- Campaign `status` values are preserved; archive is recorded with `archived_at` before delete.
