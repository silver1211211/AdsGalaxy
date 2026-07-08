# COMPLETE FINANCIAL SCHEMA AND DATA FLOW AUDIT
# AdsGalaxy Channel Campaign System

**Date**: 2026-07-08  
**Scope**: Channel Campaign financial architecture only  
**Status**: Audit in progress - Comprehensive documentation

---

# PART 1: FINANCIAL DATA INVENTORY

## 1.1 ADVERTISER FINANCIAL FIELDS

### campaigns table

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `budget` | DECIMAL(18,8) | Remaining budget for campaign delivery | USD | $0.00000001 | NO | 0 | Settlement, Admin edit | Placement, Settlement |
| `total_budget` | DECIMAL(18,8) | Immutable lifetime budget (sum of original + spend) | USD | $0.00000001 | NO | 0 | Migration/backfill | Audit, Rebuild |
| `cpm` | DECIMAL(18,8) | Cost per 1000 views/clicks for this campaign | USD | $0.00000001 | YES | NULL | Campaign creation | Placement, Settlement, Billing |
| `daily_budget_limit` | DECIMAL(18,8) | Maximum spend per calendar day | USD | $0.00000001 | YES | NULL | Campaign creation | Placement check, Settlement |
| `channel_spend` | DECIMAL(18,8) | Cumulative amount debited from advertiser for channel posts | USD | $0.00000001 | NO | 0 | Settlement ledger insert | Rebuild, Audit |
| `channel_publisher_earnings` | DECIMAL(18,8) | Total amount credited to publishers for this campaign | USD | $0.00000001 | NO | 0 | Settlement ledger insert | Audit, Publisher payment |
| `channel_platform_revenue` | DECIMAL(18,8) | Platform margin amount (40% of channel_spend) | USD | $0.00000001 | NO | 0 | Settlement ledger insert | Audit, Revenue tracking |
| `channel_reserve_amount` | DECIMAL(18,8) | Safety reserve held (10% of channel_spend) | USD | $0.00000001 | NO | 0 | Settlement ledger insert | Audit, Safety check |
| `status` | ENUM | Campaign lifecycle state: pending, active, paused, budget_exhausted, deleted, rejected, completed | N/A | N/A | NO | 'pending' | Admin, System | Placement filter, Delivery |
| `user_id` | INT | Foreign key to advertiser user | N/A | N/A | NO | N/A | Campaign creation | Ownership check |

### campaigns related to users table

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `ad_balance` | DECIMAL(18,8) | Advertiser's prepaid balance available for campaigns | USD | $0.00000001 | NO | 0 | Payment gateway webhook | Campaign creation, Resume validation |
| `advertiser_trust_level` | VARCHAR(20) | Trust classification: new, standard, premium, restricted | N/A | N/A | NO | 'new' | Trust system | Placement filter, Delivery scoring |
| `advertiser_risk_score` | INT | Risk classification score 0-100 | Score | 0-100 | YES | NULL | Revenue protection cron | Ad serving gate, Campaign creation |
| `quality_score` | INT | Campaign quality baseline for this advertiser | Score | 0-100 | NO | 50 | Quality engine | Placement scoring |

---

## 1.2 PUBLISHER FINANCIAL FIELDS

### users table (publisher-owned fields)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `balance_locked` | DECIMAL(18,8) | Publisher earnings locked pending settlement | USD | $0.00000001 | NO | 0 | `creditUserLockedBalance()` | Withdrawal, Settlement |
| `balance_available` | DECIMAL(18,8) | Publisher earnings available to withdraw | USD | $0.00000001 | NO | 0 | `creditUserAvailableBalance()`, `unlockUserBalance()` | Withdrawal, Balance display |
| `ad_balance` | DECIMAL(18,8) | (Publisher context) Available balance if also advertiser | USD | $0.00000001 | NO | 0 | Payment gateway | Resume validation (dual-role) |
| `publisher_risk_score` | INT | Risk assessment score 0-100 | Score | 0-100 | YES | NULL | Revenue protection cron | Publisher quality calculation |
| `is_banned` | TINYINT | Soft ban flag for fraud/abuse | Boolean | 0 or 1 | YES | 0 | Admin system | Settlement eligibility, Quality calc |
| `status` | ENUM | Account status: active, suspended, banned, etc. | N/A | N/A | NO | 'active' | Admin, KYC system | Settlement eligibility |

### channels table (publisher's channel)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `user_id` | INT | FK to publisher user who owns this channel | N/A | N/A | NO | N/A | Channel creation | Settlement crediting |
| `traffic_quality_score` | INT | Channel traffic quality assessment 0-100 | Score | 0-100 | NO | 60 | Fraud detection cron | Quality weight calc, Delivery filter |
| `publisher_trust_score` | INT | Publisher trust for this channel -100 to 100 | Score | -100-100 | YES | NULL | Fraud detection cron | Quality weight calc |
| `channel_fraud_risk_score` | INT | Fraud risk assessment 0-100 | Score | 0-100 | YES | NULL | Fraud detection cron | Channel health, Settlement skip |
| `subscriber_count` | INT | Telegram channel subscriber count | Count | 0-999M | YES | NULL | Admin refresh | Quality weight calc |
| `is_banned` | TINYINT | Soft ban flag for repeated issues | Boolean | 0 or 1 | YES | 0 | Admin system | Settlement eligibility |

### channel_daily_stats table (publisher earnings aggregate)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `view_earnings` | DECIMAL(18,8) | Publisher revenue from views this day | USD | $0.00000001 | NO | 0 | Settlement aggregate | Publisher dashboard, Withdrawal |
| `click_earnings` | DECIMAL(18,8) | Publisher revenue from clicks this day | USD | $0.00000001 | NO | 0 | Settlement aggregate | Publisher dashboard, Withdrawal |
| `view_spend` | DECIMAL(18,8) | Advertiser spend from views this day | USD | $0.00000001 | NO | 0 | Settlement aggregate | Analytics |
| `click_spend` | DECIMAL(18,8) | Advertiser spend from clicks this day | USD | $0.00000001 | NO | 0 | Settlement aggregate | Analytics |
| `spend` | DECIMAL(18,8) | Total spend (views + clicks) this day | USD | $0.00000001 | NO | 0 | Settlement aggregate | Analytics |

---

## 1.3 CAMPAIGN POST FINANCIAL FIELDS

### campaign_posts table

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `views` | BIGINT UNSIGNED | Current view count for this post | Count | 0-2^64 | YES | 0 | View fetch cron (`update-views`) | Settlement, Publisher quality, Liability calc |
| `settled_views` | BIGINT UNSIGNED | Views already debited/settled | Count | 0-2^64 | YES | 0 | Settlement process | Delta calc, Liability calc |
| `settled_clicks` | BIGINT UNSIGNED | Clicks already debited/settled | Count | 0-2^64 | YES | 0 | Settlement process | Delta calc, Liability calc |
| `spend` | DECIMAL(18,8) | Total advertiser debit from this post | USD | $0.00000001 | NO | 0 | Settlement insert | Post analytics |
| `publisher_earnings` | DECIMAL(18,8) | Total publisher credit from this post | USD | $0.00000001 | NO | 0 | Settlement insert | Publisher payment, Analytics |
| `platform_revenue` | DECIMAL(18,8) | Platform margin from this post (40%) | USD | $0.00000001 | NO | 0 | Settlement insert | Analytics |
| `reserve_amount` | DECIMAL(18,8) | Safety reserve from this post | USD | $0.00000001 | NO | 0 | Settlement insert | Audit |
| `campaign_id` | INT | FK to campaign | N/A | N/A | NO | N/A | Post creation | Settlement, Ownership |
| `channel_id` | INT | FK to channel (publisher) | N/A | N/A | NO | N/A | Post creation | Settlement, Ownership |

---

## 1.4 SETTLEMENT FINANCIAL FIELDS

### channel_settlement_ledger table (immutable audit log)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `settlement_type` | ENUM | 'view' or 'click' | N/A | N/A | NO | N/A | Settlement process | Rebuild, Audit |
| `old_settled_count` | INT UNSIGNED | Previous settled views/clicks | Count | 0-2^32 | NO | 0 | Settlement process | Audit |
| `new_units` | INT UNSIGNED | Units being settled in this record | Count | 0-2^32 | NO | 0 | Settlement process | Audit |
| `settled_through` | INT UNSIGNED | New total settled_views/clicks after this settlement | Count | 0-2^32 | NO | 0 | Settlement process | Audit |
| `advertiser_debit` | DECIMAL(18,8) | Amount debited from advertiser (units * unit_price) | USD | $0.00000001 | NO | 0 | Settlement process | Rebuild, Campaign verify |
| `publisher_credit` | DECIMAL(18,8) | Amount credited to publisher AFTER quality weight | USD | $0.00000001 | NO | 0 | Settlement process | Rebuild, Publisher verify |
| `platform_revenue` | DECIMAL(18,8) | Platform margin (debit * 40%) | USD | $0.00000001 | NO | 0 | Settlement process | Revenue tracking |
| `reserve_amount` | DECIMAL(18,8) | Safety reserve (pool * 10%) | USD | $0.00000001 | NO | 0 | Settlement process | Audit |
| `publisher_pool_before_reserve` | DECIMAL(18,8) | Publisher amount before reserve (debit * 60%) | USD | $0.00000001 | NO | 0 | Settlement process | Audit |
| `platform_margin_percent` | DECIMAL(7,4) | Platform margin % used (typically 40) | Percent | 0.0000-100.0000 | NO | 40 | Settlement process | Audit, Verify |
| `safety_reserve_percent` | DECIMAL(7,4) | Safety reserve % used (typically 10) | Percent | 0.0000-100.0000 | NO | 10 | Settlement process | Audit, Verify |
| `publisher_quality_score` | INT | Channel quality score 0-100 at settlement time | Score | 0-100 | NO | 0 | Settlement process | Audit |
| `publisher_quality_weight` | DECIMAL(10,8) | Quality weight multiplier (0.0-1.0) | Multiplier | 0.00000000-1.00000000 | NO | 0 | Settlement process | Verify quality calc |
| `quality_holdback` | DECIMAL(18,8) | Amount held back due to quality weight (1.0 - quality_weight) * publisher_credit | USD | $0.00000001 | NO | 0 | Settlement process | Fraud investigation |
| `effective_publisher_cpm` | DECIMAL(18,8) | Effective CPM publisher received (publisher_credit/units*1000) | USD | $0.00000001 | NO | 0 | Settlement process | Analytics |
| `effective_publisher_cpc` | DECIMAL(18,8) | Effective CPC publisher received (publisher_credit/units) | USD | $0.00000001 | NO | 0 | Settlement process | Analytics |
| `remaining_budget` | DECIMAL(18,8) | Campaign budget remaining AFTER this settlement | USD | $0.00000001 | NO | 0 | Settlement process | Audit |
| `exhausted` | TINYINT | Flag if campaign became budget_exhausted after this settlement | Boolean | 0 or 1 | NO | 0 | Settlement process | Campaign lifecycle |
| `campaign_id` | INT | FK to campaign | N/A | N/A | NO | N/A | Settlement process | Rebuild, Ownership |
| `post_id` | INT | FK to campaign_posts | N/A | N/A | NO | N/A | Settlement process | Rebuild, Ownership |
| `channel_id` | INT | FK to channels | N/A | N/A | NO | N/A | Settlement process | Rebuild, Ownership |
| `publisher_id` | INT | FK to users (publisher) | N/A | N/A | NO | N/A | Settlement process | Rebuild, Crediting |
| `created_at` | DATETIME | When this settlement was recorded | Timestamp | YYYY-MM-DD HH:mm:ss | NO | CURRENT_TIMESTAMP | Settlement process | Audit, Time-series |

### ad_settlements_views table (denormalized copy of ledger for views)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `post_id` | INT | FK to campaign_posts | N/A | N/A | NO | N/A | Settlement process | Rebuild |
| `campaign_id` | INT | FK to campaigns | N/A | N/A | NO | N/A | Settlement process | Rebuild |
| `advertiser_id` | INT | FK to users (advertiser) | N/A | N/A | NO | N/A | Settlement process | Rebuild |
| `channel_id` | INT | FK to channels | N/A | N/A | NO | N/A | Settlement process | Rebuild |
| `publisher_id` | INT | FK to users (publisher) | N/A | N/A | NO | N/A | Settlement process | Rebuild |
| `views_count` | INT UNSIGNED | Views settled in this record | Count | 0-2^32 | NO | 0 | Settlement process | Rebuild |
| `advertiser_paid` | DECIMAL(18,8) | Advertiser debit amount | USD | $0.00000001 | NO | 0 | Settlement process | Rebuild, Verify |
| `publisher_reward` | DECIMAL(18,8) | Publisher credit amount after quality | USD | $0.00000001 | NO | 0 | Settlement process | Rebuild, Verify |
| `status` | ENUM | Settlement status: locked, settled, disputed | N/A | N/A | NO | 'locked' | Settlement process | Settlement, Dispute |

### ad_settlements table (click settlements, same structure as views)

(Same columns as ad_settlements_views but for clicks)

| Column | Type | Meaning | Units | Precision |
|--------|------|---------|-------|-----------|
| `clicks_count` | INT UNSIGNED | Clicks settled | Count | 0-2^32 |

---

## 1.5 FAST DEBIT FINANCIAL FIELDS

### channel_advertiser_debits table (fast-path settlement, immutable)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `source_key` | VARCHAR(160) UNIQUE | Deduplication key: "view:{postId}:{views}" or "click:{clickId}" | N/A | N/A | NO | N/A | Fast debit | Duplicate check |
| `settlement_type` | ENUM | 'view' or 'click' | N/A | N/A | NO | N/A | Fast debit | Settlement type |
| `units` | BIGINT UNSIGNED | Number of views/clicks debited | Count | 0-2^64 | NO | 0 | Fast debit | Rebuild |
| `unit_price` | DECIMAL(18,8) | CPM/CPC used for this debit (cpm/1000 or cpc) | USD | $0.00000001 | NO | 0 | Fast debit | Rebuild, Verify |
| `advertiser_debit` | DECIMAL(18,8) | Amount debited from advertiser (units * unit_price) | USD | $0.00000001 | NO | 0 | Fast debit | Rebuild, Campaign verify |
| `publisher_status` | ENUM | Settlement status: pending (awaiting settlement), settled | N/A | N/A | NO | 'pending' | Fast debit, Settlement cron | Settlement eligibility |
| `publisher_credit` | DECIMAL(18,8) | Amount credited to publisher AFTER settlement | USD | $0.00000001 | NO | 0 | Settlement cron | Rebuild, Publisher verify |
| `created_at` | DATETIME | When fast debit was created | Timestamp | YYYY-MM-DD HH:mm:ss | NO | CURRENT_TIMESTAMP | Fast debit | Time-series |
| `publisher_settled_at` | DATETIME | When publisher was credited | Timestamp | YYYY-MM-DD HH:mm:ss | YES | NULL | Settlement cron | Audit, Settlement time |
| `campaign_id` | INT | FK to campaigns | N/A | N/A | NO | N/A | Fast debit | Rebuild, Ownership |
| `post_id` | INT | FK to campaign_posts | N/A | N/A | NO | N/A | Fast debit | Rebuild, Ownership |
| `channel_id` | INT | FK to channels | N/A | N/A | NO | N/A | Fast debit | Rebuild, Ownership |
| `publisher_id` | INT | FK to users (publisher) | N/A | N/A | NO | N/A | Fast debit | Rebuild, Crediting |

---

## 1.6 QUALITY & SAFETY FIELDS

### channels table (quality fields)

| Column | Type | Meaning | Units | Precision | Nullable | Default | Writer | Reader |
|--------|------|---------|-------|-----------|----------|---------|--------|--------|
| `traffic_quality_score` | INT | Traffic quality 0-100 | Score | 0-100 | NO | 60 | Fraud detection cron | Quality weight |
| `publisher_trust_score` | INT | Publisher trust -100 to 100 | Score | -100-100 | YES | NULL | Fraud detection cron | Quality weight |
| `channel_fraud_risk_score` | INT | Fraud risk 0-100 | Score | 0-100 | YES | NULL | Fraud detection cron | Settlement skip |

### channel_settlement_ledger (quality fields)

| Column | Type | Meaning | Units | Precision | Nullable | Default |
|--------|------|---------|-------|-----------|----------|---------|
| `publisher_quality_score` | INT | Channel quality 0-100 at settlement | Score | 0-100 | NO | 0 |
| `publisher_quality_weight` | DECIMAL(10,8) | Quality multiplier 0.0-1.0 | Multiplier | 0.00000000-1.00000000 | NO | 0 |
| `quality_holdback` | DECIMAL(18,8) | Amount reduced due to quality | USD | $0.00000001 | NO | 0 |

---

## 1.7 PAYOUT SAFETY FIELDS

### payout_safety_checks table (immutable audit log)

| Column | Type | Meaning | Units | Precision | Nullable | Default |
|--------|------|---------|-------|-----------|----------|---------|
| `settlement_type` | ENUM | 'view' or 'click' | N/A | N/A | NO | N/A |
| `campaign_id` | INT | FK to campaigns | N/A | N/A | YES | NULL |
| `publisher_id` | INT | FK to users (publisher) | N/A | N/A | YES | NULL |
| `advertiser_paid` | DECIMAL(18,8) | Advertiser debit amount | USD | $0.00000001 | NO | 0 |
| `publisher_share` | DECIMAL(18,8) | Actual publisher credit | USD | $0.00000001 | NO | 0 |
| `platform_share` | DECIMAL(18,8) | Actual platform margin | USD | $0.00000001 | NO | 0 |
| `reserve_share` | DECIMAL(18,8) | Actual safety reserve | USD | $0.00000001 | NO | 0 |
| `expected_publisher_share` | DECIMAL(18,8) | Expected publisher credit | USD | $0.00000001 | NO | 0 |
| `expected_platform_share` | DECIMAL(18,8) | Expected platform margin | USD | $0.00000001 | NO | 0 |
| `expected_reserve_share` | DECIMAL(18,8) | Expected safety reserve | USD | $0.00000001 | NO | 0 |
| `status` | ENUM | 'passed' or 'blocked' | N/A | N/A | NO | N/A |
| `reason` | TEXT | Why check failed | N/A | N/A | YES | NULL |
| `created_at` | DATETIME | When check was performed | Timestamp | YYYY-MM-DD HH:mm:ss | NO | CURRENT_TIMESTAMP |

---

## 1.8 GLOBAL FINANCIAL SETTINGS

### settings table (configuration)

| `key` | Type | Value | Meaning | Units | Writer | Reader |
|-------|------|-------|---------|-------|--------|--------|
| `platform_margin_percent` | VARCHAR | '40' | Platform retains this % of advertiser debit | Percent | Admin | Settlement |
| `safety_reserve_percent` | VARCHAR | '10' | Safety reserve % of publisher pool | Percent | Admin | Settlement |

---

# PART 2: OWNERSHIP (WHO WRITES WHAT)

## 2.1 ADVERTISER BUDGET

### campaigns.budget

**Authoritative Source**: Advertiser's remaining budget for campaign

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:349-350)
   - Called by: settlement cron, admin pause/delete
   - Decrements by: advertiser_debit
   - Increments by: None
   - Frequency: Per post settlement
   
2. `fastDebit()` (channelFastBilling.ts:54-55)
   - Called by: View/click tracking APIs
   - Decrements by: advertiser_debit
   - Frequency: Immediate on view/click
   
3. `markCampaignBudgetExhausted()` (campaignLifecycle.ts:96-104)
   - Called by: Settlement when budget <= 0
   - Sets budget to: 0
   - Frequency: Once per campaign

4. Admin campaign update API
   - Direct budget edits (future tool)
   - Not yet implemented

**Readers**:
- Placement eligibility check (process-ads:350)
- Liability calculation (process-ads:292-319)
- Resume campaign validation (actions:137-138)
- Campaign detail queries (multiple routes)

**Integrity Risk**: YES - Multiple independent writers can decrement simultaneously without coordination

---

### campaigns.total_budget

**Authoritative Source**: Immutable sum of original budget + all spend

**Writers**:
1. Migration backfill (phase_6b:14-25)
   - One-time write
   - Calculated as: remaining_budget + SUM(advertiser_debit)
   
2. Campaign creation (advertiser API)
   - Set to initial budget value

**Readers**:
- Audit, Rebuild calculations
- Historical analysis

**Property**: Immutable after initial set

---

### campaigns.daily_budget_limit

**Authoritative Source**: Campaign-level daily cap

**Writers**:
1. Campaign creation only

**Readers**:
- Placement check (process-ads:278-283)
- Fast debit check (channelFastBilling:42-43)
- Settlement check (channelSettlement:280-284)

**Frequency**: Once per placement attempt, multiple times per settlement

---

## 2.2 ADVERTISER SPENDING

### campaigns.channel_spend

**Authoritative Source**: DERIVED - Sum of all channel_settlement_ledger.advertiser_debit for this campaign

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:348)
   - Updates via: channel_spend = channel_spend + ?
   - Called by: Settlement cron, admin pause/delete
   
2. Migration backfill (no direct writer)

**Readers**:
- Liability calculation
- Campaign analytics
- Publisher payment verification

**Rebuild Rule**: 
```
SELECT SUM(advertiser_debit) FROM channel_settlement_ledger WHERE campaign_id = ?
```

---

### campaigns.channel_publisher_earnings

**Authoritative Source**: DERIVED - Sum of all channel_settlement_ledger.publisher_credit

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:348)

**Readers**:
- Publisher payment verification
- Campaign profitability analysis

**Rebuild Rule**:
```
SELECT SUM(publisher_credit) FROM channel_settlement_ledger WHERE campaign_id = ?
```

---

### campaigns.channel_platform_revenue

**Authoritative Source**: DERIVED - Sum of all channel_settlement_ledger.platform_revenue

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:348)

**Readers**:
- Platform revenue reporting
- Financial reconciliation

**Rebuild Rule**:
```
SELECT SUM(platform_revenue) FROM channel_settlement_ledger WHERE campaign_id = ?
```

---

### campaigns.channel_reserve_amount

**Authoritative Source**: DERIVED - Sum of all channel_settlement_ledger.reserve_amount

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:348)

**Readers**:
- Reserve tracking
- Financial reconciliation

**Rebuild Rule**:
```
SELECT SUM(reserve_amount) FROM channel_settlement_ledger WHERE campaign_id = ?
```

---

## 2.3 CAMPAIGN_POSTS FINANCIAL

### campaign_posts.views

**Authoritative Source**: External truth = Telegram view count (but we cache it here)

**Writers**:
1. `update-views` cron (update-views.ts:323)
   - Called: Every 15 minutes
   - Update: `views = GREATEST(COALESCE(views, 0), ?)`
   - Ensures: Monotonically increasing
   - Frequency: ~Every 45 minutes per post

**Readers**:
- Settlement liability calculation
- Quality scoring
- Publisher dashboard
- Analytics

**Property**: Monotonically increasing (never decreases)

---

### campaign_posts.settled_views

**Authoritative Source**: Source of truth for settled views

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:390)
   - Update: `settled_views = settled_views + ?, spend = spend + ?`
   - Frequency: Per post settlement

2. `fastDebit()` (channelFastBilling.ts:64)
   - Update: `settled_views = settled_views + ?, spend = spend + ?`
   - Frequency: Immediate on view fetch

**Readers**:
- Settlement delta calculation (views - settled_views)
- Liability calculation
- Audit trail

**Rebuild Rule**:
```
SELECT SUM(new_units) FROM channel_settlement_ledger 
WHERE post_id = ? AND settlement_type = 'view'
```

---

### campaign_posts.settled_clicks

**Authoritative Source**: Source of truth for settled clicks

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:390)
2. `fastDebit()` (channelFastBilling.ts:64)

**Readers**:
- Settlement delta calculation
- Audit trail

**Rebuild Rule**:
```
SELECT SUM(new_units) FROM channel_settlement_ledger 
WHERE post_id = ? AND settlement_type = 'click'
```

---

### campaign_posts.spend

**Authoritative Source**: DERIVED - Sum of advertiser_debit from all settlements for this post

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:390)
   - Update: `spend = spend + ?`

2. `fastDebit()` (channelFastBilling.ts:64)
   - Update: `spend = spend + ?`

**Rebuild Rule**:
```
SELECT SUM(advertiser_debit) FROM channel_settlement_ledger WHERE post_id = ?
UNION ALL
SELECT SUM(advertiser_debit) FROM channel_advertiser_debits WHERE post_id = ?
```

---

### campaign_posts.publisher_earnings

**Authoritative Source**: DERIVED - Sum of publisher_credit from all settlements

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:390)

2. `fastDebit()` via settlement cron (channelFastBilling.ts:134)

**Rebuild Rule**:
```
SELECT SUM(publisher_credit) FROM channel_settlement_ledger WHERE post_id = ?
UNION ALL
SELECT SUM(publisher_credit) FROM channel_advertiser_debits 
WHERE post_id = ? AND publisher_status = 'settled'
```

---

### campaign_posts.platform_revenue

**Authoritative Source**: DERIVED - Platform margin from all settlements

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:390)

**Rebuild Rule**:
```
SELECT SUM(platform_revenue) FROM channel_settlement_ledger WHERE post_id = ?
```

---

### campaign_posts.reserve_amount

**Authoritative Source**: DERIVED - Safety reserve from all settlements

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:390)

**Rebuild Rule**:
```
SELECT SUM(reserve_amount) FROM channel_settlement_ledger WHERE post_id = ?
```

---

## 2.4 PUBLISHER BALANCE FIELDS

### users.balance_locked

**Authoritative Source**: Source of truth for locked publisher earnings

**Writers**:
1. `creditUserLockedBalance()` (earnings.ts:5-11)
   - Called by: Settlement process (channelSettlement.ts:354)
   - Operation: `balance_locked = balance_locked + ?`
   - Frequency: Per post settlement
   - Amount: publisher_credit (after quality weight)

2. `unlockUserBalance()` (earnings.ts:23-29)
   - Called by: Withdrawal process
   - Operation: `balance_locked = balance_locked - ?, balance_available = balance_available + ?`
   - Frequency: On withdrawal approval
   - Amount: Withdrawal amount

**Readers**:
- Withdrawal eligibility check
- Balance display
- Audit trail

**Integrity Rule**: 
- Can only decrease via unlockUserBalance
- Can only increase via settlement crediting
- Must never go negative

---

### users.balance_available

**Authoritative Source**: Source of truth for available withdrawals

**Writers**:
1. `creditUserAvailableBalance()` (earnings.ts:14-20)
   - Called by: Broadcast settlement (settle-broadcast-publishers)
   - Operation: `balance_available = balance_available + ?`

2. `unlockUserBalance()` (earnings.ts:23-29)
   - Called by: Channel settlement (transfers from locked)
   - Operation: `balance_available = balance_available + ?`

3. Withdrawal process
   - Operation: `balance_available = balance_available - ?`

**Readers**:
- Withdrawal request validation
- Balance display

**Integrity Rule**: 
- balance_locked + balance_available = total publisher earnings
- balance_available can never exceed total earnings
- Must never go negative

---

## 2.5 PUBLISHER QUALITY

### channels.traffic_quality_score

**Authoritative Source**: Computed by fraud detection engine

**Writers**:
1. `runChannelFraudDetection()` (channelFraudDetection.ts)
   - Called by: Fraud detection cron
   - Update: `traffic_quality_score = ?`
   - Frequency: Daily or on-demand
   - Calculation: Based on traffic patterns

**Readers**:
- Publisher quality calculation
- Channel eligibility filter
- Settlement quality weight

**Property**: Can be overridden by trust freeze

---

### channels.publisher_trust_score

**Authoritative Source**: Channel-specific trust assessment

**Writers**:
1. Fraud detection cron
   - Update: `publisher_trust_score = ?`
   - Range: -100 to 100

**Readers**:
- Quality weight calculation (publisherQuality.ts:103)

---

## 2.6 SETTLEMENT LEDGER (IMMUTABLE)

### channel_settlement_ledger

**Authoritative Source**: Immutable audit log - single source of truth

**Writers**:
1. `settleChannelCampaigns()` (channelSettlement.ts:367-383)
   - INSERT INTO channel_settlement_ledger
   - Frequency: Per post settlement
   - Never updated, only inserted
   - UNIQUE constraint on (settlement_type, post_id, settled_through)

**Readers**:
- Campaign rebuild/verify
- Publisher payment verify
- Platform revenue tracking
- Audit trail
- Financial reconciliation

**Property**: Immutable and append-only

---

## 2.7 FAST DEBIT RECORDS

### channel_advertiser_debits

**Authoritative Source**: Immutable debit records

**Writers**:
1. `fastDebit()` (channelFastBilling.ts:57-62)
   - INSERT source_key, settlement_type, units, advertiser_debit
   - publisher_status = 'pending'
   - publisher_credit = 0 initially
   
2. `settlePendingChannelPublisherCredits()` (channelFastBilling.ts:135)
   - UPDATE publisher_status = 'settled', publisher_credit = ?, publisher_settled_at = NOW()
   - Frequency: Periodic settlement cron

**Readers**:
- Duplicate check via source_key lookup
- Settlement pending list
- Rebuild calculations
- Audit trail

**UNIQUE Constraint**: source_key ensures no duplicate debits

---

## 2.8 ADMIN AUDIT

### admin_action_audits

**Writers**:
1. `recordAdminActionAudit()` (campaignLifecycle.ts:56-90)
   - INSERT action, entity_type, entity_id, reason, metadata
   - Frequency: On admin pause/resume/delete

**Readers**:
- Admin action history
- Compliance audit

---

# PART 3: CANONICAL SOURCE (TRUTH CLASSIFICATION)

## 3.1 CLASSIFICATION FRAMEWORK

| Classification | Definition |
|---|---|
| **Source of Truth** | Only authoritative value; cannot be derived; audited immutably |
| **Derived** | Computed from other fields; can be rebuilt; should match source |
| **Cached** | Copy of source for performance; must stay synchronized |
| **Denormalized** | Optimized copy for read performance; can be rebuilt |
| **Temporary** | Ephemeral state; lost if system restarts; used during processing |
| **Audit Log** | Immutable historical record; append-only; never updated |
| **Computed** | Calculated on-demand; not persisted; deterministic |

---

## 3.2 FIELD CLASSIFICATION TABLE

| Field | Classification | Reason | Can Rebuild? | Dependencies |
|-------|---|---|---|---|
| `campaigns.budget` | Source of Truth | State machine; critical for delivery control | Partial | channel_settlement_ledger, channel_advertiser_debits |
| `campaigns.total_budget` | Derived | Sum of budget + spend | Yes | channel_settlement_ledger, broadcast_deliveries |
| `campaigns.cpm` | Source of Truth | Campaign parameter; never changes | N/A | Campaign creation |
| `campaigns.channel_spend` | Cached/Denormalized | Copy of ledger sum for performance | Yes | channel_settlement_ledger |
| `campaigns.channel_publisher_earnings` | Cached/Denormalized | Copy of ledger sum | Yes | channel_settlement_ledger |
| `campaigns.channel_platform_revenue` | Cached/Denormalized | Copy of ledger sum | Yes | channel_settlement_ledger |
| `campaigns.channel_reserve_amount` | Cached/Denormalized | Copy of ledger sum | Yes | channel_settlement_ledger |
| `campaign_posts.views` | Cached | Copy of Telegram count | Partial | External Telegram API |
| `campaign_posts.settled_views` | Source of Truth | Definitive settled count | Partial | channel_settlement_ledger |
| `campaign_posts.settled_clicks` | Source of Truth | Definitive settled count | Partial | channel_settlement_ledger |
| `campaign_posts.spend` | Cached/Denormalized | Sum of settlements | Yes | channel_settlement_ledger, channel_advertiser_debits |
| `campaign_posts.publisher_earnings` | Cached/Denormalized | Sum of credits | Yes | channel_settlement_ledger, channel_advertiser_debits |
| `campaign_posts.platform_revenue` | Cached/Denormalized | Sum of platform margins | Yes | channel_settlement_ledger |
| `campaign_posts.reserve_amount` | Cached/Denormalized | Sum of reserves | Yes | channel_settlement_ledger |
| `channel_settlement_ledger.*` | Audit Log | Immutable historical record | N/A | N/A |
| `channel_advertiser_debits.*` | Audit Log | Immutable debit record | N/A | N/A |
| `ad_settlements_views.*` | Denormalized | Copy of ledger entries | Yes | channel_settlement_ledger |
| `ad_settlements.*` | Denormalized | Copy of ledger entries | Yes | channel_settlement_ledger |
| `users.balance_locked` | Source of Truth | Publisher earnings state | Partial | Settlement + withdrawal records |
| `users.balance_available` | Source of Truth | Withdrawable earnings state | Partial | Settlement + withdrawal records |
| `channels.traffic_quality_score` | Source of Truth | Computed metric; stored for performance | Yes | 30-day channel_daily_stats |
| `channel_daily_stats.spend` | Denormalized | Copy for analytics performance | Yes | channel_settlement_ledger daily aggregates |
| `payout_safety_checks.*` | Audit Log | Immutable safety check record | N/A | N/A |

---

# PART 4: DEPENDENCY GRAPH

## 4.1 COMPLETE FINANCIAL FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                    ADVERTISER PREPARES                          │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
     campaigns CREATE
     ├─ budget = X (Source of Truth)
     ├─ cpm = Y (Source of Truth)
     ├─ daily_budget_limit = Z (Source of Truth)
     └─ total_budget = X (Denormalized copy)
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              CAMPAIGN BECOMES ELIGIBLE FOR DELIVERY             │
│              (status = 'active', budget > 0, etc.)              │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
    process-ads CRON
    ├─ Checks: campaigns.budget > 0? (line 350)
    ├─ Checks: daily spend < daily_budget_limit? (lines 278-283)
    ├─ Calculates: pending_liability (lines 336-339)
    │   └─ = unsettled_views*cpm/1000 + active_post_buffer
    └─ Selects eligible channels
           │
           ▼
    CAMPAIGN_POSTS INSERT (pending_delivery)
    ├─ campaign_posts.campaign_id
    ├─ campaign_posts.channel_id
    ├─ campaigns.budget (unchanged for now)
    └─ Status = 'pending_delivery'
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TELEGRAM POST DELIVERY ATTEMPT                 │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼ [Success]
    campaign_posts UPDATE
    ├─ status = 'active'
    ├─ message_id = {from Telegram}
    ├─ delivery_confirmed_at = NOW()
    └─ Telegram now has the post
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  UPDATE-VIEWS CRON (Every 15 min)               │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
    Fetch views from Telegram API
           │
           ▼
    campaign_posts.views = monotonic_max(old_views, fetched_views)
    ├─ Example: 30 → 32 (update to 32)
    ├─ Monotonic guarantee: 32 → 30 (no change, stays 32)
    └─ insert campaign_views_audit record
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│            IMMEDIATE: FAST DEBIT (debitConfirmedChannelViews)   │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
    fastDebit() TRANSACTION
    ├─ SELECT campaign_posts FOR UPDATE
    ├─ Verify: campaign.status = 'active'
    ├─ Verify: post.status = 'active'
    ├─ Calculate: units = min(views, budget/unitPrice, daily_remaining)
    ├─ debit = units * (cpm/1000)
    │
    ├─ UPDATE campaigns SET budget -= debit, channel_spend += debit
    │  [DEBIT #1: Reduces budget]
    │
    ├─ INSERT channel_advertiser_debits
    │  ├─ source_key = "view:{postId}:{views}"
    │  ├─ advertiser_debit = debit
    │  ├─ publisher_status = 'pending'
    │  └─ publisher_credit = 0 (settled later)
    │
    ├─ UPDATE campaign_posts SET settled_views += units, spend += debit
    │
    └─ [Optional] IF budget exhausted: UPDATE campaigns status='budget_exhausted'
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              SETTLEMENT CRON (channel-settlement)                │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
    FOR EACH channel_advertiser_debit WITH publisher_status='pending':
           │
           ▼
    Transaction:
    ├─ Fetch debit record
    ├─ Get publisher quality score (getPublisherQuality)
    ├─ qualityWeight = qualityScore / 100 (range 0.0-1.0)
    │
    ├─ Calculate splits:
    │  ├─ advertiserDebit = (already in debit record)
    │  ├─ platformRevenue = debit * 40%
    │  ├─ publisherPoolBefore = debit * 60%
    │  ├─ safetyReserve = publisherPool * 10%
    │  ├─ publisherCredit = (publisherPool - reserve) * qualityWeight
    │  └─ qualityHoldback = publisherCredit_before - publisherCredit_after
    │
    ├─ recordPayoutSafetyCheck()
    │  └─ Verify: actual = expected (within 0.00000001 precision)
    │
    ├─ creditUserLockedBalance(publisher_id, publisherCredit)
    │  └─ UPDATE users SET balance_locked += publisherCredit
    │
    ├─ INSERT ad_settlements_views
    │  ├─ post_id, campaign_id, publisher_id, ...
    │  ├─ views_count, advertiser_paid, publisher_reward
    │  └─ status = 'locked'
    │
    └─ UPDATE channel_advertiser_debits
       ├─ publisher_credit = publisherCredit
       ├─ publisher_status = 'settled'
       └─ publisher_settled_at = NOW()
           │
           ▼
    [Old Path] settleCampaignEngagementBeforeDeletion()
    ├─ Called: Before pause/delete
    ├─ Settles: All outstanding campaign engagement
    │
    ├─ Transaction per post:
    │  ├─ SELECT campaign_posts FOR UPDATE
    │  ├─ Validate: campaign.status = 'active'
    │  ├─ Calculate: unbilled = views - settled_views
    │  │
    │  ├─ [Debit Decision]
    │  │  ├─ IF budget = 0: Mark campaign budget_exhausted, commit, continue
    │  │  ├─ IF price invalid: Mark campaign paused, commit, continue
    │  │  ├─ IF unbilled < 1 unit: Skip
    │  │  ├─ ELSE: Proceed to settlement
    │  │
    │  ├─ recordPayoutSafetyCheck() [MUST pass or ROLLBACK]
    │  │  └─ IF blocked: Return 409, Campaign cannot pause
    │  │
    │  ├─ UPDATE campaigns
    │  │  ├─ budget -= debit
    │  │  ├─ channel_spend += debit
    │  │  ├─ channel_publisher_earnings += publisherCredit
    │  │  ├─ channel_platform_revenue += platform
    │  │  └─ channel_reserve_amount += reserve
    │  │
    │  ├─ creditUserLockedBalance(publisher_id, publisherCredit)
    │  │
    │  ├─ INSERT channel_settlement_ledger
    │  │  ├─ settlement_type = 'view' or 'click'
    │  │  ├─ campaign_id, post_id, channel_id, publisher_id
    │  │  ├─ new_units, settled_through
    │  │  ├─ advertiser_debit, publisher_credit
    │  │  ├─ platform_revenue, reserve_amount
    │  │  ├─ publisher_quality_score, publisher_quality_weight
    │  │  ├─ quality_holdback, effective_cpm/cpc
    │  │  ├─ remaining_budget
    │  │  └─ UNIQUE (settlement_type, post_id, settled_through)
    │  │
    │  ├─ INSERT ad_settlements_views
    │  │  ├─ post_id, campaign_id, advertiser_id, channel_id, publisher_id
    │  │  ├─ views_count, advertiser_paid, publisher_reward
    │  │  └─ status = 'locked'
    │  │
    │  ├─ UPDATE campaign_posts
    │  │  ├─ settled_views += units
    │  │  ├─ spend += debit
    │  │  ├─ publisher_earnings += publisherCredit
    │  │  ├─ platform_revenue += platform
    │  │  └─ reserve_amount += reserve
    │  │
    │  └─ COMMIT (or ROLLBACK on safety check failure)
    │
    └─ Return: {ok, failedPosts, failedDetails, amountDebited, publisherCredited}
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              ADMIN PAUSE CAMPAIGN (Only if ok=true)             │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
    UPDATE campaigns
    ├─ status = 'paused'
    ├─ paused_at = NOW()
    ├─ pause_reason = 'admin_paused'
    └─ resume_locked_until = NULL
           │
           ▼
    [In future] DELETE active posts from Telegram
           │
           ▼
    recordAdminActionAudit()
    └─ log: old_status=active, new_status=paused
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              PUBLISHER WITHDRAWAL                               │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
    Check: users.balance_locked > withdrawal_amount? OR users.balance_available?
           │
           ▼
    CREATE withdrawal request
    ├─ amount
    └─ status = 'pending_approval'
           │
           ▼
    ON approval:
    └─ UPDATE users
       ├─ balance_locked -= amount [if from locked]
       ├─ balance_available -= amount [if from available]
       └─ Initiate payout to bank
```

---

## 4.2 FINANCIAL VALUE PROPAGATION

```
Advertiser Budget Change
        ↓
campaigns.budget (Source of Truth)
        ↓ [Immediate debit via fastDebit or settlement]
        ├─ channel_advertiser_debits.advertiser_debit
        ├─ channel_settlement_ledger.advertiser_debit
        └─ campaign_posts.spend (accumulated)
        ↓
campaigns.channel_spend (Cached copy, should equal SUM)
        ↓
        ├─ campaigns.channel_publisher_earnings
        ├─ campaigns.channel_platform_revenue
        └─ campaigns.channel_reserve_amount
        ↓
Publisher
├─ channel_settlement_ledger.publisher_credit (before quality)
│  ↓
│  ├─ users.balance_locked (locked after settlement)
│  └─ campaign_posts.publisher_earnings
│
└─ channel_settlement_ledger.quality_holdback (quality reduction)
   ↓
   Held for safety/dispute
```

---

# PART 5: SETTLEMENT OWNERSHIP (WHAT HAPPENS ON ONE NEW VIEW)

## 5.1 Scenario: Views 100 → 101

**Trigger**: View fetch from Telegram detects new view

---

### **Step 1: View Fetch (update-views cron)**

**Function**: `GET /api/cron/update-views`

**Cron Schedule**: Every 15 minutes, 4 batch slots

**Operation**:
```
1. SELECT campaign_posts WHERE status='active' AND views < current_views
2. FOR EACH post:
   a. FETCH views from Telegram API (public or MTProto)
   b. monotonicViews = MAX(database_views, telegram_views)
   c. UPDATE campaign_posts SET views = monotonicViews
   d. INSERT campaign_views_audit (for audit trail)
```

**Database Write #1**:
```sql
UPDATE campaign_posts 
SET views = GREATEST(COALESCE(views, 0), ?)
WHERE id = ?
```

**Table**: `campaign_posts`  
**Row**: Post with old_views=100 → new_views=101  
**Transaction**: Not explicitly wrapped (each post independent)

---

### **Step 2: Fast Debit (debitConfirmedChannelViews)**

**Function**: `debitConfirmedChannelViews(postId, 101)` (called line 341 of update-views.ts)

**Operation**: Immediate settlement within same view-fetch cron run

**Transaction**: YES - beginTransaction() at channelFastBilling.ts:80

```
BEGIN TRANSACTION

1. SELECT channel_advertiser_debits WHERE source_key = "view:{postId}:101"
   → Result: EMPTY (first time)
   
2. SELECT campaign_posts FOR UPDATE
   ├─ id, campaign_id, channel_id
   ├─ views = 101, settled_views = 100
   ├─ campaign.status = 'active'
   ├─ post.status = 'active'
   └─ campaign.type = 'views'
   
3. Validate:
   ├─ unitPrice = cpm / 1000 > 0? YES
   ├─ SELECT campaign BALANCE TODAY from ledgers
   │  └─ Result: $50 spent today (limit = $100)
   ├─ Calculate affordability:
   │  ├─ unitPrice = $5 (example)
   │  ├─ currentBudget = $10 (remaining)
   │  ├─ dailyRemaining = $50 (limit - spent)
   │  ├─ affordableUnits = min($10, $50) / $5 = 10 units
   └─ Units to settle = min(1 new view, 1 unbilled, 10 affordable) = 1
   
4. Debit Calculation:
   ├─ debit = 1 * $5 = $5.00
   └─ (No quality weighting at fast-debit stage)
   
5. UPDATE campaigns SET budget = GREATEST(10 - 5, 0) = $5
   ├─ WHERE id = ? AND status = 'active' AND budget >= 5
   ├─ affectedRows = 1 ✓
   └─ [DEBIT #1]
   
6. INSERT channel_advertiser_debits
   ├─ source_key = "view:{postId}:101" [UNIQUE KEY]
   ├─ settlement_type = 'view'
   ├─ campaign_id, post_id, channel_id, publisher_id
   ├─ units = 1
   ├─ unit_price = $5.00
   ├─ advertiser_debit = $5.00
   ├─ publisher_status = 'pending' [Will be settled later]
   ├─ publisher_credit = 0 [Not yet calculated]
   └─ created_at = NOW()
   
7. UPDATE campaign_posts SET settled_views = 101, spend = spend + 5
   ├─ settled_views: 100 → 101
   └─ spend: cumulative amount
   
8. IF budget - debit <= 0:
   └─ UPDATE campaigns SET status = 'budget_exhausted'
   
COMMIT

Result: {debited: true, units: 1}
```

**Tables Modified**:
- `campaigns` (budget, channel_spend) - WRITE
- `channel_advertiser_debits` - WRITE (new row)
- `campaign_posts` (settled_views, spend) - WRITE

**Transaction Isolation**: SERIALIZABLE for this post

---

### **Step 3: Settlement Cron (settlePendingChannelPublisherCredits)**

**Function**: Cron that processes pending channel_advertiser_debits

**Frequency**: Periodic (e.g., every 10 minutes)

**Transaction**: YES - beginTransaction() at channelFastBilling.ts:92

```
FOR EACH channel_advertiser_debit WHERE publisher_status = 'pending':

BEGIN TRANSACTION

1. SELECT channel_advertiser_debits FOR UPDATE (lock row)
   └─ Result: Our row with advertiser_debit = $5.00
   
2. SELECT channels + users + stats
   ├─ publisher_risk_score
   ├─ is_banned
   ├─ traffic_quality_score
   ├─ subscriber_count
   ├─ 30-day views, clicks
   ├─ average_daily_views
   ├─ active_days
   └─ post_count
   
3. calculatePublisherQuality()
   ├─ trustScore = 100 - risk_score (assume 80)
   ├─ ctrScore = normalized_ctr (assume 70)
   ├─ viewAuthenticityScore (assume 75)
   ├─ historicalConsistencyScore (assume 65)
   ├─ audienceRetentionScore (assume 85)
   │
   ├─ Weighted:
   │  = (80 * 0.40) + (70 * 0.25) + (75 * 0.15) + (65 * 0.10) + (85 * 0.10)
   │  = 32 + 17.5 + 11.25 + 6.5 + 8.5
   │  = 75.75
   │
   └─ qualityWeight = 75.75 / 100 = 0.7575 [Range 0.0-1.0]
   
4. Calculate revenue split:
   ├─ advertiserDebit = $5.00 (from debit record)
   ├─ platformMargin% = 40 (from settings)
   ├─ safetyReserve% = 10 (from settings)
   │
   ├─ platformRevenue = $5.00 * 40% = $2.00
   ├─ publisherPoolBefore = $5.00 * 60% = $3.00
   ├─ safetyReserve = $3.00 * 10% = $0.30
   ├─ publisherPoolAfterReserve = $3.00 - $0.30 = $2.70
   ├─ publisherCredit = $2.70 * 0.7575 = $2.0453
   └─ qualityHoldback = $2.70 - $2.0453 = $0.6547
   
   Breakdown:
   ├─ Advertiser paid: $5.00
   ├─ Platform gets: $2.00
   ├─ Reserve held: $0.30
   ├─ Publisher gets: $2.0453
   ├─ Quality holdback: $0.6547 (unspent due to quality)
   └─ TOTAL: $5.00 ✓
   
5. recordPayoutSafetyCheck()
   ├─ expected_publisher = $2.0453 ✓
   ├─ expected_platform = $2.00 ✓
   ├─ expected_reserve = $0.30 ✓
   ├─ actual_total = $5.00 ✓
   └─ status = 'passed' (delta < 0.00000001)
   
   IF status != 'passed':
   └─ ROLLBACK, log error
   
6. creditUserLockedBalance(publisher_id, $2.0453)
   └─ UPDATE users SET balance_locked = balance_locked + $2.0453
   
7. INSERT ad_settlements_views
   ├─ post_id, campaign_id, advertiser_id, channel_id, publisher_id
   ├─ views_count = 1
   ├─ advertiser_paid = $5.00
   ├─ publisher_reward = $2.0453
   └─ status = 'locked'
   
8. UPDATE campaign_posts
   ├─ publisher_earnings = publisher_earnings + $2.0453
   ├─ platform_revenue = platform_revenue + $2.00
   └─ reserve_amount = reserve_amount + $0.30
   
9. UPDATE campaigns
   ├─ channel_publisher_earnings = + $2.0453
   ├─ channel_platform_revenue = + $2.00
   └─ channel_reserve_amount = + $0.30
   
10. UPDATE channel_advertiser_debits
    ├─ publisher_credit = $2.0453
    ├─ publisher_status = 'settled'
    └─ publisher_settled_at = NOW()
    
COMMIT

Result: {settled: 1, publisherCredited: $2.0453}
```

**Tables Modified**:
- `users` (balance_locked) - WRITE
- `ad_settlements_views` - WRITE (new row)
- `campaign_posts` - WRITE (earnings, platform_revenue, reserve_amount)
- `campaigns` - WRITE (channel_publisher_earnings, channel_platform_revenue, channel_reserve_amount)
- `channel_advertiser_debits` - WRITE (publisher_credit, publisher_status, settled_at)
- `payout_safety_checks` - WRITE (audit record)

---

### **Step 4: Summary of Changes for One View**

**Financial Impact**:

| Entity | Field | Before | After | Change | Writer |
|--------|-------|--------|-------|--------|--------|
| campaigns | budget | $10.00 | $5.00 | -$5.00 | fastDebit |
| campaign_posts | views | 100 | 101 | +1 | update-views cron |
| campaign_posts | settled_views | 100 | 101 | +1 | fastDebit |
| campaign_posts | spend | $95.00 | $100.00 | +$5.00 | fastDebit |
| campaign_posts | publisher_earnings | $75.00 | $77.0453 | +$2.0453 | settlement cron |
| campaign_posts | platform_revenue | $40.00 | $42.00 | +$2.00 | settlement cron |
| campaign_posts | reserve_amount | $3.00 | $3.30 | +$0.30 | settlement cron |
| campaigns | channel_spend | $95.00 | $100.00 | +$5.00 | fastDebit |
| campaigns | channel_publisher_earnings | $75.00 | $77.0453 | +$2.0453 | settlement cron |
| campaigns | channel_platform_revenue | $40.00 | $42.00 | +$2.00 | settlement cron |
| campaigns | channel_reserve_amount | $3.00 | $3.30 | +$0.30 | settlement cron |
| users | balance_locked | $100.00 | $102.0453 | +$2.0453 | settlement cron |
| channel_advertiser_debits | (new row) | - | $5.00 debit | +1 record | fastDebit |
| ad_settlements_views | (new row) | - | $2.0453 credit | +1 record | settlement cron |
| channel_settlement_ledger | (new row) | - | $5.00 debit | +1 record | [Not used in fast-path] |

---

## 5.2 Audit Logs Created

| Log Table | Records | Writer | Content |
|-----------|---------|--------|---------|
| `campaign_views_audit` | +1 | update-views cron | post_id, old_views=100, new_views=101, status='valid' |
| `payout_safety_checks` | +1 | settlement cron | advertiser_paid=$5.00, publisher_share=$2.0453, status='passed' |
| `admin_action_audits` | - | (none for automated) | - |
| `system_logs` | - | (if logged) | View fetch and settlement events |

---

# PART 6: FINANCIAL CONSISTENCY (REBUILD CAPABILITY)

## 6.1 Rebuild Matrix

| Field | Can Rebuild? | Source Query | Conditions | Loss if Rebuild |
|-------|---|---|---|---|
| `campaigns.budget` | Partial | Requires original + ledger sum | If original lost: cannot rebuild | Original budget lost |
| `campaigns.total_budget` | Yes | SUM channel_settlement_ledger.advertiser_debit + remaining budget | Ledger must be intact | None |
| `campaigns.channel_spend` | Yes | SUM channel_settlement_ledger.advertiser_debit WHERE campaign_id | Ledger must be intact | None |
| `campaigns.channel_publisher_earnings` | Yes | SUM channel_settlement_ledger.publisher_credit WHERE campaign_id | Ledger must be intact | None |
| `campaigns.channel_platform_revenue` | Yes | SUM channel_settlement_ledger.platform_revenue WHERE campaign_id | Ledger must be intact | None |
| `campaigns.channel_reserve_amount` | Yes | SUM channel_settlement_ledger.reserve_amount WHERE campaign_id | Ledger must be intact | None |
| `campaign_posts.spend` | Yes | SUM ledger + SUM fast-debit WHERE post_id | Both ledger tables must be intact | None |
| `campaign_posts.publisher_earnings` | Yes | SUM ledger + SUM fast-debit WHERE post_id AND settled | Both ledger tables must be intact | None |
| `campaign_posts.platform_revenue` | Yes | SUM ledger WHERE post_id | Ledger must be intact | None |
| `campaign_posts.reserve_amount` | Yes | SUM ledger WHERE post_id | Ledger must be intact | None |
| `users.balance_locked` | Partial | SUM settlement.publisher_credit - SUM withdrawals | Ledger + withdrawal records | Balance snapshot lost |
| `users.balance_available` | Partial | Same as locked, different table | Ledger + withdrawal records | Balance snapshot lost |
| `ad_settlements_views` | Yes | Re-INSERT from channel_settlement_ledger filtered | Ledger must be intact | None |
| `ad_settlements` | Yes | Re-INSERT from channel_settlement_ledger filtered | Ledger must be intact | None |

---

## 6.2 Integrity Checks (Can be Rebuilt)

### Campaign Budget Verification
```sql
SELECT c.id, c.budget, c.channel_spend,
  (SELECT COALESCE(SUM(advertiser_debit), 0) FROM channel_settlement_ledger 
   WHERE campaign_id = c.id) expected_spend,
  (SELECT COALESCE(SUM(advertiser_debit), 0) FROM channel_advertiser_debits 
   WHERE campaign_id = c.id AND publisher_status = 'settled') fast_debit_spend
FROM campaigns c
WHERE c.channel_spend != expected_spend OR 
      (expected_spend + fast_debit_spend) != c.channel_spend
```

If mismatch exists:
```sql
-- Rebuild campaign totals
UPDATE campaigns c
SET c.channel_spend = (
  SELECT COALESCE(SUM(advertiser_debit), 0) FROM channel_settlement_ledger 
  WHERE campaign_id = c.id
),
c.channel_publisher_earnings = (
  SELECT COALESCE(SUM(publisher_credit), 0) FROM channel_settlement_ledger 
  WHERE campaign_id = c.id
),
c.channel_platform_revenue = (
  SELECT COALESCE(SUM(platform_revenue), 0) FROM channel_settlement_ledger 
  WHERE campaign_id = c.id
),
c.channel_reserve_amount = (
  SELECT COALESCE(SUM(reserve_amount), 0) FROM channel_settlement_ledger 
  WHERE campaign_id = c.id
)
```

---

### Publisher Balance Verification
```sql
SELECT u.id, u.balance_locked, u.balance_available,
  (SELECT COALESCE(SUM(publisher_credit), 0) FROM channel_settlement_ledger
   WHERE publisher_id = u.id) + 
  (SELECT COALESCE(SUM(publisher_reward), 0) FROM ad_settlements_views
   WHERE publisher_id = u.id AND status = 'locked') +
  (SELECT COALESCE(SUM(publisher_credit), 0) FROM channel_advertiser_debits
   WHERE publisher_id = u.id AND publisher_status = 'settled') expected_total
FROM users u
WHERE (u.balance_locked + u.balance_available) != expected_total
```

---

# PART 7: MANUAL ADJUSTMENT IMPACT CHAINS

## 7.1 IF: campaigns.cpm increases

**Direct Impact Chain**:
```
Increase CPM (e.g., $3 → $5)
    ↓
campaigns.cpm (Source of Truth) [WRITE]
    ↓
IMMEDIATE:
├─ Placement scoring increases
├─ Campaign more attractive to fill inventory
└─ Future settlements use new CPM
    ↓
BUT existing posts:
├─ Views already settled with OLD CPM
├─ Cannot re-settle with new CPM (immutable ledger)
└─ Settlement ledger remains unchanged
    ↓
New posts:
├─ Use new CPM
├─ Budget remaining decreases faster (higher unit price)
└─ Daily spend limit hit sooner
```

**Affected Fields**:
- ✅ `campaigns.cpm` [Settable]
- ✅ Future settlements use new value
- ❌ Past settlements CANNOT change (immutable ledger)
- ⚠️ Budget MUST remain consistent (higher CPM burns faster)

**Required Checks**:
- None (new CPM applies forward only)

---

## 7.2 IF: campaigns.budget increases

**Direct Impact Chain**:
```
Increase Budget (e.g., $10 → $20)
    ↓
campaigns.budget (Source of Truth) [WRITE]
    ↓
IMMEDIATE:
├─ Placement becomes eligible again
├─ process-ads includes it in next run
├─ Campaign can deliver more posts
└─ Daily budget limit increases effective range
    ↓
Calculations affected:
├─ availableBudget = budget - pending_liability
├─ affordableUnits = budget / unitPrice
└─ Settlement eligibility
    ↓
Dependent fields (must update):
├─ campaigns.total_budget += difference
└─ Liability calculations recalculate
```

**Affected Fields**:
- ✅ `campaigns.budget` [Settable]
- ✅ `campaigns.total_budget` [Derived - must increment]
- ⚠️ Placement pipeline [Recalculates next run]
- ⚠️ `campaigns.channel_spend` [Ledger-based - no change needed]

**Required Checks**:
- IF budget decreased below total spent: Mark budget_exhausted
- IF budget increased: Recalculate availability for pending posts

---

## 7.3 IF: campaign_posts.views manually adjusted

**Direct Impact Chain**:
```
Increase Views (e.g., 100 → 110)
    ↓
campaign_posts.views [WRITE - DANGEROUS]
    ↓
Immediate:
├─ Delta for settlement = views - settled_views
├─ Example: 110 - 100 = 10 units (vs expected 0)
└─ Next settlement processes 10 unbilled units
    ↓
Settlement:
├─ Debits advertiser: 10 * CPM
├─ Credits publisher: 10 * CPM * quality
└─ Creates ledger records
    ↓
But: Telegram API has ground truth = 100
    └─ Next view fetch: will see 100, not 110
        └─ Monotonic max(100, 100) = 100
        └─ Reverts to 100
        └─ Delta now negative (impossible)
        └─ Cannot settle negative views
    ↓
Result: CORRUPTION
├─ Advertiser charged for 10 views that don't exist
├─ Publisher credited for 10 views that don't exist
├─ Next fetch reverts value
├─ System in inconsistent state
└─ Cannot rebuild without Telegram verification
```

**Affected Fields**:
- ❌ `campaign_posts.views` [Should NEVER be manually edited]
- ❌ `campaign_posts.settled_views` [Will create delta mismatch]
- ❌ Settlement delta [Becomes unreliable]
- ❌ Campaign spend [Inflated by non-existent views]

**Risk**: FINANCIAL FRAUD

**Mitigation**: 
- Views can ONLY be set via update-views cron
- Manual edits should raise alerts
- Require Telegram API verification before settling

---

## 7.4 IF: campaign_posts.settled_views manually adjusted

**Direct Impact Chain**:
```
Increase settled_views (e.g., 100 → 105)
    ↓
campaign_posts.settled_views [WRITE - DANGEROUS]
    ↓
Immediate:
├─ Next settlement calculates: views - settled_views
├─ Example: 100 - 105 = -5 (negative!)
└─ Settlement skips post (affable units = max(0, -5) = 0)
    ↓
But:
├─ Ledger records claim 5 units were settled
├─ Users credited for 5 non-existent views
├─ Budget already debited
└─ Cannot settle again (already settled)
    ↓
Result: CORRUPTION
├─ Publisher keeps credits for views never delivered
├─ Advertiser charged for non-existent views
├─ Campaign balance incorrect
└─ Cannot recover without rolling back all related records
```

**Affected Fields**:
- ❌ `campaign_posts.settled_views` [Must match ledger]
- ❌ Settlement integrity [Broken]
- ❌ Campaign budget [Inflated spend, deflated balance]
- ❌ Publisher balance [Inflated earnings]

**Risk**: FINANCIAL FRAUD & BUSINESS LOGIC ERROR

---

## 7.5 IF: campaigns.daily_budget_limit adjusted

**Direct Impact Chain**:
```
Increase daily_budget_limit (e.g., $50 → $100)
    ↓
campaigns.daily_budget_limit [WRITE]
    ↓
Next placement check:
├─ IF spending >= new limit: skip campaign
├─ IF spending < new limit: proceed
└─ Affects: process-ads line 278-283
    ↓
Next settlement:
├─ recalculates dailyRemaining = limit - todaySpend
├─ Affects: channelSettlement line 280-284
└─ May settle more units than before
    ↓
Effect:
├─ If limit INCREASED: More posts can deliver today
├─ If limit DECREASED: Fewer posts, may not deliver
└─ Changes campaign velocity
```

**Affected Fields**:
- ✅ `campaigns.daily_budget_limit` [Settable]
- ⚠️ Placement eligibility [Recalculates next run]
- ⚠️ Settlement units [May increase/decrease]
- ✅ No dependent field updates needed

**Required Checks**:
- IF new limit < today's spend: Campaign becomes ineligible today
- IF new limit > original budget: Capped to campaign.budget

---

## 7.6 IF: users.balance_locked manually adjusted

**Direct Impact Chain**:
```
Increase balance_locked (e.g., $100 → $150)
    ↓
users.balance_locked [WRITE]
    ↓
Publisher sees:
├─ "I have $150 locked"
├─ Can now request larger withdrawal
└─ May withdraw funds that don't exist
    ↓
But ledger says:
├─ Total settled credits = $100
├─ Publisher only earned $100
└─ $50 is phantom money
    ↓
Result: FRAUD
├─ Platform pays publisher for unearned amount
├─ Cannot recover via ledger (doesn't match)
└─ Financial loss for platform
```

**Affected Fields**:
- ❌ `users.balance_locked` [Must match settled ledger sum]
- ❌ Withdrawal eligibility [Now incorrect]
- ❌ Publisher financial statement [Fraudulent]

**Risk**: PLATFORM FINANCIAL LOSS

**Mitigation**:
- balance_locked should ONLY be updated by settlement process
- Manual adjustments require audit trail & approval
- Withdrawal must verify against ledger before payout

---

## 7.7 IF: platform_margin_percent adjusted

**Direct Impact Chain**:
```
Adjust platform_margin_percent (e.g., 40% → 50%)
    ↓
settings.platform_margin_percent [WRITE]
    ↓
Future settlements:
├─ Use NEW margin % (50%)
├─ platformRevenue = debit * 50%
├─ publisherPool = debit * 50% (reduced!)
└─ Publisher earnings DECREASE
    ↓
Past settlements:
├─ channelSettlement_ledger.platform_margin_percent = 40 (historical)
├─ platform_revenue already recorded
└─ Cannot change history
    ↓
Effect:
├─ ALL FUTURE publishers earn less
├─ May violate SLA/agreements
├─ Past publishers unaffected (historical record preserved)
└─ New margin applies only going forward
```

**Affected Fields**:
- ✅ `settings.platform_margin_percent` [Settable]
- ✅ Future settlement records include new %
- ✅ Historical records unaffected
- ⚠️ Publisher earnings PERMANENTLY REDUCED

**Risks**:
- May breach publisher contracts
- Requires publisher notification
- Quality weight and reserve% also impacted

---

# PART 8: FINANCIAL INTEGRITY RULES (INVARIANTS)

## 8.1 Invariant Rules

### Rule 1: Budget Monotonic Decrease
```
invariant: campaigns.budget can NEVER increase
            (except initial creation or admin "add funds")

Why: Budget represents remaining allowance for delivery.
     Once spent (debited), it's gone.

Violation Detection:
  SELECT c.id FROM campaigns c
  JOIN channel_settlement_ledger l ON l.campaign_id = c.id
  WHERE c.budget > {previous_budget}  -- Increased!
  AND l.created_at > {previous_check}

Enforcement:
  - UPDATE campaigns: can only decrement budget
  - No query returns "restored budget"
  - Admin "add funds" creates new budget, doesn't restore old
```

---

### Rule 2: Settled Views ≤ Total Views
```
invariant: campaign_posts.settled_views ≤ campaign_posts.views
            (At any point in time)

Why: Can't settle more views than we have.

Violation Detection:
  SELECT id FROM campaign_posts
  WHERE settled_views > views

Prevention:
  - Settlement never processes views > total
  - Monotonic view fetch ensures views only increase
  - settled_views can never exceed views
```

---

### Rule 3: Settlement Ledger Immutable
```
invariant: channel_settlement_ledger records NEVER updated
            (Only inserted, never changed)

Why: Audit trail must be tamper-proof.

Enforcement:
  - Schema: No UPDATE/DELETE allowed on ledger
  - Triggers: Reject any UPDATE/DELETE attempts
  - UNIQUE (settlement_type, post_id, settled_through):
    Prevents duplicate settlements for same post at same count
    
Rebuild:
  If somehow violated, can detect via:
  SELECT post_id, settled_through, COUNT(*) FROM channel_settlement_ledger
  GROUP BY post_id, settled_through
  HAVING COUNT(*) > 1
```

---

### Rule 4: Revenue Split Math
```
invariant: advertiser_debit = platform_revenue + publisher_pool + reserve_amount
            (Exact to 8 decimal places)

Why: Money in must equal money out.

Calculation:
  debit = 100.00
  platform = 100 * 0.40 = 40.00
  pool_before = 100 * 0.60 = 60.00
  reserve = 60 * 0.10 = 6.00
  pool_after = 60 - 6 = 54.00
  publisher_credit = 54 * quality_weight (0.0-1.0)
  
  Quality holdback = 54 * (1 - quality_weight)
  
  Total = 40 + 6 + (54 * quality_weight) + (54 * (1 - quality_weight))
        = 40 + 6 + 54 * (quality_weight + 1 - quality_weight)
        = 40 + 6 + 54 * 1
        = 40 + 6 + 54
        = 100 ✓

Enforcement:
  payout_safety_checks table:
    IF |actual_total - expected_total| > 0.00000001:
      status = 'blocked', reason = 'payout_split_mismatch'
      Settlement FAILS, ROLLBACK

Verification:
  SELECT * FROM payout_safety_checks WHERE status = 'blocked'
```

---

### Rule 5: Publisher Earnings ≤ Advertiser Debit
```
invariant: channel_settlement_ledger.publisher_credit ≤ advertiser_debit
            (Publisher never receives more than advertiser paid)

Why: Platform margin + reserve must be non-negative.

Calculation:
  publisher_credit = debit * 0.60 * (1 - 0.10) * quality_weight
                   = debit * 0.54 * quality_weight
                   ≤ debit * 0.54 (since quality_weight ≤ 1.0)
                   < debit ✓

Violation:
  SELECT * FROM channel_settlement_ledger
  WHERE publisher_credit > advertiser_debit

This should NEVER match.
```

---

### Rule 6: Campaign Spend ≤ Total Budget
```
invariant: campaigns.channel_spend ≤ campaigns.total_budget
            (Can't spend more than budget)

Why: Spend is cumulative debit, budget is cumulative allowance.

Violation:
  SELECT c.id, c.total_budget, c.channel_spend
  FROM campaigns c
  WHERE c.channel_spend > c.total_budget

Rebuild:
  campaigns.channel_spend = SUM(channel_settlement_ledger.advertiser_debit)
  campaigns.total_budget = original_budget + SUM(spend)
  
  Invariant implies:
  original_budget ≥ 0  (always true)
```

---

### Rule 7: Balance Non-Negative
```
invariant: users.balance_locked ≥ 0
            users.balance_available ≥ 0
            (Balances never negative)

Why: Can't owe negative balance (that's revenue).

Enforcement:
  creditUserLockedBalance(..., amount): amount ≥ 0
  unlockUserBalance(..., amount): only if balance_locked ≥ amount
  Withdrawal: only if balance_available ≥ amount

Violation:
  SELECT id, balance_locked, balance_available FROM users
  WHERE balance_locked < 0 OR balance_available < 0
```

---

### Rule 8: Settled Count Monotonic Increase
```
invariant: channel_settlement_ledger.settled_through is strictly increasing per post
            (settled_through_1 < settled_through_2 < settled_through_3 for same post_id)

Why: Represents cumulative count over time.
     UNIQUE (settlement_type, post_id, settled_through) prevents duplicates.

Violation:
  SELECT post_id, settlement_type, COUNT(*) as dupe_count
  FROM channel_settlement_ledger
  GROUP BY post_id, settlement_type, settled_through
  HAVING dupe_count > 1

Rebuild:
  If somehow violated, cannot be repaired without losing data.
  Requires deletion of duplicate records + audit trail.
```

---

### Rule 9: Quality Weight in Range [0.0, 1.0]
```
invariant: channel_settlement_ledger.publisher_quality_weight ∈ [0.0, 1.0]
            (Quality weight is normalized to percentage of full earnings)

Why: Quality weight multiplies publisher credit (0% to 100%).
     Outside range breaks revenue math.

Calculation:
  quality_score ∈ [0, 100]
  quality_weight = quality_score / 100 ∈ [0.0, 1.0]
  
  clamped via: clamp(quality_score / 100, 0, 1)

Violation:
  SELECT * FROM channel_settlement_ledger
  WHERE publisher_quality_weight < 0.0 
     OR publisher_quality_weight > 1.0
```

---

### Rule 10: No Duplicate Source Keys
```
invariant: channel_advertiser_debits.source_key is UNIQUE
            (No two debits with same source_key)

Why: source_key = "view:{postId}:{views}" or "click:{clickId}"
     Uniqueness prevents double-settling same event.

Enforcement:
  UNIQUE KEY (source_key)
  
  Debit insertion:
    SELECT * WHERE source_key = "view:123:50"
    IF found: return {duplicate: true}, skip debit
    ELSE: INSERT

Violation:
  SELECT source_key, COUNT(*) FROM channel_advertiser_debits
  GROUP BY source_key
  HAVING COUNT(*) > 1
```

---

# PART 9: RACE CONDITIONS & PREVENTION

## 9.1 Race Condition #1: Concurrent Settlement on Same Post

**Scenario**:
- Settlement cron process A starts settling post #100
- Settlement cron process B also starts settling post #100
- Both try to: UPDATE campaigns SET budget -= debit, settled_views += units

**Current Prevention**:
1. **Cron Lock** (cronSecurity.ts):
   ```
   lock = acquireCronLock("channel-settlement", 1800)
   if (!lock) return 409  // Another run in progress
   ```
   - Only ONE channel-settlement cron runs at a time
   - 30-minute TTL ensures timeout recovery

2. **Transaction Isolation**:
   ```
   conn.beginTransaction();
   SELECT campaign_posts FOR UPDATE  // Row-level lock
   ... settlement logic ...
   conn.commit();
   ```
   - FOR UPDATE acquires exclusive lock on post row
   - Transaction serialization prevents concurrent updates

**Outcome**: SAFE - Two cronscan't run concurrently, transactions serialize

---

## 9.2 Race Condition #2: Pause During Settlement

**Scenario**:
- Settlement process is debiting campaign
- Admin clicks "Pause" simultaneously
- Settlement has: budget=$10, pauses sets status='paused'
- Next settlement query filters: WHERE status='active'

**Current Prevention**:
1. **Campaign Lock** (process-ads:636-638):
   ```
   const [[lockedCampaign]] = await conn.query(
     "SELECT status, budget... FROM campaigns WHERE id=? FOR UPDATE"
   );
   if (lockedCampaign.status !== 'active' || ...) {
     await conn.rollback();  // Abort settlement
     continue;
   }
   ```
   - Re-check status inside transaction
   - If status changed → ROLLBACK

2. **Admin Action Lock** (actions/route.ts:66):
   ```
   lock = await acquireCronLock(`admin-campaign-action-${id}`, 600)
   ```
   - Admin pause acquires campaign-specific lock
   - Settlement doesn't acquire this lock (different granularity)
   - **GAP**: Not prevented at lock level

**Outcome**: POTENTIALLY UNSAFE
- If settlement IN PROGRESS: will commit (locked post)
- If settlement PENDING: won't start (status check)
- Window: Between status=active check and final budget update
  - Settlement might debit after pause is marked
  - But campaign status='paused' so next settlement skips it

**Mitigation**: Status re-check in transaction prevents money loss

---

## 9.3 Race Condition #3: Budget Change During Settlement

**Scenario**:
- Settlement calculates affordableUnits = budget / unitPrice
- Admin increases budget
- Settlement proceeds with old affordableUnits
- Debit happens with stale affordableUnits value

**Current Prevention**:
1. **Transaction Read**: 
   ```
   SELECT campaigns FOR UPDATE within transaction
   ```
   - Reads budget inside transaction (snapshot)
   - Changes after transaction started don't affect this settlement

2. **No Multi-Statement Gap**:
   - All budget decisions made inside single transaction
   - Admin writes can't interleave (serially consistent)

**Outcome**: SAFE - Transaction snapshot isolates from concurrent admin changes

---

## 9.4 Race Condition #4: View Count Changing During Settlement

**Scenario**:
- Settlement starts, reads views=100, settled_views=90, delta=10
- View fetch cron updates views=105 concurrently
- Settlement processes delta=10 (stale)
- Next settlement processes delta=15 (5+10) ✓ Correct

**Current Prevention**:
1. **Immutable Ledger Uniqueness**:
   ```
   UNIQUE (settlement_type, post_id, settled_through)
   settled_through = old_settled + delta
   ```
   - If views changed after settlement started:
     - Next settlement has different delta
     - UNIQUE constraint prevents re-settling same settled_through value

2. **No Distributed Lock on Views**:
   - View fetch doesn't lock views update
   - Settlement doesn't lock views check
   - But: settled_views is the authoritative settled count
   - Delta = views - settled_views (always correct)

**Outcome**: SAFE - Ledger UNIQUE constraint + settled_views tracking

---

## 9.5 Race Condition #5: Same Click Settled Twice

**Scenario**:
- Click tracking: debitChannelClick(postId, clickId=500)
- Creates source_key = "click:500"
- Two requests arrive with same clickId simultaneously
- Both try to INSERT channel_advertiser_debits

**Current Prevention**:
1. **UNIQUE source_key** (channel_advertiser_debits):
   ```
   UNIQUE KEY uniq_channel_fast_debit_source (source_key)
   ```

2. **Duplicate Check**:
   ```
   SELECT * FROM channel_advertiser_debits WHERE source_key=?
   IF found: return {duplicate: true}
   ELSE: proceed
   ```

3. **Transaction**:
   - Both requests can't insert same source_key
   - Second INSERT fails on UNIQUE constraint
   - Rolled back, returns duplicate

**Outcome**: SAFE - UNIQUE constraint + duplicate check

---

## 9.6 Race Condition #6: Daily Budget Limit Traversal

**Scenario**:
- Daily budget limit = $100
- Settlement process A calculates: dailyRemaining = $100 - $50 = $50
- Settlement process B calculates: dailyRemaining = $100 - $50 = $50
- Both debit $30
- Total spend = $110 (exceeds $100 limit!)

**Current Prevention**:
1. **Cron Lock**: Only one settlement runs at a time
   - Prevents concurrent dailyRemaining calculations

2. **Transaction Atomicity**:
   ```
   BEGIN
   SELECT today_spend = SUM(...) FROM ledger WHERE created_at >= CURDATE()
   debit = units * unitPrice
   IF today_spend + debit > dailyLimit: ROLLBACK
   ELSE: UPDATE budget
   COMMIT
   ```

**Outcome**: SAFE - Cron lock prevents concurrency

---

## 9.7 Race Condition #7: Publisher Balance Lock During Withdrawal

**Scenario**:
- Settlement: creditUserLockedBalance(pub_id, $50)
- Withdrawal: check balance_locked >= $50
- Both happen concurrently
- Withdrawal might complete, then settlement adds $50
- Withdrawal gets funds that weren't there

**Current Prevention**:
1. **Balance Non-Negativity**:
   ```
   IF balance_locked < withdrawal_amount: reject withdrawal
   ```
   - Checked before processing

2. **Withdrawal Lock**:
   - Withdrawal should acquire user row lock
   - Settlement should acquire user row lock
   - Serialized by database (transaction isolation)

**Outcome**: PROBABLY SAFE, depends on withdrawal implementation

---

# PART 10: FINAL ARCHITECTURE REPORT

## 10.1 COMPLETE FINANCIAL CALL GRAPH

```
Entry Points:
│
├─ Admin Routes
│  ├─ POST /api/admin/campaigns/{id}/actions (pause/delete/resume)
│  │  └─ settleCampaignEngagementBeforeDeletion()
│  │     └─ settleChannelCampaigns()
│  │        └─ [Settlement Loop per Post]
│  │
│  └─ (Future) POST /api/admin/financial/adjust
│     ├─ Update CPM
│     ├─ Update Budget
│     ├─ Update Views (DANGEROUS)
│     └─ Update Balances (DANGEROUS)
│
├─ Advertiser Routes
│  ├─ POST /api/advertiser/campaigns/{id} (pause/resume)
│  │  └─ settleCampaignEngagementBeforeDeletion()
│  │     └─ settleChannelCampaigns()
│  │
│  └─ PATCH /api/advertiser/campaigns/{id} (toggle)
│     └─ deleteActiveCampaignPosts()
│
├─ Crons (Background Workers)
│  │
│  ├─ process-ads (every 10 min)
│  │  ├─ Query: eligible campaigns
│  │  ├─ Query: eligible channels
│  │  ├─ FOR EACH channel:
│  │  │  └─ FOR EACH eligible campaign:
│  │  │     ├─ BEGIN TRANSACTION
│  │  │     ├─ SELECT campaigns FOR UPDATE
│  │  │     ├─ Validate budget
│  │  │     ├─ INSERT campaign_posts (status='pending_delivery')
│  │  │     └─ COMMIT
│  │  │
│  │  └─ Telegram send attempt
│  │     ├─ IF success: UPDATE campaign_posts (status='active', message_id)
│  │     └─ IF fail: UPDATE campaign_posts (status='delivery_failed')
│  │
│  ├─ update-views (every 15 min, 4 batch slots)
│  │  ├─ Query: active posts due for update
│  │  ├─ FOR EACH post:
│  │  │  ├─ Fetch views from Telegram
│  │  │  ├─ UPDATE campaign_posts (views)
│  │  │  ├─ INSERT campaign_views_audit
│  │  │  └─ [Immediate] debitConfirmedChannelViews()
│  │  │     └─ fastDebit() in transaction
│  │  │        ├─ Verify: no duplicate source_key
│  │  │        ├─ Verify: campaign active
│  │  │        ├─ Calculate: affable units
│  │  │        ├─ UPDATE campaigns (budget)
│  │  │        ├─ INSERT channel_advertiser_debits
│  │  │        └─ UPDATE campaign_posts (settled_views, spend)
│  │  │
│  │  └─ aggregateChannelStatistics()
│  │     └─ Rebuild channel_daily_stats from campaign_posts
│  │
│  ├─ Click tracking API (realtime)
│  │  ├─ POST /api/clicks/{campaignId}/{postId}
│  │  ├─ Record: campaign_clicks
│  │  └─ debitChannelClick(postId, clickId)
│  │     └─ fastDebit() for click
│  │
│  ├─ channel-settlement cron (periodic)
│  │  ├─ Query: channel_advertiser_debits WHERE publisher_status='pending'
│  │  ├─ FOR EACH debit:
│  │  │  ├─ BEGIN TRANSACTION
│  │  │  ├─ getPublisherQuality()
│  │  │  │  └─ Query: traffic_quality_score, publisher_trust_score, etc.
│  │  │  ├─ Calculate: qualityWeight
│  │  │  ├─ Calculate: splits (platform, publisher, reserve)
│  │  │  ├─ recordPayoutSafetyCheck() [MUST pass or ROLLBACK]
│  │  │  ├─ creditUserLockedBalance()
│  │  │  │  └─ UPDATE users (balance_locked)
│  │  │  ├─ INSERT ad_settlements_views
│  │  │  ├─ UPDATE campaign_posts
│  │  │  ├─ UPDATE campaigns
│  │  │  ├─ UPDATE channel_advertiser_debits (publisher_credit, settled)
│  │  │  └─ COMMIT
│  │  │
│  │  └─ Fraud detection
│  │     └─ runChannelFraudDetection()
│  │        └─ UPDATE channels (traffic_quality_score, trust_score)
│  │
│  ├─ cleanup-expired-posts (periodic)
│  │  ├─ markStalePendingDeliveryPosts()
│  │  │  └─ Update posts pending > timeout
│  │  ├─ [Pre-cleanup settlement]
│  │  │  └─ settleChannelCampaigns()
│  │  │  └─ settlePendingChannelPublisherCredits()
│  │  │
│  │  └─ deleteCampaignPosts()
│  │     ├─ Query: old posts ready for deletion
│  │     ├─ FOR EACH post:
│  │     │  └─ Telegram deleteMessage API
│  │     │     ├─ IF success: UPDATE campaign_posts (deleted_at)
│  │     │     ├─ IF perm error: UPDATE campaign_posts (delete_failed)
│  │     │     └─ IF temp error: retry
│  │     │
│  │     └─ UPDATE channel_scheduler_runs
│  │
│  └─ Publisher payout (future)
│     ├─ Query: users WHERE balance_available > 0
│     ├─ Process withdrawals
│     └─ UPDATE users (balance_available)
│
├─ View Endpoints
│  ├─ GET /api/campaigns/{id}
│  │  └─ Return: campaigns.*, posts.*, spend, earnings
│  │
│  ├─ GET /api/admin/campaigns/{id}
│  │  └─ Return: financial details, settlement logs
│  │
│  └─ GET /api/publisher/balance
│     └─ Return: users.balance_locked, balance_available
│
└─ Financial Audit
   ├─ Query: campaigns.channel_spend vs ledger SUM
   ├─ Query: users.balance_locked vs ledger credits
   ├─ Query: payout_safety_checks WHERE status='blocked'
   └─ Rebuild: totals from ledger
```

---

## 10.2 COMPLETE TABLE DEPENDENCY GRAPH

```
campaigns (Source of Truth)
├─ budget (decrements)
│  ├─ channel_spend (accumulates debits)
│  ├─ channel_publisher_earnings (accumulates credits)
│  ├─ channel_platform_revenue (accumulates margins)
│  └─ channel_reserve_amount (accumulates reserves)
│
├─ cpm (source)
│  └─ [Used by settlement for all calculations]
│
├─ daily_budget_limit (source)
│  └─ [Checked during placement and settlement]
│
├─ status (state machine)
│  ├─ 'active' (required for placement)
│  ├─ 'paused' (blocks delivery)
│  ├─ 'budget_exhausted' (blocks delivery)
│  └─ 'deleted' (removes from delivery)
│
└─ total_budget (derived)
   └─ [Immutable record of budget history]

campaign_posts (Source of Truth)
├─ views (from Telegram API)
│  └─ delta = views - settled_views
│     └─ [Used by settlement]
│
├─ settled_views (source for views settlement)
│  └─ [Matches SUM(channel_settlement_ledger.new_units)]
│
├─ settled_clicks (source for clicks settlement)
│  └─ [Matches SUM(channel_clicks debits)]
│
├─ spend (denormalized sum)
│  └─ [Should match: SUM(ledger.advertiser_debit)]
│
├─ publisher_earnings (denormalized sum)
│  └─ [Should match: SUM(ledger.publisher_credit)]
│
├─ platform_revenue (denormalized sum)
│  └─ [Should match: SUM(ledger.platform_revenue)]
│
└─ reserve_amount (denormalized sum)
   └─ [Should match: SUM(ledger.reserve_amount)]

channel_settlement_ledger (Immutable Audit Log)
├─ advertiser_debit
│  ├─ Flows to: campaigns.channel_spend
│  └─ Flows to: campaigns.budget (decrements)
│
├─ publisher_credit
│  ├─ Flows to: campaigns.channel_publisher_earnings
│  ├─ Flows to: campaign_posts.publisher_earnings
│  └─ Flows to: users.balance_locked (after settlement)
│
├─ platform_revenue
│  ├─ Flows to: campaigns.channel_platform_revenue
│  └─ Flows to: campaign_posts.platform_revenue
│
├─ reserve_amount
│  ├─ Flows to: campaigns.channel_reserve_amount
│  └─ Flows to: campaign_posts.reserve_amount
│
├─ publisher_quality_weight
│  └─ [Calculated from traffic_quality_score]
│
└─ quality_holdback
   └─ [Derived as: publisher_credit_before - publisher_credit_after]

channel_advertiser_debits (Immutable Fast-Path)
├─ source_key (UNIQUE)
│  └─ [Prevents duplicate settlements]
│
├─ advertiser_debit
│  ├─ Flows to: campaigns.budget (immediately)
│  ├─ Flows to: campaigns.channel_spend
│  └─ Flows to: campaign_posts.spend
│
├─ publisher_status
│  ├─ 'pending' (awaits settlement cron)
│  └─ 'settled' (publisher credited)
│
└─ publisher_credit
   ├─ Set by: settlement cron
   └─ Flows to: users.balance_locked

users (Publisher & Advertiser Accounts)
├─ balance_locked (source)
│  ├─ Incremented by: settlement cron
│  ├─ Decremented by: withdrawal approval
│  └─ [Must match: SUM(settled ledger entries)]
│
├─ balance_available (source)
│  ├─ Incremented by: unlockUserBalance()
│  ├─ Decremented by: withdrawal processing
│  └─ [Checked by: withdrawal requests]
│
└─ publisher_risk_score
   └─ [Affects: quality calculation via fraud detection]

channels (Publisher's Channel)
├─ traffic_quality_score
│  └─ [Affects: quality weight calculation]
│
├─ publisher_trust_score
│  └─ [Affects: quality weight calculation]
│
└─ publisher_quality_index
   └─ [Alias for traffic/trust combined]

payout_safety_checks (Immutable Audit Log)
├─ status ('passed' or 'blocked')
│  └─ IF 'blocked': settlement FAILS
│
└─ Comparison
   ├─ advertiser_paid vs expected
   ├─ publisher_share vs expected
   └─ platform_share + reserve_share vs expected

ad_settlements_views & ad_settlements (Denormalized Copies)
├─ post_id, campaign_id, publisher_id, channel_id
├─ advertiser_paid, publisher_reward, status
└─ [Rebuilt from channel_settlement_ledger]
```

---

## 10.3 WRITE OWNERSHIP MAP

| Table | Column | Primary Writers | Secondary Writers | Protected? |
|-------|--------|---|---|---|
| campaigns | budget | fastDebit(), settleChannelCampaigns() | [None] | ✅ Ledger tracks |
| campaigns | status | Admin action, markCampaignBudgetExhausted() | [None] | ✅ State machine |
| campaigns | channel_spend | settleChannelCampaigns() | [None] | ✅ Ledger source |
| campaigns | channel_publisher_earnings | settleChannelCampaigns() | [None] | ✅ Ledger source |
| campaigns | channel_platform_revenue | settleChannelCampaigns() | [None] | ✅ Ledger source |
| campaigns | channel_reserve_amount | settleChannelCampaigns() | [None] | ✅ Ledger source |
| campaign_posts | views | update-views cron | [None] | ✅ Monotonic |
| campaign_posts | settled_views | fastDebit(), settleChannelCampaigns() | [None] | ✅ Ledger track |
| campaign_posts | settled_clicks | fastDebit(), settleChannelCampaigns() | [None] | ✅ Ledger track |
| campaign_posts | spend | fastDebit(), settleChannelCampaigns() | [None] | ✅ Ledger source |
| campaign_posts | publisher_earnings | fastDebit() (via settlement) | [None] | ✅ Ledger source |
| campaign_posts | platform_revenue | settleChannelCampaigns() | [None] | ✅ Ledger source |
| campaign_posts | reserve_amount | settleChannelCampaigns() | [None] | ✅ Ledger source |
| channel_settlement_ledger | * | settleChannelCampaigns() | [None] | ✅ Immutable |
| channel_advertiser_debits | * (except credits) | fastDebit(), debitChannelClick() | [None] | ✅ Source key unique |
| channel_advertiser_debits | publisher_credit | Settlement cron only | [None] | ✅ Immutable after set |
| users | balance_locked | creditUserLockedBalance() + settlement | unlockUserBalance() | ✅ Ledger track |
| users | balance_available | creditUserAvailableBalance() + unlock | Withdrawal process | ✅ Validated |
| payout_safety_checks | * | recordPayoutSafetyCheck() | [None] | ✅ Immutable |
| ad_settlements_views | * | Settlement process | [None] | ✅ Rebuildable |
| ad_settlements | * | Settlement process | [None] | ✅ Rebuildable |

---

## 10.4 COMPLETE FINANCIAL STATE MACHINE

```
Campaign States & Financial Impacts:

pending
  ├─ budget: locked, not deployed
  ├─ spend: 0
  ├─ earnings: 0
  └─ Transition: → active (approval)
      └─ budget becomes eligible for placement

active
  ├─ budget: deploying, decrements on each settlement
  ├─ spend: accumulates
  ├─ earnings: accumulate to publishers
  ├─ Transitions:
  │  ├─ → paused (admin or user)
  │  │  └─ Settlement must complete first (all views settled)
  │  │  └─ If fails: REMAIN active, don't pause
  │  │
  │  ├─ → budget_exhausted (automatic)
  │  │  └─ When budget - pending_liability <= 0
  │  │  └─ No posts placed
  │  │  └─ Existing posts continue to settle
  │  │
  │  └─ → deleted (admin)
  │     └─ Settlement must complete first
  │     └─ Posts removed from Telegram
  │
  └─ Views accumulate, settle immediately (fast-debit path)

paused
  ├─ budget: locked, no new deployments
  ├─ spend: no new debits (posts stop)
  ├─ earnings: existing posts continue to settle
  ├─ Views: stop accumulating (no new posts)
  │
  ├─ Existing posts: already on Telegram, continue earning
  │  └─ Users still click/view
  │  └─ Settlement continues
  │
  └─ Transition: → active (resume)
     └─ Check: advertiser balance >= 1 CPM unit
     └─ Restore status='active'

budget_exhausted
  ├─ Similar to paused
  ├─ budget: 0 (empty)
  ├─ spend: frozen (no new debits)
  ├─ earnings: existing posts continue to settle
  │
  └─ Transition: → active (admin adds budget)
     └─ budget += new amount
     └─ Next placement run picks it up

deleted
  ├─ budget: final (no changes)
  ├─ spend: final (no new debits)
  ├─ earnings: final (no new settlements)
  ├─ Posts: deleted from Telegram
  │
  └─ Terminal: No transition out
     └─ Campaign fully settled
     └─ Publisher fully paid
     └─ Campaign closed

Financial Flows by State:

         active              paused
            │                  │
            ├─→ placement ──┐  │
            │               ├─→ posts on Telegram
            │  (process-ads)   │
            │                  │
            ├─→ views accumulate
            │   (update-views)
            │
            ├─→ immediate debit
            │   (fastDebit)
            │
            ├─→ publisher settlement
            │   (settlement cron)
            │
            └─→ budget decreases
                spending accumulates
                earnings accumulate
```

---

## 10.5 IMMUTABLE TABLES

**These tables MUST NEVER be updated:**

1. **channel_settlement_ledger**
   - Audit log of all settlements
   - Immutable source of financial truth
   - Only operation: INSERT
   - UNIQUE constraint prevents duplication

2. **channel_advertiser_debits** (after publisher_credit set)
   - Immutable debit records
   - source_key ensures uniqueness
   - Only publisher_credit and publisher_status updated (once)
   - Cannot re-debit same source

3. **ad_settlements_views**
   - Denormalized copy of ledger
   - Can be deleted and rebuilt
   - But should never be manually edited

4. **ad_settlements**
   - Same as ad_settlements_views

5. **payout_safety_checks**
   - Immutable audit log
   - Proof that every settlement was verified

6. **campaign_views_audit**
   - Immutable view fetch history
   - Tracks every view update

7. **admin_action_audits**
   - Immutable admin action log
   - Compliance trail

---

## 10.6 REBUILDABLE TABLES

**These tables CAN be safely rebuilt from authoritative sources:**

| Table | Source | Query | Can Rebuild | Loss if Rebuilt |
|-------|--------|-------|---|---|
| campaigns.channel_spend | ledger | SUM(advertiser_debit) GROUP BY campaign_id | YES | None (values recalculated) |
| campaigns.channel_publisher_earnings | ledger | SUM(publisher_credit) GROUP BY campaign_id | YES | None |
| campaigns.channel_platform_revenue | ledger | SUM(platform_revenue) GROUP BY campaign_id | YES | None |
| campaigns.channel_reserve_amount | ledger | SUM(reserve_amount) GROUP BY campaign_id | YES | None |
| campaign_posts.spend | ledger | SUM(advertiser_debit) GROUP BY post_id | YES | None |
| campaign_posts.publisher_earnings | ledger | SUM(publisher_credit) GROUP BY post_id | YES | None |
| campaign_posts.platform_revenue | ledger | SUM(platform_revenue) GROUP BY post_id | YES | None |
| campaign_posts.reserve_amount | ledger | SUM(reserve_amount) GROUP BY post_id | YES | None |
| ad_settlements_views | ledger | RE-INSERT all view ledger records | YES | None (identical records) |
| ad_settlements | ledger | RE-INSERT all click ledger records | YES | None |
| channel_daily_stats | campaign_posts | Aggregate daily stats from posts | YES | Daily breakdown lost (but totals OK) |

---

## 10.7 TABLES THAT SHOULD NEVER BE MANUALLY EDITED

**HIGH RISK** - Manual edits cause financial corruption:

1. **campaigns**
   - budget: Changes affect all downstream calculations
   - channel_spend: Should only reflect ledger
   - channel_publisher_earnings: Affects publisher payments
   - channel_platform_revenue: Affects revenue reporting
   - status: If changed manually, state machine breaks

2. **campaign_posts**
   - views: CRITICAL - Telegram is source of truth
   - settled_views: Creates mismatches with ledger
   - settled_clicks: Creates mismatches with ledger
   - spend: Creates audit trail mismatches

3. **users**
   - balance_locked: If increased, publisher overpaid
   - balance_available: If increased, fraudulent funds
   - balance_locked + balance_available must equal total earnings

4. **channel_settlement_ledger**
   - IMMUTABLE - Should NEVER be edited

5. **channel_advertiser_debits**
   - IMMUTABLE - Dedup key broken if edited

6. **ad_settlements_views** & **ad_settlements**
   - Should only be updated via settlement process
   - Manual changes break audit trail

---

## 10.8 FIELDS SAFE FOR FUTURE ADMIN ADJUSTMENT TOOLS

**LOW RISK** - Can be safely exposed to admin UI with proper validation:

| Field | Safe to Edit? | Validation Required | Impact |
|-------|---|---|---|
| campaigns.cpm | ✅ YES | Applies to future settlements only | Future posts use new CPM |
| campaigns.daily_budget_limit | ✅ YES | Cannot exceed total budget | Affects future placement |
| channels.traffic_quality_score | ⚠️ MAYBE | Must be 0-100 | Affects future settlement payouts |
| settings.platform_margin_percent | ✅ YES | 0-100, notify publishers | Changes future split percentages |
| settings.safety_reserve_percent | ✅ YES | 0-100, verify math | Changes future reserve amounts |
| campaigns.budget | ⚠️ CAREFUL | Can only increase (add funds) | Enables delivery resume |

---

## 10.9 FIELDS THAT SHOULD NEVER BE EDITABLE

**CRITICAL** - Manual edits cause immediate financial corruption:

| Field | Why Never | Risk Level |
|-------|---|---|
| campaigns.budget (decrease) | Bypasses settlement process | CRITICAL |
| campaigns.channel_spend | Breaks audit trail | CRITICAL |
| campaigns.total_budget | Immutable history | CRITICAL |
| campaigns.status | State machine broken | CRITICAL |
| campaign_posts.views | Telegram is ground truth | CRITICAL |
| campaign_posts.settled_views | Creates unbillable delta | CRITICAL |
| campaign_posts.settled_clicks | Creates unbillable delta | CRITICAL |
| campaign_posts.spend | Breaks audit trail | CRITICAL |
| campaign_posts.publisher_earnings | Publisher overpaid | CRITICAL |
| users.balance_locked | Platform pays phantom money | CRITICAL |
| users.balance_available | Platform pays phantom money | CRITICAL |
| channel_settlement_ledger.* | Audit trail tampered | CRITICAL |
| channel_advertiser_debits.* | Double-debit possible | CRITICAL |
| ad_settlements_views.* | Breaks settlement proof | CRITICAL |
| ad_settlements.* | Breaks settlement proof | CRITICAL |

---

## 10.10 FINANCIAL CONSISTENCY CHECK QUERIES

**These queries should return 0 rows if financial system is consistent:**

### Check 1: Campaign Budget Integrity
```sql
SELECT c.id, c.channel_spend, c.budget,
  (SELECT COALESCE(SUM(advertiser_debit), 0) FROM channel_settlement_ledger 
   WHERE campaign_id = c.id) expected_spend
FROM campaigns c
WHERE c.channel_spend != expected_spend
   OR c.channel_spend < 0
   OR c.budget < 0
   OR (c.budget + c.channel_spend) > c.total_budget;
```

### Check 2: Post Spend Integrity
```sql
SELECT cp.id, cp.spend,
  (SELECT COALESCE(SUM(advertiser_debit), 0) FROM channel_settlement_ledger 
   WHERE post_id = cp.id) expected_spend
FROM campaign_posts cp
WHERE cp.spend != expected_spend
   OR cp.spend < 0;
```

### Check 3: Publisher Earnings Integrity
```sql
SELECT u.id, u.balance_locked,
  (SELECT COALESCE(SUM(publisher_credit), 0) FROM channel_settlement_ledger 
   WHERE publisher_id = u.id) +
  (SELECT COALESCE(SUM(publisher_credit), 0) FROM channel_advertiser_debits 
   WHERE publisher_id = u.id AND publisher_status = 'settled') expected_locked
FROM users u
WHERE u.balance_locked != expected_locked
   OR u.balance_locked < 0
   OR u.balance_available < 0;
```

### Check 4: Payout Safety Blocks
```sql
SELECT * FROM payout_safety_checks
WHERE status = 'blocked';
-- Should be 0 rows (all checks pass)
```

### Check 5: Duplicate Debits
```sql
SELECT source_key, COUNT(*) FROM channel_advertiser_debits
GROUP BY source_key
HAVING COUNT(*) > 1;
-- Should be 0 rows (unique constraint prevents)
```

### Check 6: Negative Views
```sql
SELECT id FROM campaign_posts
WHERE settled_views > views
   OR settled_views < 0
   OR views < 0;
-- Should be 0 rows
```

### Check 7: Budget Exceeded Daily Limit
```sql
SELECT c.id, DATE(l.created_at) date,
  SUM(l.advertiser_debit) daily_spend,
  c.daily_budget_limit
FROM channel_settlement_ledger l
JOIN campaigns c ON c.id = l.campaign_id
WHERE l.created_at >= CURDATE()
GROUP BY c.id, DATE(l.created_at)
HAVING daily_spend > c.daily_budget_limit;
-- Should be 0 rows (enforced by settlement)
```

---

# CONCLUSION

This financial audit documents the complete Channel Campaign financial architecture of AdsGalaxy. The system uses:

- **Ledger-based accounting**: channel_settlement_ledger is the immutable source of truth
- **Fast-path debits**: Immediate settlements with settlement cron follow-up
- **Quality weighting**: Dynamic publisher credit calculation
- **Safety checks**: Payout mathematics verified before every settlement
- **Audit trails**: Immutable logs of every financial transaction
- **Distributed processing**: Cron-locked to prevent race conditions
- **Rebuild capability**: Denormalized fields can be recalculated from ledger

**Financial invariants are protected** through:
- Transaction isolation and row-level locking
- UNIQUE constraints on settlement ledger
- Source key deduplication for fast-debit records
- Monotonic view count tracking
- Payout safety checks comparing actual vs. expected splits
- Balance validation before withdrawal

**Risk areas requiring protection**:
- Manual views adjustment (grounds truth violation)
- Manual budget decrease (unauditable spend)
- Manual balance edits (fraud risk)
- Concurrent settlement (prevented by cron lock)
- Pause during settlement (prevented by status re-check)

This completes the comprehensive financial schema and data flow audit.
